import { and, eq, desc, lte } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, generatedRentsTable, businessSettingsTable, rentRevisionsTable } from "@workspace/db";
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

function computeDueDate(
  period: { start: string; end: string },
  rentCollectionType: string,
  gracePeriodDays: number
): string {
  const anchor = rentCollectionType === "advance" ? period.start : period.end;
  return addDays(anchor, gracePeriodDays);
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

// effectiveBaseRent: the current base rent to escalate from.
// This is passed explicitly so that if a manual revision fired on the same date,
// its newRent becomes the base before escalation is calculated (requirement: manual > escalation priority).
async function applyAutoEscalationIfDue(
  tenant: typeof tenantsTable.$inferSelect,
  today: string,
  effectiveBaseRent: string
): Promise<string> {
  if (!tenant.rentEscalation || tenant.escalationApply !== "automatic") {
    return effectiveBaseRent;
  }

  const freqYears = tenant.escalationFrequencyYears ?? 1;

  const [lastAutoRevision] = await db
    .select({ effectiveFrom: rentRevisionsTable.effectiveFrom })
    .from(rentRevisionsTable)
    .where(and(
      eq(rentRevisionsTable.tenantId, tenant.id),
      eq(rentRevisionsTable.changedBy, "automatic")
    ))
    .orderBy(desc(rentRevisionsTable.effectiveFrom))
    .limit(1);

  // Guard: don't double-apply if an automatic escalation already ran today
  if (lastAutoRevision?.effectiveFrom === today) {
    return effectiveBaseRent;
  }

  const referenceDate = lastAutoRevision?.effectiveFrom ?? tenant.leaseStart;
  const refMs = new Date(referenceDate + "T00:00:00Z").getTime();
  const yearsSince = (Date.now() - refMs) / (1000 * 60 * 60 * 24 * 365.25);

  if (yearsSince < freqYears) {
    return effectiveBaseRent;
  }

  // Escalate from the effective base rent (not tenant.rentAmount snapshot —
  // a manual revision on the same date takes priority as the base)
  const previousBaseRent = parseFloat(effectiveBaseRent);
  const escalationType = tenant.escalationType ?? "percentage";
  const escalationValue = parseFloat(String(tenant.escalationValue ?? 0));

  let newRent: number;
  if (escalationType === "percentage") {
    newRent = previousBaseRent * (1 + escalationValue / 100);
  } else {
    newRent = previousBaseRent + escalationValue;
  }

  await db.update(tenantsTable)
    .set({ rentAmount: String(newRent) })
    .where(eq(tenantsTable.id, tenant.id));

  const usedManualBase = parseFloat(String(tenant.rentAmount)) !== previousBaseRent;
  await db.insert(rentRevisionsTable).values({
    tenantId: tenant.id,
    previousRent: String(previousBaseRent),
    newRent: String(newRent),
    effectiveFrom: today,
    reason: `Auto-escalation: ${escalationType === "percentage" ? `${escalationValue}%` : `+₹${escalationValue}`} applied${usedManualBase ? " (base from manual revision)" : ""}`,
    changedBy: "automatic",
  });

  logger.info({ tenantId: tenant.id, previousBaseRent, newRent, usedManualBase }, "Automatic rent escalation applied mid-lease");
  return String(newRent);
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

      // ── Determine effective base rent ─────────────────────────────────────
      // Always use the latest active revision (effectiveFrom <= today) as the
      // authoritative rent, regardless of what tenant.rentAmount currently holds.
      // This handles: future-dated revisions that have now become active, and
      // cases where tenant.rentAmount was never synced after a revision.
      const [latestActiveRevision] = await db
        .select({ newRent: rentRevisionsTable.newRent })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, tenant.id),
          lte(rentRevisionsTable.effectiveFrom, today),
          eq(rentRevisionsTable.status, "active")
        ))
        .orderBy(desc(rentRevisionsTable.effectiveFrom), desc(rentRevisionsTable.id))
        .limit(1);

      const effectiveBaseRent = latestActiveRevision
        ? String(latestActiveRevision.newRent)
        : tenant.rentAmount;

      // Keep tenant.rentAmount in sync with the latest active revision
      if (latestActiveRevision &&
          parseFloat(String(latestActiveRevision.newRent)) !== parseFloat(String(tenant.rentAmount))) {
        await db.update(tenantsTable)
          .set({ rentAmount: String(latestActiveRevision.newRent) })
          .where(eq(tenantsTable.id, tenant.id));
      }

      // Apply automatic escalation if due, passing effective base so manual
      // revisions on the same date are honoured as the escalation base.
      const rentAmountForGeneration = await applyAutoEscalationIfDue(tenant, today, effectiveBaseRent);

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
        const dueDate = computeDueDate(period, rentCollectionType, gracePeriodDays);
        await db.insert(generatedRentsTable).values({
          tenantId: tenant.id,
          propertyId: tenant.propertyId,
          amount: rentAmountForGeneration,
          billingPeriodStart: period.start,
          billingPeriodEnd: period.end,
          dueDate,
          billingCycle,
          status: "pending",
          paymentId: null,
        }).onConflictDoNothing();
        generated++;
      }
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Rent generation failed for tenant");
    }
  }

  logger.info({ generated }, "Rent generation complete");
  return generated;
}
