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
  const map: BranchEnvironmentMap = {};
  for (const environment of config.environments) {
    map[environment.branch] = environment.name;
  }
  return map;
}

export function resolveGitMetadata(config: SetupConfig): ProjectGitMetadata {
  const protectedBranches =
    config.git?.protectedBranches ?? config.environments.map((environment) => environment.branch);
  const defaultBranch =
    config.git?.defaultBranch ??
    config.environments.find((environment) => environment.isDefault)?.branch ??
    config.environments[0]?.branch ??
    'main';
  const productionEnvironment = config.environments.find(
    (environment) =>
      environment.name === 'production' || environment.nodeEnvironment === 'production',
  );
  const nonProductionEnvironment = config.environments.find(
    (environment) => environment.name !== productionEnvironment?.name,
  );
  const productionBranch = productionEnvironment?.branch ?? 'main';
  const nonProductionBranch = nonProductionEnvironment?.branch ?? 'dev';

  return {
    protectedBranches,
    defaultBranch,
    nonProductionBranch,
    productionBranch,
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
