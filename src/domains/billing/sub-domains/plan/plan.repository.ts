import { eq } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { plans } from '@/domains/billing/sub-domains/plan/plan.schema.js';

export class PlanRepository {
  async findAllActive() {
    return getRequestDatabase().select().from(plans).where(eq(plans.is_active, true));
  }

  async findByPublicId(public_id: string) {
    const rows = await getRequestDatabase()
      .select()
      .from(plans)
      .where(eq(plans.public_id, public_id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: number) {
    const rows = await getRequestDatabase().select().from(plans).where(eq(plans.id, id)).limit(1);
    return rows[0] ?? null;
  }
}
