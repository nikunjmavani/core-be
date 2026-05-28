import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import {
  IAMClient,
  CreateUserCommand,
  PutUserPolicyCommand,
  CreateAccessKeyCommand,
  GetUserCommand,
} from '@aws-sdk/client-iam';
import * as logger from '../../../common/logger.js';
import { isSecretFilled } from '../../../common/secrets.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

function createS3Client(secrets: SetupSecrets, region: string): S3Client {
  return new S3Client({
    region,
    credentials: {
      accessKeyId: secrets.aws.accessKeyId,
      secretAccessKey: secrets.aws.secretAccessKey,
    },
  });
}

function createIamClient(secrets: SetupSecrets): IAMClient {
  return new IAMClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: secrets.aws.accessKeyId,
      secretAccessKey: secrets.aws.secretAccessKey,
    },
  });
}

function buildBucketPolicy(bucketArn: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          's3:PutObject',
          's3:GetObject',
          's3:HeadObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        Resource: [bucketArn, `${bucketArn}/*`],
      },
    ],
  });
}

/** Must match `USER_DATA_EXPORT_S3_PREFIX` in user-data-export.constants.ts */
const USER_DATA_EXPORT_S3_PREFIX = 'user-data-export';

/** Must match `USER_DATA_EXPORT_ARTIFACT_TTL_DAYS` in user-data-export.constants.ts */
const USER_DATA_EXPORT_ARTIFACT_TTL_DAYS = 7;

async function applyUserDataExportBucketLifecycle(
  s3Client: S3Client,
  bucketName: string,
): Promise<void> {
  await s3Client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-user-data-export',
            Status: 'Enabled',
            Filter: { Prefix: `${USER_DATA_EXPORT_S3_PREFIX}/` },
            Expiration: { Days: USER_DATA_EXPORT_ARTIFACT_TTL_DAYS },
          },
        ],
      },
    }),
  );
}

