import { eq } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";

/**
 * The tenant row is the SINGLE source of truth for billing settings
 * (billingCycle / rentCollectionType / gracePeriodDays). "Use business
 * default" is resolved at WRITE time only:
 *
 * - creating or editing a tenant with useBusinessDefault=true copies the
 *   current business defaults INTO the tenant's own columns;
 * - updating business settings propagates the new defaults into every
 *   follower tenant's columns (see business-settings route).
 *
 * Nothing may resolve business defaults at read time — every reader
 * (billing engine, API responses, mobile screens) sees the same stored
 * tenant value, so screens can never disagree about e.g. Collection Type.
 */
export async function getBusinessDefaults(userId: number): Promise<{
  billingCycle: string;
  rentCollectionType: string;
  gracePeriodDays: number;
} | null> {
  const [s] = await db
    .select()
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.userId, userId));
  if (!s) return null;
  return {
    billingCycle: s.defaultBillingCycle,
    rentCollectionType: s.defaultRentCollectionType,
    gracePeriodDays: s.defaultGracePeriodDays,
  };
}
