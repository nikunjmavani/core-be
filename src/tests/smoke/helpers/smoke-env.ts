export type SmokeEnvironment = {
  baseUrl: string;
  demoEmail: string;
  demoPassword: string;
};

export function loadSmokeEnvironment(): SmokeEnvironment {
  const baseUrl =
    process.env.SMOKE_BASE_URL?.trim() || process.env.BASE_URL?.trim() || 'http://localhost:3000';
  const demoEmail = process.env.SMOKE_DEMO_EMAIL ?? process.env.TEST_EMAIL ?? 'demo@example.com';
  const demoPassword =
    process.env.SMOKE_DEMO_PASSWORD ?? process.env.TEST_PASSWORD ?? 'DemoPassword123!';

  return { baseUrl, demoEmail, demoPassword };
}
