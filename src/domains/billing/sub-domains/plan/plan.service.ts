import { NotFoundError } from '@/shared/errors/index.js';
import type { PlanRepository } from './plan.repository.js';
import type { PlanOutput } from './plan.types.js';
import type { plans } from './plan.schema.js';

export type PlanRecord = typeof plans.$inferSelect;

export class PlanService {
  constructor(private readonly repository: PlanRepository) {}

  async requirePlanRecordByPublicId(public_id: string): Promise<PlanRecord> {
    const row = await this.repository.findByPublicId(public_id);
    if (!row) throw new NotFoundError('Plan');
    return row;
  }

  async requirePlanRecordByInternalId(identifier: number): Promise<PlanRecord> {
    const row = await this.repository.findById(identifier);
    if (!row) throw new NotFoundError('Plan');
    return row;
  }

  async list(): Promise<PlanOutput[]> {
    const rows = await this.repository.findAllActive();
    return rows.map(toOutput);
  }

  async getByPublicId(public_id: string): Promise<PlanOutput> {
    const row = await this.repository.findByPublicId(public_id);
    if (!row) throw new NotFoundError('Plan');
    return toOutput(row);
  }
}

function toOutput(row: {
  public_id: string;
  name: string;
  description: string | null;
  price_monthly: string;
  price_yearly: string;
  currency: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): PlanOutput {
  return {
    id: row.public_id,
    name: row.name,
    description: row.description,
    price_monthly: String(row.price_monthly),
    price_yearly: String(row.price_yearly),
    currency: row.currency,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
