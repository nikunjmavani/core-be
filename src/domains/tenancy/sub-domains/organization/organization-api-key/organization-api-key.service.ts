import { createHash, randomBytes } from 'node:crypto';
import { NotFoundError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '../organization.repository.js';
import type { OrganizationApiKeyRepository } from './organization-api-key.repository.js';
import type {
  OrganizationApiKeyOutput,
  CreateOrganizationApiKeyResult,
  OrganizationApiKeyAuthMatch,
} from './organization-api-key.types.js';
import {
  validateCreateOrganizationApiKey,
  validateUpdateOrganizationApiKey,
  validateListOrganizationApiKeysQuery,
} from './organization-api-key.validator.js';
import { serializeOrganizationApiKey } from './organization-api-key.serializer.js';
import {
  ORGANIZATION_API_KEY_PREFIX_DISPLAY_LENGTH,
  ORGANIZATION_API_KEY_RAW_SECRET_BYTE_LENGTH,
} from '@/shared/constants/limits.constants.js';

function generateApiKey(): string {
  return `ak_${randomBytes(ORGANIZATION_API_KEY_RAW_SECRET_BYTE_LENGTH).toString('hex')}`;
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function getKeyPrefix(key: string): string {
  return key.slice(0, ORGANIZATION_API_KEY_PREFIX_DISPLAY_LENGTH);
}

export class OrganizationApiKeyService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly apiKeyRepository: OrganizationApiKeyRepository,
  ) {}

  async list(organization_public_id: string, query: unknown) {
    const parsed = validateListOrganizationApiKeysQuery(query);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const result = await this.apiKeyRepository.findByOrganizationId(
        organization.id,
        omitUndefined({
          after: parsed.after,
          limit: parsed.limit,
        }),
      );
      return {
        ...result,
        items: result.items.map((row) => serializeOrganizationApiKey(row, organization_public_id)),
      };
    });
  }

  async getByPublicId(
    organization_public_id: string,
    api_key_public_id: string,
  ): Promise<OrganizationApiKeyOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const row = await this.apiKeyRepository.findByPublicId(api_key_public_id, organization.id);
      if (!row) throw new NotFoundError('API key');
      return serializeOrganizationApiKey(row, organization_public_id);
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string,
  ): Promise<CreateOrganizationApiKeyResult> {
    const parsed = validateCreateOrganizationApiKey(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const userId =
        await this.organizationRepository.resolveUserIdByPublicId(created_by_user_public_id);
      const rawKey = generateApiKey();
      const keyHash = hashApiKey(rawKey);
      const keyPrefix = getKeyPrefix(rawKey);
      let expiresAt: Date | null = null;
      if (parsed.expires_in_days) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parsed.expires_in_days);
      }
      const row = await this.apiKeyRepository.create({
        organization_id: organization.id,
        name: parsed.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: parsed.scopes,
        expires_at: expiresAt,
        created_by_user_id: userId,
      });
      const apiKey = serializeOrganizationApiKey(row, organization_public_id);
      return { api_key: apiKey, raw_key: rawKey };
    });
  }

  async update(
    organization_public_id: string,
    api_key_public_id: string,
    body: unknown,
    updated_by_user_public_id: string,
  ): Promise<OrganizationApiKeyOutput> {
    const parsed = validateUpdateOrganizationApiKey(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const row = await this.apiKeyRepository.findByPublicId(api_key_public_id, organization.id);
      if (!row) throw new NotFoundError('API key');
      const userId =
        await this.organizationRepository.resolveUserIdByPublicId(updated_by_user_public_id);
      const updated = await this.apiKeyRepository.update(
        api_key_public_id,
        organization.id,
        omitUndefined(parsed),
        userId ?? null,
      );
      if (!updated) throw new NotFoundError('API key');
      return serializeOrganizationApiKey(updated, organization_public_id);
    });
  }

  async delete(organization_public_id: string, api_key_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const deleted = await this.apiKeyRepository.softDelete(api_key_public_id, organization.id);
      if (!deleted) throw new NotFoundError('API key');
    });
  }

  async authenticate(
    key_prefix: string,
    key_hash: string,
    hashCompare: (storedHash: string, candidateHash: string) => boolean,
  ): Promise<OrganizationApiKeyAuthMatch | null> {
    const candidates = await this.apiKeyRepository.findActiveByKeyPrefix(key_prefix);
    const now = new Date();
    for (const candidate of candidates) {
      if (!hashCompare(candidate.key_hash, key_hash)) continue;
      if (candidate.expires_at && candidate.expires_at <= now) continue;
      const organization = await this.organizationRepository.findById(candidate.organization_id);
      if (!organization) continue;
      await this.apiKeyRepository.touchLastUsedAt(candidate.public_id);
      return {
        public_id: candidate.public_id,
        organization_public_id: organization.public_id,
        scopes: candidate.scopes,
      };
    }
    return null;
  }

  async rotate(
    organization_public_id: string,
    api_key_public_id: string,
    created_by_user_public_id: string,
  ): Promise<CreateOrganizationApiKeyResult> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const existing = await this.apiKeyRepository.findByPublicId(
        api_key_public_id,
        organization.id,
      );
      if (!existing) throw new NotFoundError('API key');
      await this.apiKeyRepository.softDelete(api_key_public_id, organization.id);
      return this.create(
        organization_public_id,
        { name: existing.name, scopes: existing.scopes },
        created_by_user_public_id,
      );
    });
  }
}
