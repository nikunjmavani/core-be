/**
 * CI gate: @modelcontextprotocol/sdk must live only in optionalDependencies (not dependencies/devDependencies).
 * Usage: pnpm validate:mcp-optional-dependency
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MCP_PACKAGE_NAME = '@modelcontextprotocol/sdk';

function main(): void {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  const violations: string[] = [];

  if (packageJson.dependencies?.[MCP_PACKAGE_NAME] !== undefined) {
    violations.push(`${MCP_PACKAGE_NAME} must not be in dependencies (use optionalDependencies).`);
  }
  if (packageJson.devDependencies?.[MCP_PACKAGE_NAME] !== undefined) {
    violations.push(
      `${MCP_PACKAGE_NAME} must not be in devDependencies (use optionalDependencies).`,
    );
  }
  if (packageJson.optionalDependencies?.[MCP_PACKAGE_NAME] === undefined) {
    violations.push(`${MCP_PACKAGE_NAME} must be listed in optionalDependencies.`);
  }

  if (violations.length > 0) {
    console.error('MCP optional dependency guard failed:\n');
    for (const message of violations) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }

  console.log(`${MCP_PACKAGE_NAME} is correctly declared in optionalDependencies only.`);
}

main();
