/**
 * Obtain TEST_TOKEN and TEST_ORG_ID for k6 load tests (daily-ops, billing, webhooks).
 * Requires server running and full seed (demo@example.com / DemoPassword123!).
 * Run: pnpm run tool:load-test-credentials
 *
 * The active organization rides the token's `org` claim — the org-scoped routes carry no
 * `{organization_id}` path segment — so the printed token MUST be scoped to the printed
 * org. Login resolves its own active organization, which is not necessarily the first
 * entry of `GET /tenancy/organizations`; printing the login token beside that first entry
 * emitted a mismatched pair whenever the demo user belonged to more than one org, and
 * every org-permission-gated scenario then failed with 403 "Insufficient organization
 * permissions" against an org the token was not scoped to.
 *
 * So: pick the org, re-mint through `POST /auth/switch-to-organization`, and verify the
 * claim before printing.
 */
import '@/shared/config/load-env-files.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const API_PREFIX = `${BASE_URL}/api/v1`;
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@example.com';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPassword123!';

/** Read the `org` claim out of a JWT payload without verifying the signature (local tooling). */
function readOrganizationClaim(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      org?: string;
    };
    return decoded.org;
  } catch {
    return undefined;
  }
}

async function main() {
  const loginResponse = await fetch(`${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!loginResponse.ok) {
    const text = await loginResponse.text();
    console.error('Login failed:', loginResponse.status, text);
    process.exit(1);
  }

  const loginBody = (await loginResponse.json()) as {
    data?: { access_token?: string };
  };
  let token = loginBody.data?.access_token;
  if (!token) {
    console.error('Login response missing access_token');
    process.exit(1);
  }

  const orgsResponse = await fetch(`${API_PREFIX}/tenancy/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!orgsResponse.ok) {
    console.error('List organizations failed:', orgsResponse.status);
    process.exit(1);
  }

  const orgsBody = (await orgsResponse.json()) as {
    data?: Array<{ id: string }>;
  };
  const items = orgsBody.data ?? [];
  const targetOrganizationId = items[0]?.id;

  if (!targetOrganizationId) {
    console.error('No organizations found for the demo user — run pnpm db:seed:full first.');
    process.exit(1);
  }

  // Re-mint scoped to the org we are about to print, unless login already landed there.
  if (readOrganizationClaim(token) !== targetOrganizationId) {
    const switchResponse = await fetch(`${API_PREFIX}/auth/switch-to-organization`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: targetOrganizationId }),
    });

    if (!switchResponse.ok) {
      const text = await switchResponse.text();
      console.error(
        `Switch to ${targetOrganizationId} failed:`,
        switchResponse.status,
        text.slice(0, 300),
      );
      process.exit(1);
    }

    const switchBody = (await switchResponse.json()) as {
      data?: { access_token?: string };
    };
    const switchedToken = switchBody.data?.access_token;
    if (!switchedToken) {
      console.error('Switch response missing access_token');
      process.exit(1);
    }
    token = switchedToken;
  }

  const scopedOrganizationId = readOrganizationClaim(token);
  if (scopedOrganizationId !== targetOrganizationId) {
    console.error(
      `Refusing to print a mismatched pair: token org claim is ${scopedOrganizationId ?? '<none>'}, expected ${targetOrganizationId}.`,
    );
    process.exit(1);
  }

  console.log('Copy and paste for k6 (daily-ops, billing, webhooks):');
  console.log('');
  console.log(`export TEST_TOKEN="${token}"`);
  console.log(`export TEST_ORG_ID="${targetOrganizationId}"`);
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
