import { describe, it, expect, vi } from 'vitest';
import { PermissionService } from '@/domains/tenancy/sub-domains/permission/permission.service.js';

describe('PermissionService', () => {
  it('list returns rows from the repository', async () => {
    const repository = {
      findAll: vi.fn().mockResolvedValue([
        {
          code: 'billing:read',
          name: 'Billing read',
          description: null,
          category: 'billing',
          created_at: new Date(),
        },
      ]),
    };
    const service = new PermissionService(repository as never);
    const result = await service.list();
    expect(repository.findAll).toHaveBeenCalled();
    expect(result[0]).toMatchObject({ code: 'billing:read', name: 'Billing read' });
  });
});
