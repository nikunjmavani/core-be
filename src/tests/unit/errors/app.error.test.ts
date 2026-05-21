import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODE_TO_SNAKE } from '@/shared/errors/app.error.js';

describe('AppError', () => {
  it('maps error codes to snake_case API codes', () => {
    expect(ERROR_CODE_TO_SNAKE.NOT_FOUND).toBe('not_found');
    expect(ERROR_CODE_TO_SNAKE.VALIDATION_ERROR).toBe('invalid_field');
    expect(ERROR_CODE_TO_SNAKE.RATE_LIMITED).toBe('rate_limited');
  });

  it('stores code, status, messageKey, and messageParams', () => {
    const error = new AppError(
      'FORBIDDEN',
      403,
      'errors:forbidden',
      { action: 'delete' },
      'Forbidden',
    );
    expect(error.code).toBe('FORBIDDEN');
    expect(error.statusCode).toBe(403);
    expect(error.messageKey).toBe('errors:forbidden');
    expect(error.messageParams).toEqual({ action: 'delete' });
    expect(error.message).toBe('Forbidden');
    expect(error.name).toBe('AppError');
  });

  it('uses messageKey as fallback message when fallback omitted', () => {
    const error = new AppError('INTERNAL_ERROR', 500, 'errors:internal');
    expect(error.message).toBe('errors:internal');
  });
});
