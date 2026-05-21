import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/validation.error.js';

describe('ValidationError', () => {
  it('sets VALIDATION_ERROR code and 400 status', () => {
    const error = new ValidationError('errors:invalidInput');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.messageKey).toBe('errors:invalidInput');
  });

  it('builds errors array from explicit items', () => {
    const error = new ValidationError('errors:invalidInput', undefined, 'Invalid input', [
      { field: 'email', message: 'Invalid email' },
    ]);
    expect(error.errors).toEqual([{ field: 'email', message: 'Invalid email' }]);
  });

  it('stores messageParams when provided', () => {
    const error = new ValidationError('errors:invalidField', { label: 'email' });
    expect(error.messageParams).toEqual({ label: 'email' });
  });

  it('builds errors array from details object when errors omitted', () => {
    const error = new ValidationError('errors:invalidInput', undefined, {
      email: ['Invalid email'],
      password: 'Too short',
    });
    expect(error.errors).toEqual([
      { field: 'email', message: 'Invalid email' },
      { field: 'password', message: 'Too short' },
    ]);
  });
});
