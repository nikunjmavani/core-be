import type { PermissionRepository } from './permission.repository.js';

export class PermissionService {
  constructor(private readonly repository: PermissionRepository) {}

  async list() {
    return this.repository.findAll();
  }
}
