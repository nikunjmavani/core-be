import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from '@/infrastructure/database/connection.js';

/**
 * Verifies defense-in-depth RLS on system tables (migration 20260520000001).
 */
describe('Security: system tables RLS deny-all', () => {
  beforeAll(async () => {
    const rows = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE (n.nspname, c.relname) IN (
        ('billing', 'stripe_webhook_events'),
        ('auth', 'mail_outbox')
      )
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('defines deny-all and core_be_app policies on stripe_webhook_events', async () => {
    const policies = await sql<{ policyname: string }[]>`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'billing' AND tablename = 'stripe_webhook_events'
    `;
    const names = policies.map((row) => row.policyname);
    expect(names).toContain('stripe_webhook_events_deny_all');
    expect(names).toContain('stripe_webhook_events_app_access');
  });

  it('defines deny-all and core_be_app policies on mail_outbox', async () => {
    const policies = await sql<{ policyname: string }[]>`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'auth' AND tablename = 'mail_outbox'
    `;
    const names = policies.map((row) => row.policyname);
    expect(names).toContain('mail_outbox_deny_all');
    expect(names).toContain('mail_outbox_app_access');
  });
});
