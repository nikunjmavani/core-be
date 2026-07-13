/**
 * Print a JWT with role super_admin for k6 admin scenario load tests.
 * Normal login only issues role "user"; admin endpoints require super_admin/admin.
 * For load-test use only. Run: pnpm run tool:admin-token
 */
import '@/shared/config/load-env-files.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';

async function main() {
  const token = await signAccessToken({
    userId: 'load-test-admin',
    role: 'super_admin',
  });
  console.log('Copy for k6 admin scenario:');
  console.log('');
  console.log(`export ADMIN_TOKEN="${token}"`);
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
