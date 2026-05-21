import { describe, expect, it } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DOMAINS_DIR = resolve(process.cwd(), 'src/domains');

function getDirectories(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(
    (name) => statSync(join(directory, name)).isDirectory() && !name.startsWith('__'),
  );
}

describe('Domain Structural Consistency', () => {
  const domains = getDirectories(DOMAINS_DIR);

  it('all domains should use kebab-case names', () => {
    for (const domain of domains) {
      expect(domain, `Domain "${domain}" must be kebab-case`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('all domain directories should have a routes or container file', () => {
    for (const domain of domains) {
      const domainPath = join(DOMAINS_DIR, domain);
      const hasRoutes = existsSync(join(domainPath, `${domain}.routes.ts`));
      const hasContainer = existsSync(join(domainPath, `${domain}.container.ts`));
      expect(
        hasRoutes || hasContainer,
        `Domain "${domain}" should have ${domain}.routes.ts or ${domain}.container.ts`,
      ).toBe(true);
    }
  });

  it('should not have old schemas directory', () => {
    const oldSchemasDir = resolve(process.cwd(), 'src/infrastructure/database/schemas');
    expect(
      existsSync(oldSchemasDir),
      'Old schemas directory should be removed — schemas are co-located in domains',
    ).toBe(false);
  });

  it('sub-domain directories should use kebab-case', () => {
    for (const domain of domains) {
      const domainPath = join(DOMAINS_DIR, domain);
      const subDomains = getDirectories(domainPath);
      for (const subDomain of subDomains) {
        expect(subDomain, `Sub-domain "${domain}/${subDomain}" must be kebab-case`).toMatch(
          /^[a-z][a-z0-9-]*$/,
        );
      }
    }
  });

  it('each domain should have __tests__ directory', () => {
    for (const domain of domains) {
      const testsDir = join(DOMAINS_DIR, domain, '__tests__');
      expect(existsSync(testsDir), `Domain "${domain}" should have __tests__/ directory`).toBe(
        true,
      );
    }
  });
});
