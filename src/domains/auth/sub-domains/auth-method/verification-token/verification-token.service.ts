import type {
  VerificationTokenRepository,
  VerificationTokenType,
} from './verification-token.repository.js';

/**
 * Thin service wrapper around {@link VerificationTokenRepository}.
 *
 * @remarks
 * - **Algorithm:** delegates each call directly to the repository; exists so
 *   higher-level services can depend on a service abstraction rather than the
 *   data layer.
 * - **Failure modes:** propagates repository errors (`consumeIfValid` returns
 *   `null` on missing/expired/already-used tokens, leaving error mapping to the
 *   caller).
 * - **Side effects:** persists token records in `auth.verification_tokens`.
 * - **Notes:** maintains the replay invariant — `consumeIfValid` enforces
 *   single-use semantics via an atomic UPDATE inside the repository.
 */
export class VerificationTokenService {
  constructor(private readonly repository: VerificationTokenRepository) {}

  async create(
    token_type: VerificationTokenType,
    user_id: number,
    email: string,
    token_hash: string,
    expires_at: Date,
  ) {
    return this.repository.create(token_type, user_id, email, token_hash, expires_at);
  }

  async consumeIfValid(token_hash: string, expected_type: VerificationTokenType) {
    return this.repository.consumeIfValid(token_hash, expected_type);
  }

  async invalidateAllForUser(user_id: number, token_type: VerificationTokenType) {
    return this.repository.invalidateAllForUser(user_id, token_type);
  }
}
