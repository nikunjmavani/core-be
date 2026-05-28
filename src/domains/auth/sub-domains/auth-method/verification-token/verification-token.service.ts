import type {
  VerificationTokenRepository,
  VerificationTokenType,
} from './verification-token.repository.js';

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

  async consumeIfValid(token_hash: string) {
    return this.repository.consumeIfValid(token_hash);
  }

  async invalidateAllForUser(user_id: number, token_type: VerificationTokenType) {
    return this.repository.invalidateAllForUser(user_id, token_type);
  }
}
