#!/usr/bin/env node
/**
 * Ensures Dockerfile.worker build/runtime stages stay in sync with Dockerfile.
 * Exits 0 when in sync, 1 with a short diff hint when not.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const buildStageStart = /^FROM node:24-alpine AS build$/m;
const runtimeStageStart = /^FROM node:24-alpine AS runtime$/m;
const userNodeLine = /^USER node$/m;

const mcpBuildRunPattern = /RUN pnpm build && pnpm build:check[\s\S]*?^\s*fi\s*$/m;

function readDockerfile(fileName) {
  return readFileSync(join(repositoryRoot, fileName), 'utf8');
}

function extractBuildAndRuntime(dockerfileContents) {
  const buildMatch = buildStageStart.exec(dockerfileContents);
  const runtimeMatch = runtimeStageStart.exec(dockerfileContents);
  if (!(buildMatch && runtimeMatch)) {
    throw new Error('Could not find build or runtime stage markers');
  }

  const buildStartIndex = buildMatch.index;
  const runtimeStartIndex = runtimeMatch.index;
  const runtimeSection = dockerfileContents.slice(runtimeStartIndex);
  const userNodeMatch = userNodeLine.exec(runtimeSection);
  if (!userNodeMatch) {
    throw new Error('Could not find USER node in runtime stage');
  }

  const build = dockerfileContents.slice(buildStartIndex, runtimeStartIndex);
  const runtimeEndIndex = runtimeStartIndex + userNodeMatch.index + userNodeMatch[0].length;
  const runtime = dockerfileContents.slice(runtimeStartIndex, runtimeEndIndex);

  return { build, runtime };
}

function normalizeLines(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function normalizeBuild(build, { isMainDockerfile }) {
  let text = build;
  if (isMainDockerfile) {
    text = text.replace(/^ARG GENERATE_MCP_DOCS\s*$\n?/m, '');
    text = text.replace(mcpBuildRunPattern, 'RUN pnpm build && pnpm build:check');
  }
  return normalizeLines(text);
}

function printUnifiedDiff(leftLabel, left, rightLabel, right) {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const maxLines = Math.min(40, Math.max(leftLines.length, rightLines.length));
  console.error(`--- ${leftLabel}`);
  console.error(`+++ ${rightLabel}`);
  for (let index = 0; index < maxLines; index++) {
    const leftLine = leftLines[index] ?? '';
    const rightLine = rightLines[index] ?? '';
    if (leftLine !== rightLine) {
      console.error(`-${leftLine}`);
      console.error(`+${rightLine}`);
    }
  }
  if (leftLines.length > maxLines || rightLines.length > maxLines) {
    console.error('... (truncated)');
  }
}

function main() {
  const mainDockerfile = readDockerfile('Dockerfile');
  const workerDockerfile = readDockerfile('Dockerfile.worker');

  const mainStages = extractBuildAndRuntime(mainDockerfile);
  const workerStages = extractBuildAndRuntime(workerDockerfile);

  const normalizedMainBuild = normalizeBuild(mainStages.build, {
    isMainDockerfile: true,
  });
  const normalizedWorkerBuild = normalizeBuild(workerStages.build, {
    isMainDockerfile: false,
  });
  const normalizedMainRuntime = normalizeLines(mainStages.runtime);
  const normalizedWorkerRuntime = normalizeLines(workerStages.runtime);

  let hasError = false;

  if (normalizedMainBuild !== normalizedWorkerBuild) {
    hasError = true;
    console.error(
      'Dockerfile.worker build stage is out of sync with Dockerfile (after MCP normalization).',
    );
    printUnifiedDiff(
      'Dockerfile (build)',
      normalizedMainBuild,
      'Dockerfile.worker (build)',
      normalizedWorkerBuild,
    );
  }

  if (normalizedMainRuntime !== normalizedWorkerRuntime) {
    hasError = true;
    console.error('Dockerfile.worker runtime stage is out of sync with Dockerfile.');
    printUnifiedDiff(
      'Dockerfile (runtime)',
      normalizedMainRuntime,
      'Dockerfile.worker (runtime)',
      normalizedWorkerRuntime,
    );
  }

  if (hasError) {
    console.error(
      '\nUpdate Dockerfile.worker build/runtime to match Dockerfile, then run: pnpm docker:check-sync',
    );
    process.exit(1);
  }

  console.log('Dockerfile.worker build/runtime stages are in sync with Dockerfile.');
}

main();