function buildCorsRules(allowedOrigins: string[]): Array<{
  AllowedHeaders: string[];
  AllowedMethods: string[];
  AllowedOrigins: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
}> {
  return [
    {
      AllowedHeaders: ['*'],
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedOrigins: allowedOrigins,
      ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
      MaxAgeSeconds: 3600,
    },
  ];
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  const awsConfig = config.providers.aws;
  const s3Client = createS3Client(secrets, awsConfig.region);
  const iamClient = createIamClient(secrets);

  const spinner = logger.startSpinner('Setting up AWS S3...');

  try {
    const buckets: Record<string, { name: string; region: string }> = state.aws?.buckets
      ? { ...state.aws.buckets }
      : {};
    const iamUsers: Record<
      string,
      { username: string; arn: string; accessKeyId: string; secretAccessKey: string }
    > = state.aws?.iamUsers ? { ...state.aws.iamUsers } : {};

    logger.stopSpinner(spinner, 'AWS S3 setup starting...');

    for (const environmentName of environments) {
      const bucketName = `${awsConfig.s3BucketPrefix}-${environmentName}-uploads`;
      const iamUsername = `${awsConfig.iamUserPrefix}-${environmentName}`;

      // Create S3 bucket
      if (!buckets[environmentName]) {
        const bucketSpinner = logger.startSpinner(`Creating S3 bucket: ${bucketName}...`);

        try {
          await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
          logger.stopSpinner(bucketSpinner, `Bucket "${bucketName}" already exists`);
        } catch {
          await s3Client.send(
            new CreateBucketCommand({
              Bucket: bucketName,
              ...(awsConfig.region !== 'us-east-1'
                ? {
                    CreateBucketConfiguration: {
                      LocationConstraint: awsConfig.region as BucketLocationConstraint,
                    },
                  }
                : {}),
            }),
          );
          logger.stopSpinner(bucketSpinner, `Bucket "${bucketName}" created`);
        }

        // Block public access
        await s3Client.send(
          new PutPublicAccessBlockCommand({
            Bucket: bucketName,
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
            },
          }),
        );

        // Set CORS
        const allowedOrigins = config.app.allowedOrigins[environmentName];
        if (allowedOrigins) {
          await s3Client.send(
            new PutBucketCorsCommand({
              Bucket: bucketName,
              CORSConfiguration: {
                CORSRules: buildCorsRules(allowedOrigins.split(',')),
              },
            }),
          );
        }

        buckets[environmentName] = { name: bucketName, region: awsConfig.region };
      } else {
        logger.success(`  Bucket "${environmentName}" already configured`);
      }

      const lifecycleSpinner = logger.startSpinner(
        `Applying GDPR export lifecycle on "${bucketName}"...`,
      );
      try {
        await applyUserDataExportBucketLifecycle(s3Client, bucketName);
        logger.stopSpinner(
          lifecycleSpinner,
          `Lifecycle: expire \`${USER_DATA_EXPORT_S3_PREFIX}/\` after ${USER_DATA_EXPORT_ARTIFACT_TTL_DAYS} days`,
        );
      } catch (lifecycleError) {
        const message =
          lifecycleError instanceof Error ? lifecycleError.message : String(lifecycleError);
        logger.stopSpinner(lifecycleSpinner, `Lifecycle rule failed: ${message}`, 'fail');
        throw lifecycleError;
      }

      // Create IAM user
      if (!iamUsers[environmentName]) {
        const iamSpinner = logger.startSpinner(`Creating IAM user: ${iamUsername}...`);

        let userArn: string;
        try {
          const getUserResponse = await iamClient.send(
            new GetUserCommand({ UserName: iamUsername }),
          );
          const existingArn = getUserResponse.User?.Arn;
          if (!existingArn) {
            throw new Error(
              `IAM GetUser succeeded but returned no Arn for "${iamUsername}" (AWS API contract violation).`,
            );
          }
          userArn = existingArn;
          logger.stopSpinner(iamSpinner, `IAM user "${iamUsername}" already exists`);
        } catch {
          const createUserResponse = await iamClient.send(
            new CreateUserCommand({ UserName: iamUsername }),
          );
          const createdArn = createUserResponse.User?.Arn;
          if (!createdArn) {
            throw new Error(
              `IAM CreateUser succeeded but returned no Arn for "${iamUsername}" (AWS API contract violation).`,
            );
          }
          userArn = createdArn;
          logger.stopSpinner(iamSpinner, `IAM user "${iamUsername}" created`);
        }

        // Attach inline policy scoped to this bucket
        const bucketArn = `arn:aws:s3:::${bucketName}`;
        await iamClient.send(
          new PutUserPolicyCommand({
            UserName: iamUsername,
            PolicyName: `${bucketName}-access`,
            PolicyDocument: buildBucketPolicy(bucketArn),
          }),
        );

        // Create access key
        const accessKeyResponse = await iamClient.send(
          new CreateAccessKeyCommand({ UserName: iamUsername }),
        );

        const accessKey = accessKeyResponse.AccessKey;
        if (!(accessKey?.AccessKeyId && accessKey.SecretAccessKey)) {
          throw new Error(
            `IAM CreateAccessKey returned an incomplete key pair for "${iamUsername}" (AWS API contract violation).`,
          );
        }

        iamUsers[environmentName] = {
          username: iamUsername,
          arn: userArn,
          accessKeyId: accessKey.AccessKeyId,
          secretAccessKey: accessKey.SecretAccessKey,
        };

        logger.success(`  Access key created for "${iamUsername}"`);
      } else {
        logger.success(`  IAM user "${environmentName}" already configured`);
      }
    }

    return {
      success: true,
      message: `AWS: ${Object.keys(buckets).length} buckets + ${Object.keys(iamUsers).length} IAM users ready`,
      stateUpdates: { aws: { buckets, iamUsers } },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`AWS provisioning failed: ${message}`);
    return { success: false, message };
  } finally {
    s3Client.destroy();
    iamClient.destroy();
  }
}

export async function check(
  state: SetupState,
  secrets: SetupSecrets,
  region: string,
): Promise<boolean> {
  if (!state.aws?.buckets) {
    logger.error('AWS: no buckets in state');
    return false;
  }

  const s3Client = createS3Client(secrets, region);
  let allHealthy = true;

  for (const [environmentName, bucket] of Object.entries(state.aws.buckets)) {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucket.name }));
      logger.success(`S3 bucket "${environmentName}" (${bucket.name}) — reachable`);
    } catch {
      logger.error(`S3 bucket "${environmentName}" (${bucket.name}) — unreachable`);
      allHealthy = false;
    }
  }

  s3Client.destroy();
  return allHealthy;
}

function allEnvironmentsHaveBucket(environments: string[], state: SetupState): boolean {
  const buckets = state.aws?.buckets;
  if (!buckets) return false;
  return environments.every((environmentName) => Boolean(buckets[environmentName]));
}

function allEnvironmentsHaveIamUser(environments: string[], state: SetupState): boolean {
  const iamUsers = state.aws?.iamUsers;
  if (!iamUsers) return false;
  return environments.every((environmentName) => Boolean(iamUsers[environmentName]));
}

