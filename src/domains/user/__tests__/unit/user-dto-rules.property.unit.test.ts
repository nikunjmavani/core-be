import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { AdminUpdateUserDto, UpdateMeDto } from '@/domains/user/user.dto.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

/**
 * Layer 2 (property) for the user DTO rules that are defined by a boundary, not an example: the
 * admin status vocabulary (ACTIVE/SUSPENDED — `DELETED` must be unreachable through PATCH, only
 * the delete endpoint's soft-delete + offboarding path may set it), the strict unknown-key
 * refusal, the name-length caps, and the avatar-key namespace + traversal rules that keep a
 * self-service profile update from pointing at another user's object.
 */

const nonEmptyName = fc.stringMatching(/^[A-Za-z][A-Za-z .'-]{0,60}$/);

describe('AdminUpdateUserDto status vocabulary (property)', () => {
  it('rejects every status outside ACTIVE/SUSPENDED — DELETED stays unreachable however it is spelled', () => {
    const forbiddenStatus = fc.oneof(
      fc.constantFrom('DELETED', 'deleted', 'Deleted', 'ACTIVE ', ' active', 'INVITED', 'BANNED'),
      fc.stringMatching(/^[A-Za-z_]{1,16}$/).filter((s) => s !== 'ACTIVE' && s !== 'SUSPENDED'),
    );
    fc.assert(
      fc.property(forbiddenStatus, (status) => {
        const result = AdminUpdateUserDto.safeParse({ status });
        // A widened enum here would let an admin PATCH bypass the delete endpoint's
        // offboarding (session revocation, S3 reclamation, tombstone).
        expect(result.success).toBe(false);
      }),
      propertyOptions,
    );
  });

  it('accepts every subset of the legal fields, and any unknown key poisons the whole body', () => {
    const legalBody = fc.record(
      {
        first_name: nonEmptyName,
        last_name: nonEmptyName,
        status: fc.constantFrom('ACTIVE', 'SUSPENDED'),
      },
      { requiredKeys: [] },
    );
    const unknownKey = fc
      .stringMatching(/^[a-z_]{1,20}$/)
      .filter((key) => !['first_name', 'last_name', 'status', '__proto__'].includes(key));
    fc.assert(
      fc.property(legalBody, unknownKey, (body, extra) => {
        expect(AdminUpdateUserDto.safeParse(body).success).toBe(true);
        expect(AdminUpdateUserDto.safeParse({ ...body, [extra]: 'x' }).success).toBe(false);
      }),
      propertyOptions,
    );
  });
});

describe('UpdateMeDto bounds (property)', () => {
  it('rejects any over-cap name and accepts the same value at the cap, however composed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('first_name', 'last_name'),
        fc.integer({ min: 101, max: 300 }),
        (field, overLength) => {
          expect(UpdateMeDto.safeParse({ [field]: 'a'.repeat(overLength) }).success).toBe(false);
          // The boundary from both sides in one property: the cap itself is legal.
          expect(UpdateMeDto.safeParse({ [field]: 'a'.repeat(100) }).success).toBe(true);
        },
      ),
      propertyOptions,
    );
  });

  it('accepts only avatars/-namespaced keys and refuses every traversal composition', () => {
    const keyBody = fc.stringMatching(/^[a-z0-9/_-]{1,64}$/);
    fc.assert(
      fc.property(keyBody, (body) => {
        // Outside the namespace → refused, whatever the rest of the key looks like.
        expect(UpdateMeDto.safeParse({ avatar_key: `uploads/${body}` }).success).toBe(false);
        // Inside the namespace with a traversal segment anywhere → refused. This is the rule
        // that stops `avatars/../organization-logos/…` re-pointing a profile at another
        // owner's object.
        expect(UpdateMeDto.safeParse({ avatar_key: `avatars/../${body}` }).success).toBe(false);
        expect(UpdateMeDto.safeParse({ avatar_key: `avatars/${body}/../x` }).success).toBe(false);
      }),
      propertyOptions,
    );
  });

  it('accepts any traversal-free key under avatars/', () => {
    const safeSegment = fc.stringMatching(/^[a-z0-9_-]{1,24}$/);
    fc.assert(
      fc.property(fc.array(safeSegment, { minLength: 1, maxLength: 4 }), (segments) => {
        const key = `avatars/${segments.join('/')}`;
        // Non-vacuity: the namespace + traversal rules must not collapse into deny-all.
        expect(UpdateMeDto.safeParse({ avatar_key: key }).success).toBe(true);
      }),
      propertyOptions,
    );
  });
});
