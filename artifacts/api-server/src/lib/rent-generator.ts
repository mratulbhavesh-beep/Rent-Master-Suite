import { eq, desc } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, generatedRentsTable, businessSettingsTable } from "@workspace/db";
import { logger } from "./logger";

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function getCycleMonths(billingCycle: string): number {
  if (billingCycle === "quarterly") return 3;
  if (billingCycle === "yearly") return 12;
  return 1; // monthly
}

function computePeriodEnd(periodStart: string, billingCycle: string): string {
  if (billingCycle === "weekly") {
    return addDays(periodStart, 6); // 7-day period: day 0 to day 6
  }
  return addDays(addMonths(periodStart, getCycleMonths(billingCycle)), -1);
}

function computePeriods(
  leaseStart: string,
  lastPeriodEnd: string | null,
  billingCycle: string,
  rentCollectionType: string,
  today: string
): Array<{ start: string; end: string }> {
  const periods: Array<{ start: string; end: string }> = [];
  let periodStart: string = lastPeriodEnd ? addDays(lastPeriodEnd, 1) : leaseStart;

  // Weekly billing can generate up to ~3 years of weekly entries as catch-up
  const MAX_PERIODS = billingCycle === "weekly" ? 156 : 48;
  let count = 0;

  while (count < MAX_PERIODS) {
    const periodEnd = computePeriodEnd(periodStart, billingCycle);
    const triggerDate = rentCollectionType === "advance" ? periodStart : periodEnd;

    if (triggerDate > today) break;

    periods.push({ start: periodStart, end: periodEnd });
    periodStart = addDays(periodEnd, 1);
    count++;
  }

  return periods;
}

export async function runRentGeneration(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  let generated = 0;

  const tenants = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .innerJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.status, "active"));

  for (const { tenant, propertyUserId } of tenants) {
    try {
      let billingCycle = tenant.billingCycle;
      let rentCollectionType = tenant.rentCollectionType;
      let gracePeriodDays = tenant.gracePeriodDays;

      if (tenant.useBusinessDefault && propertyUserId != null) {
        const [settings] = await db
          .select()
          .from(businessSettingsTable)
          .where(eq(businessSettingsTable.userId, propertyUserId));
        if (settings) {
          billingCycle = settings.defaultBillingCycle;
          rentCollectionType = settings.defaultRentCollectionType;
          gracePeriodDays = settings.defaultGracePeriodDays;
        }
      }

      const [lastRent] = await db
        .select({ billingPeriodEnd: generatedRentsTable.billingPeriodEnd })
        .from(generatedRentsTable)
        .where(eq(generatedRentsTable.tenantId, tenant.id))
        .orderBy(desc(generatedRentsTable.billingPeriodEnd))
        .limit(1);

      const lastPeriodEnd = lastRent?.billingPeriodEnd ?? null;

      const periods = computePeriods(
        tenant.leaseStart,
        lastPeriodEnd,
        billingCycle,
        rentCollectionType,
        today
      );

      for (const period of periods) {
        const dueDate = addDays(today, gracePeriodDays);
        await db.insert(generatedRentsTable).values({
          tenantId: tenant.id,
          propertyId: tenant.propertyId,
          amount: tenant.rentAmount,
          billingPeriodStart: period.start,
          billingPeriodEnd: period.end,
          dueDate,
          status: "pending",
          paymentId: null,
        });
        generated++;
      }
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Rent generation failed for tenant");
    }
  }

  logger.info({ generated }, "Rent generation complete");
  return generated;
}
