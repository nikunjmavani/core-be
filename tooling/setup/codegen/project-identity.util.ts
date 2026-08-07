import { repositoryName, repositoryOwner } from '@tooling/setup/common/config.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';

/** Docker/GHCR artifact names derived from {@link SetupConfig}. */
export interface ProjectArtifacts {
  readonly apiImage: string;
  readonly workerImage: string;
  readonly dockerLocalApiTag: string;
  readonly ghcrCacheScopeApi: string;
  readonly ghcrCacheScopeWorker: string;
}

/** Git metadata used by CI codegen and validators. */
export interface ProjectGitMetadata {
  readonly protectedBranches: readonly string[];
  readonly defaultBranch: string;
  readonly nonProductionBranch: string;
  readonly productionBranch: string;
}

export type BranchEnvironmentMap = Record<string, string>;

/** GitHub repository coordinates and the CODEOWNERS roster derived from them. */
export interface ProjectRepositoryMetadata {
  /** Full `owner/repo` slug from `providers.github.repository`. */
  readonly slug: string;
  /** Owner segment — a GitHub user or organization login. */
  readonly owner: string;
  /** Repository segment. */
  readonly name: string;
  /** CODEOWNERS handles WITHOUT the leading `@`, in reviewer-preference order. */
  readonly owners: readonly string[];
}

/**
 * Names derived from the project slug that appear outside TypeScript constants —
 * Docker container names, external service keys, and generated artifact paths.
 *
 * @remarks
 * These exist because a rebrand must reach files that cannot import a constant
 * (compose YAML, `sonar-project.properties`). Deriving rather than configuring
 * them keeps `setup.config.json` small: one slug change renames all of them.
 */
export interface ProjectDerivedNames {
  /** `name`/`version` reported by the MCP server handshake. */
  readonly apiServerName: string;
  /** `User-Agent` prefix on outbound webhook deliveries. */
  readonly webhookUserAgent: string;
  /** Default Scalar registry slug when `SCALAR_SLUG` is unset. */
  readonly scalarSlug: string;
  /** Postman collection name prefix (also the generated collection's `info.name`). */
  readonly postmanCollectionPrefix: string;
  /** SonarQube `sonar.projectKey` / `sonar.projectName`. */
  readonly sonarProjectKey: string;
  /** SonarQube local-gate token name. */
  readonly sonarTokenName: string;
  /** Repository-relative path of the generated DBML diagram. */
  readonly dbmlPath: string;
  /** JWT `aud` claim naming the API tier — a security-critical identity value. */
  readonly jwtAudience: string;
  /** Local Postgres database, user and password (all the product stem). */
  readonly databaseName: string;
  /** Throwaway database the CI migration dry-run creates. */
  readonly dryRunDatabaseName: string;
  /** Restricted Postgres role the app connects as, under RLS. */
  readonly databaseAppRole: string;
  /** Postgres role owning runtime objects. */
  readonly databaseRuntimeRole: string;
  /** Default Redis key-prefix stem (`<stem>:<NODE_ENV>:`). */
  readonly redisKeyPrefix: string;
  /** Local Docker Compose container names, keyed by service. */
  readonly containers: Readonly<Record<ContainerService, string>>;
}

/** Local Compose services whose `container_name` carries the project slug. */
export type ContainerService = 'postgres' | 'redis' | 'toxiproxy' | 'sonarqube' | 'sonarScanner';

export interface ProjectIdentitySnapshot {
  readonly slug: string;
  readonly displayName: string;
  readonly packageName: string;
  readonly description?: string | undefined;
  /** Paired frontend repository name (see {@link resolveFrontendSlug}). */
  readonly frontendSlug: string;
  readonly artifacts: ProjectArtifacts;
  readonly git: ProjectGitMetadata;
  readonly repository: ProjectRepositoryMetadata;
  readonly derived: ProjectDerivedNames;
  readonly branchEnvironmentMap: BranchEnvironmentMap;
  readonly environments: SetupConfig['environments'];
}

/** Default artifact names from a project slug (`<slug>` → `<slug>-api`, etc.). */
export function buildDefaultArtifacts(projectSlug: string): ProjectArtifacts {
  return {
    apiImage: `${projectSlug}-api`,
    workerImage: `${projectSlug}-worker`,
    dockerLocalApiTag: projectSlug,
    ghcrCacheScopeApi: `${projectSlug}-api`,
    ghcrCacheScopeWorker: `${projectSlug}-worker`,
  };
}

export function resolveArtifacts(config: SetupConfig): ProjectArtifacts {
  return config.project.artifacts ?? buildDefaultArtifacts(config.project.name);
}

