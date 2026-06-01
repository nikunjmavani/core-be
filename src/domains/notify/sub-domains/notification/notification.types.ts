/**
 * Public-facing notification shape (string ids + ISO timestamps) returned by the API. Differs
 * from the internal Drizzle row by serialising `bigint` columns to strings and exposing
 * `body` (sourced from the `message` column).
 */
export interface NotificationOutput {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}
