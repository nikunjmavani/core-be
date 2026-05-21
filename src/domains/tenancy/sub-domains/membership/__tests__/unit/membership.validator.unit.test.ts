import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateCreateMembership,
  validateListMembershipsQuery,
  validateTransferOwnership,
  validateUpdateMembership,
} from '@/domains/tenancy/sub-domains/membership/membership.validator.js';

describe('membership validators', () => {
  it('validateCreateMembership accepts user_id and role_id', () => {
    expect(
      validateCreateMembership({ user_id: 'userpublicid1234567', role_id: 'rolepublicid1234567' }),
    ).toMatchObject({
      user_id: 'userpublicid1234567',
      role_id: 'rolepublicid1234567',
    });
  });

  it('validateUpdateMembership accepts status', () => {
    expect(validateUpdateMembership({ status: 'ACTIVE' })).toEqual({ status: 'ACTIVE' });
  });

  it('validateListMembershipsQuery applies defaults', () => {
    expect(validateListMembershipsQuery({})).toMatchObject({ limit: 25 });
  });

  it('validateTransferOwnership accepts new_owner_user_id', () => {
    expect(validateTransferOwnership({ new_owner_user_id: 'newownerpublicid12' })).toEqual({
      new_owner_user_id: 'newownerpublicid12',
    });
  });

  it('validateCreateMembership throws for missing fields', () => {
    expect(() => validateCreateMembership({})).toThrow(ValidationError);
  });

  it('validateUpdateMembership rejects invalid status', () => {
    expect(() => validateUpdateMembership({ status: 'DELETED' })).toThrow(ValidationError);
  });
});
