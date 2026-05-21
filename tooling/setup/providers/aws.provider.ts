import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import {
  IAMClient,
  CreateUserCommand,
  PutUserPolicyCommand,
  CreateAccessKeyCommand,
  GetUserCommand,
} from '@aws-sdk/client-iam';
import * as logger from '../logger.util.js';
import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from '../types.js';

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

function buildBucketPolicy(bucketName: string, bucketArn: string): string {
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
                ? { CreateBucketConfiguration: { LocationConstraint: awsConfig.region } }
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
          userArn = getUserResponse.User!.Arn!;
          logger.stopSpinner(iamSpinner, `IAM user "${iamUsername}" already exists`);
        } catch {
          const createUserResponse = await iamClient.send(
            new CreateUserCommand({ UserName: iamUsername }),
          );
          userArn = createUserResponse.User!.Arn!;
          logger.stopSpinner(iamSpinner, `IAM user "${iamUsername}" created`);
        }

        // Attach inline policy scoped to this bucket
        const bucketArn = `arn:aws:s3:::${bucketName}`;
        await iamClient.send(
          new PutUserPolicyCommand({
            UserName: iamUsername,
            PolicyName: `${bucketName}-access`,
            PolicyDocument: buildBucketPolicy(bucketName, bucketArn),
          }),
        );

        // Create access key
        const accessKeyResponse = await iamClient.send(
          new CreateAccessKeyCommand({ UserName: iamUsername }),
        );

        iamUsers[environmentName] = {
          username: iamUsername,
          arn: userArn,
          accessKeyId: accessKeyResponse.AccessKey!.AccessKeyId!,
          secretAccessKey: accessKeyResponse.AccessKey!.SecretAccessKey!,
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

export async function destroy(state: SetupState, secrets: SetupSecrets): Promise<void> {
  if (!state.aws) return;

  const iamClient = createIamClient(secrets);

  if (state.aws.iamUsers) {
    for (const [environmentName, user] of Object.entries(state.aws.iamUsers)) {
      const spinner = logger.startSpinner(`Deleting IAM user: ${user.username}...`);
      try {
        // IAM user deletion requires removing keys + policies first (complex)
        // For safety, just log a warning
        logger.stopSpinner(
          spinner,
          `IAM user "${environmentName}" (${user.username}) — manual deletion recommended`,
          'warn',
        );
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
        logger.stopSpinner(spinner, `Failed: ${message}`, 'fail');
      }
    }
  }

  logger.warn('S3 buckets must be emptied before deletion — skipping bucket deletion for safety.');
  logger.info('Delete buckets manually via AWS Console if needed.');

  iamClient.destroy();
}

export async function destroyEnvironment(
  environmentName: string,
  state: SetupState,
  _secrets: SetupSecrets,
): Promise<void> {
  const bucket = state.aws?.buckets?.[environmentName];
  const user = state.aws?.iamUsers?.[environmentName];
  if (!bucket && !user) return;

  logger.warn(
    `AWS "${environmentName}": S3 bucket "${bucket?.name ?? 'N/A'}" and IAM user "${user?.username ?? 'N/A'}" — manual deletion via AWS Console recommended.`,
  );
}