export function buildBranchEnvironmentMap(config: SetupConfig): BranchEnvironmentMap {
  // Single trunk: every environment deploys from the default branch, so the map has a
  // single entry keyed on it, mapping to the production environment's name (preserving
  // the historical `{ <branch>: production }` shape).
  const { defaultBranch } = resolveGitMetadata(config);
  const productionEnvironment =
    config.environments.find(
      (environment) =>
        environment.name === 'production' || environment.nodeEnvironment === 'production',
    ) ?? config.environments[0];
  const map: BranchEnvironmentMap = {};
  if (productionEnvironment) {
    map[defaultBranch] = productionEnvironment.name;
  }
  return map;
}

export function resolveGitMetadata(config: SetupConfig): ProjectGitMetadata {
  const defaultBranch = config.git?.defaultBranch ?? 'main';
  const protectedBranches = config.git?.protectedBranches ?? [defaultBranch];
  // Single trunk: every environment deploys from the default branch, so the production
  // and non-production "branches" are both the trunk (nothing is derived from a branch).
  return {
    protectedBranches,
    defaultBranch,
    nonProductionBranch: defaultBranch,
    productionBranch: defaultBranch,
  };
}

/** GitHub coordinates plus the CODEOWNERS roster (defaulting to the repo owner). */
export function resolveRepositoryMetadata(config: SetupConfig): ProjectRepositoryMetadata {
  const slug = config.providers.github.repository;
  const owner = repositoryOwner(slug);
  return {
    slug,
    owner,
    name: repositoryName(slug),
    owners: config.providers.github.owners ?? [owner],
  };
}

/**
 * Name of the paired frontend repository.
 *
 * @remarks
 * Docs and comments describe a BE↔FE contract — CORS origins, the invitation
 * accept page, a shared local Sonar server — so the pair name is part of this
 * project's identity even though no backend code reads it. Derived by swapping a
 * trailing `-be` for `-fe` (`acme-be` → `acme-fe`), or appending `-fe` when the
 * slug carries no suffix. Override with `project.frontendName` when the pair does
 * not follow that convention.
 */
export function resolveFrontendSlug(config: SetupConfig): string {
  if (config.project.frontendName) {
    return config.project.frontendName;
  }
  const slug = config.project.name;
  return slug.endsWith('-be') ? `${slug.slice(0, -'-be'.length)}-fe` : `${slug}-fe`;
}

/**
 * The product stem: the slug with its tier suffix removed (`acme-be` → `acme`).
 *
 * @remarks
 * Several names are built from the PRODUCT rather than the repository — the JWT
 * audience names the API tier, and the local database, its user and the Redis key
 * prefix are per-product, not per-repo. Deriving them from the stem keeps a
 * backend and its paired frontend agreeing on one product name.
 */
export function resolveProductStem(config: SetupConfig): string {
  const slug = config.project.name;
  return slug.endsWith('-be') ? slug.slice(0, -'-be'.length) : slug;
}

/** The slug in SQL-identifier form (`acme-be` → `acme_be`). */
export function resolveSqlIdentifierStem(config: SetupConfig): string {
  return config.project.name.replace(/-/g, '_');
}

/** Every slug-derived name that a rebrand must reach outside TypeScript constants. */
export function resolveDerivedNames(config: SetupConfig): ProjectDerivedNames {
  const slug = config.project.name;
  const stem = resolveProductStem(config);
  const sqlStem = resolveSqlIdentifierStem(config);
  return {
    jwtAudience: `${stem}-api`,
    databaseName: stem,
    dryRunDatabaseName: `${stem}_dryrun`,
    databaseAppRole: `${sqlStem}_app`,
    databaseRuntimeRole: `${sqlStem}_runtime`,
    redisKeyPrefix: stem,
    apiServerName: slug,
    webhookUserAgent: `${slug}-webhook`,
    scalarSlug: slug,
    postmanCollectionPrefix: `${config.project.displayName} API`,
    sonarProjectKey: slug,
    sonarTokenName: `${slug}-local-gate`,
    dbmlPath: `docs/database/${slug}.dbml`,
    containers: {
      postgres: `${slug}-postgres`,
      redis: `${slug}-redis`,
      toxiproxy: `${slug}-toxiproxy`,
      sonarqube: `${slug}-sonarqube`,
      sonarScanner: `${slug}-sonar-scanner`,
    },
  };
}

export function buildProjectIdentitySnapshot(config: SetupConfig): ProjectIdentitySnapshot {
  return {
    slug: config.project.name,
    displayName: config.project.displayName,
    packageName: config.project.packageName ?? config.project.name,
    description: config.project.description,
    frontendSlug: resolveFrontendSlug(config),
    artifacts: resolveArtifacts(config),
    git: resolveGitMetadata(config),
    repository: resolveRepositoryMetadata(config),
    derived: resolveDerivedNames(config),
    branchEnvironmentMap: buildBranchEnvironmentMap(config),
    environments: config.environments,
  };
}
