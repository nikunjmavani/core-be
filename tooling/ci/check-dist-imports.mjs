#!/usr/bin/env node
/**
 * Fails if compiled dist/ still contains unresolved @/ path aliases.
 * Run after `pnpm build` in CI and locally.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const distDirectory = join(process.cwd(), 'dist');
const unresolvedPattern = /from\s+['"]@\//;

function walk(directory) {
  const issues = [];
  for (const entry of readdirSync(directory)) {
    const filePath = join(directory, entry);
    if (statSync(filePath).isDirectory()) {
      issues.push(...walk(filePath));
      continue;
    }
    if (!filePath.endsWith('.js')) {
      continue;
    }
    const content = readFileSync(filePath, 'utf8');
    if (unresolvedPattern.test(content)) {
      issues.push(filePath);
    }
  }
  return issues;
}

const unresolvedFiles = walk(distDirectory);
if (unresolvedFiles.length > 0) {
  console.error('Build output still contains unresolved @/ imports:');
  for (const filePath of unresolvedFiles) {
    console.error(`  ${filePath}`);
  }
  console.error('Ensure `tsc-alias` runs after `tsc` in the build script.');
  process.exit(1);
}

console.log('dist/ has no unresolved @/ imports.');