export const setupAwsProvider: InfraProvider = {
  key: 'aws',
  name: 'AWS S3',
  isEnabled: ({ config, secrets }) =>
    config.providers.aws.enabled && isSecretFilled(secrets.aws.accessKeyId),
  disabledReason: ({ config }) =>
    !config.providers.aws.enabled
      ? 'disabled in setup.config.json'
      : 'AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY missing in .env.setup',
  preview: ({ config }) =>
    config.providers.aws.enabled
      ? {
          detail: 'Access Key ID + Secret',
          url: 'https://console.aws.amazon.com/iam/home#/users',
          configKey: 'aws.accessKeyId, aws.secretAccessKey',
        }
      : null,
  settingsReview: ({ config, environments }) =>
    config.providers.aws.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'AWS S3',
            detail: `${environments.length} buckets + ${environments.length} IAM users (${config.providers.aws.region})`,
          },
        ]
      : [],
  detectExisting: async ({ config, secrets, environments }) => {
    if (!(config.providers.aws.enabled && isSecretFilled(secrets.aws.accessKeyId))) return [];
    const s3Client = new S3Client({
      region: config.providers.aws.region,
      credentials: {
        accessKeyId: secrets.aws.accessKeyId,
        secretAccessKey: secrets.aws.secretAccessKey,
      },
    });
    const existing: Array<{ provider: string; detail: string }> = [];
    for (const environmentName of environments) {
      const bucketName = `${config.providers.aws.s3BucketPrefix}-${environmentName}-uploads`;
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        existing.push({ provider: 'AWS S3', detail: `bucket "${bucketName}" already exists` });
      } catch {
        // bucket does not exist — fine
      }
    }
    s3Client.destroy();
    return existing;
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'AWS S3',
    enabled: setupAwsProvider.isEnabled(context),
    enabledReason: setupAwsProvider.disabledReason(context),
    instructions: [
      `Will create or adopt one S3 bucket per environment in ${context.config.providers.aws.region}.`,
      `Bucket names: ${context.environments
        .map(
          (environmentName) =>
            `${context.config.providers.aws.s3BucketPrefix}-${environmentName}-uploads`,
        )
        .join(', ')}.`,
      `Will create or adopt one IAM user per environment for restricted bucket access.`,
    ],
    alreadyDone: () =>
      allEnvironmentsHaveBucket(context.environments, context.state) &&
      allEnvironmentsHaveIamUser(context.environments, context.state),
    alreadyDoneMessage: 'all buckets + IAM users already in state',
    execute: async () => {
      const result = await provision(
        context.config,
        context.secrets,
        context.state,
        context.environments,
      );
      if (!result.success) throw new Error(result.message);
      context.applyStateUpdates(result.stateUpdates ?? {});
      return result;
    },
    verifyState: () => ({
      ok:
        allEnvironmentsHaveBucket(context.environments, context.state) &&
        allEnvironmentsHaveIamUser(context.environments, context.state),
      message: context.state.aws?.buckets
        ? `${Object.keys(context.state.aws.buckets).length} buckets + ${Object.keys(context.state.aws.iamUsers ?? {}).length} IAM users`
        : 'no AWS resources recorded',
    }),
    verifyLive: async () => {
      const ok = await check(context.state, context.secrets, context.config.providers.aws.region);
      return { ok, message: ok ? 'reachable' : 'unreachable' };
    },
  }),
  check: ({ config, state, secrets }) => check(state, secrets, config.providers.aws.region),
  deleteInstructions: ({ config, state }) => {
    const buckets = state.aws?.buckets ?? {};
    const iamUsers = state.aws?.iamUsers ?? {};
    const blocks: Array<{
      provider: string;
      dashboardUrl: string;
      steps?: string[];
      resources: Array<{ label: string; identifier: string }>;
    }> = [];

    if (Object.keys(buckets).length > 0) {
      const region = config.providers.aws.region;
      blocks.push({
        provider: 'AWS S3',
        dashboardUrl: `https://s3.console.aws.amazon.com/s3/buckets?region=${region}`,
        steps: [
          'Open the bucket → Empty (delete all objects + versions) → then Delete bucket.',
          'Buckets cannot be deleted while they contain objects.',
        ],
        resources: Object.entries(buckets).map(([environmentName, bucket]) => ({
          label: `Bucket (${environmentName})`,
          identifier: bucket.name,
        })),
      });
    }

    if (Object.keys(iamUsers).length > 0) {
      blocks.push({
        provider: 'AWS IAM',
        dashboardUrl: 'https://console.aws.amazon.com/iam/home#/users',
        steps: [
          'Open each user → Security credentials → delete access keys.',
          'Then Permissions → detach policies → Delete user.',
        ],
        resources: Object.entries(iamUsers).map(([environmentName, user]) => ({
          label: `IAM user (${environmentName})`,
          identifier: user.username,
        })),
      });
    }

    return blocks;
  },
};
