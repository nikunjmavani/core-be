/**
 * Public shape for an auth session. Deliberately omits credential material and
 * internal identifiers — `token_hash`, `refresh_token_hash`, the numeric `id`,
 * `user_id`, `organization_id` — so the "list my sessions" response never leaks
 * session-validation secrets or internal FKs.
 */
export interface AuthSessionOutput {
  public_id: string;
  ip_address: string;
  user_agent: string | null;
  last_active_at: string;
  expires_at: string;
  created_at: string;
}

/** Row fields the serializer reads (a subset of the `auth.sessions` row). */
interface AuthSessionRowLike {
  public_id: string;
  ip_address: string;
  user_agent: string | null;
  last_active_at: Date;
  expires_at: Date;
  created_at: Date;
}

/** Maps a raw session row to its safe public shape. */
export function serializeAuthSession(row: AuthSessionRowLike): AuthSessionOutput {
  return {
    public_id: row.public_id,
    ip_address: row.ip_address,
    user_agent: row.user_agent ?? null,
    last_active_at: row.last_active_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

/** Maps a list of raw session rows to their safe public shapes. */
export function serializeAuthSessions(rows: AuthSessionRowLike[]): AuthSessionOutput[] {
  return rows.map(serializeAuthSession);
}
