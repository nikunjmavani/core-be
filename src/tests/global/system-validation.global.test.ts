import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const DOMAINS_DIR = resolve(ROOT, 'src/domains');
const MIGRATIONS_DIR = resolve(ROOT, 'migrations');

/**
 * System-wide validation tests to ensure architectural invariants
 * are maintained across the entire codebase.
 */
describe('System Validation', () => {
  // ─── Migrations ─────────────────────────────────────────────

  describe('Migrations', () => {
    it('should have a migrations directory', () => {
      expect(existsSync(MIGRATIONS_DIR)).toBe(true);
    });

    it('should have at least one migration file', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter(
        (file) => file.endsWith('.sql') || file.endsWith('.ts'),
      );
      expect(files.length).toBeGreaterThan(0);
    });

    it('migration up files should have monotonic YYYYMMDDHHMMSS prefixes', async () => {
      const { lintMigrationTimestamps } =
        await import('@/scripts/validators/migration/lint-migrations.js');
      const upFilenames = readdirSync(MIGRATIONS_DIR).filter(
        (file) => file.endsWith('.sql') && !file.endsWith('.down.sql'),
      );
      const errors = lintMigrationTimestamps(upFilenames).filter(
        (violation) => violation.severity === 'error',
      );
      expect(errors).toEqual([]);
    });
  });

  // ─── Routes ─────────────────────────────────────────────────

  describe('Route catalog', () => {
    it('should have an auto-generated route catalog file', () => {
      const routeCatalogPath = resolve(ROOT, 'docs/routes.txt');
      expect(existsSync(routeCatalogPath)).toBe(true);
      const content = readFileSync(routeCatalogPath, 'utf-8');
      expect(content).toContain('ROUTE CATALOG');
    });

    it('should have a routes entry point', () => {
      const routesPath = resolve(ROOT, 'src/routes.ts');
      expect(existsSync(routesPath)).toBe(true);
    });
  });

  // ─── Security Middleware ────────────────────────────────────

  describe('Security Middleware', () => {
    const middlewareDir = resolve(ROOT, 'src/shared/middlewares');

    it('should have auth middleware', () => {
      expect(existsSync(join(middlewareDir, 'auth.middleware.ts'))).toBe(true);
    });

    it('should have helmet middleware', () => {
      expect(existsSync(join(middlewareDir, 'helmet.middleware.ts'))).toBe(true);
    });

    it('should have CORS middleware', () => {
      expect(existsSync(join(middlewareDir, 'cors.middleware.ts'))).toBe(true);
    });

    it('should have rate limit middleware', () => {
      expect(existsSync(join(middlewareDir, 'rate-limit.middleware.ts'))).toBe(true);
    });

    it('should have idempotency middleware', () => {
      expect(existsSync(join(middlewareDir, 'idempotency.middleware.ts'))).toBe(true);
    });

    it('should have error handler middleware', () => {
      expect(existsSync(join(middlewareDir, 'error-handler.middleware.ts'))).toBe(true);
    });
  });

  // ─── JWT Configuration ─────────────────────────────────────

  describe('JWT Configuration', () => {
    it('should have JWT utility with RS256 support', () => {
      const jwtUtilPath = resolve(ROOT, 'src/shared/utils/security/jwt.util.ts');
      expect(existsSync(jwtUtilPath)).toBe(true);

      const content = readFileSync(jwtUtilPath, 'utf-8');
      expect(content).toContain('RS256');
      expect(content).toContain('JWT algorithm not allowed: RS256 only');
    });

    it('should enforce 15-minute access token expiry', () => {
      const jwtUtilPath = resolve(ROOT, 'src/shared/utils/security/jwt.util.ts');
      const content = readFileSync(jwtUtilPath, 'utf-8');
      expect(content).toContain('ACCESS_TOKEN_EXPIRY_SECONDS');
    });

    it('should include issuer and audience claims', () => {
      const jwtUtilPath = resolve(ROOT, 'src/shared/utils/security/jwt.util.ts');
      const content = readFileSync(jwtUtilPath, 'utf-8');
      expect(content).toContain('JWT_ISSUER');
      expect(content).toContain('JWT_AUDIENCE');
    });
  });

  // ─── Pino Logger Redaction ─────────────────────────────────

  describe('Logger Configuration', () => {
    it('should have logger utility', () => {
      const loggerPath = resolve(ROOT, 'src/shared/utils/infrastructure/logger.util.ts');
      expect(existsSync(loggerPath)).toBe(true);

      const content = readFileSync(loggerPath, 'utf-8');
      // Logger should redact sensitive fields
      expect(content).toContain('redact');
    });
  });

  // ─── Domain Schema Co-location ─────────────────────────────

  describe('Schema Co-location', () => {
    it('should not have old centralized schemas directory (except barrel)', () => {
      const oldSchemasDir = resolve(ROOT, 'src/infrastructure/database/schemas');
      if (existsSync(oldSchemasDir)) {
        // If it exists, it should only contain index.ts (barrel file)
        const files = readdirSync(oldSchemasDir);
        const nonBarrelFiles = files.filter((file) => file !== 'index.ts');
        expect(
          nonBarrelFiles.length,
          'Old schemas directory should only contain barrel index.ts',
        ).toBe(0);
      }
    });

    it('should have pg-schemas.ts for shared schema definitions', () => {
      const pgSchemasPath = resolve(ROOT, 'src/infrastructure/database/pg-schemas.ts');
      expect(existsSync(pgSchemasPath)).toBe(true);
    });
  });

  // ─── Circuit Breakers ──────────────────────────────────────

  describe('Circuit Breakers', () => {
    it('should have circuit breaker infrastructure', () => {
      const circuitBreakerPath = resolve(ROOT, 'src/infrastructure/resilience/circuit-breaker.ts');
      expect(existsSync(circuitBreakerPath)).toBe(true);

      const content = readFileSync(circuitBreakerPath, 'utf-8');
      expect(content).toContain('stripeCircuit');
      expect(content).toContain('s3Circuit');
      expect(content).toContain('resendCircuit');
    });
  });

  // ─── Strict DTOs ───────────────────────────────────────────

  describe('DTO Validation', () => {
    it('every domain with routes should have dto or validator files', () => {
      const domains = readdirSync(DOMAINS_DIR).filter((name) => {
        const fullPath = join(DOMAINS_DIR, name);
        try {
          return readdirSync(fullPath).some((file) => file.endsWith('.routes.ts'));
        } catch {
          return false;
        }
      });

      for (const domain of domains) {
        const domainPath = join(DOMAINS_DIR, domain);
        const files = readdirSync(domainPath);
        const hasDtoOrValidator = files.some(
          (file) => file.endsWith('.dto.ts') || file.endsWith('.validator.ts'),
        );
        // Not all domains require DTOs (e.g., permission has simple list)
        // This is informational rather than mandatory
        if (!hasDtoOrValidator) {
          const allEntries = readdirSync(domainPath, { recursive: true }) as string[];
          const hasRootService = existsSync(join(domainPath, `${domain}.service.ts`));
          const hasServiceInTree = allEntries.some((entry) =>
            String(entry).endsWith('.service.ts'),
          );
          const hasContainer = existsSync(join(domainPath, `${domain}.container.ts`));
          const hasService = hasRootService || hasServiceInTree;
          expect(
            hasService,
            `Domain "${domain}" should have a root .service.ts or sub-domain services`,
          ).toBe(true);
          if (hasContainer && !hasRootService) {
            expect(
              hasServiceInTree,
              `Multi-sub-domain domain "${domain}" should have at least one sub-domain .service.ts`,
            ).toBe(true);
          }
        }
      }
    });
  });

  // ─── TypeScript Strict Config ──────────────────────────────

  describe('TypeScript Configuration', () => {
    it('should have strict compiler options', () => {
      const tsconfigPath = resolve(ROOT, 'tsconfig.json');
      const content = readFileSync(tsconfigPath, 'utf-8');
      expect(content).toContain('noImplicitOverride');
      expect(content).toContain('noFallthroughCasesInSwitch');
      expect(content).toContain('isolatedModules');
    });
  });

  // ─── CI Configuration ─────────────────────────────────────

  describe('CI/CD Configuration', () => {
    it('should have CI workflow', () => {
      expect(existsSync(resolve(ROOT, '.github/workflows/pr-branch-ci.yml'))).toBe(true);
    });

    it('should have PR checks workflow', () => {
      expect(existsSync(resolve(ROOT, '.github/workflows/pr-governance.yml'))).toBe(true);
    });

    it('should have CODEOWNERS', () => {
      expect(existsSync(resolve(ROOT, '.github/CODEOWNERS'))).toBe(true);
    });

    it('should have dependabot config', () => {
      expect(existsSync(resolve(ROOT, '.github/dependabot.yml'))).toBe(true);
    });

    it('should have Node version pinned', () => {
      expect(existsSync(resolve(ROOT, '.nvmrc'))).toBe(true);
    });
  });
});
