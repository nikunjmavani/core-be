import { describe, expect, it, vi } from 'vitest';
import { capListWithWarning } from '@/shared/utils/infrastructure/list-cap.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

describe('capListWithWarning', () => {
  it('returns rows unchanged and does not warn when at or under the limit', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const rows = [1, 2, 3];

    const result = capListWithWarning({ rows, limit: 3, resource: 'test.rows' });

    expect(result).toEqual([1, 2, 3]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('slices to the limit and warns when the overflow row is present', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const rows = [1, 2, 3, 4];

    const result = capListWithWarning({
      rows,
      limit: 3,
      resource: 'test.rows',
      context: { userId: 7 },
    });

    expect(result).toEqual([1, 2, 3]);
    expect(warnSpy).toHaveBeenCalledWith(
      { resource: 'test.rows', limit: 3, userId: 7 },
      'list.capped',
    );
    warnSpy.mockRestore();
  });
});
