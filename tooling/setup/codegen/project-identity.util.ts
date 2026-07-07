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

export interface ProjectIdentitySnapshot {
  readonly slug: string;
  readonly displayName: string;
  readonly artifacts: ProjectArtifacts;
  readonly git: ProjectGitMetadata;
  readonly branchEnvironmentMap: BranchEnvironmentMap;
  readonly environments: SetupConfig['environments'];
}

/** Default artifact names from a project slug (`core-be` → `core-be-api`, etc.). */
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

export function buildProjectIdentitySnapshot(config: SetupConfig): ProjectIdentitySnapshot {
  return {
    slug: config.project.name,
    displayName: config.project.displayName,
    artifacts: resolveArtifacts(config),
    git: resolveGitMetadata(config),
    branchEnvironmentMap: buildBranchEnvironmentMap(config),
    environments: config.environments,
  };
}
