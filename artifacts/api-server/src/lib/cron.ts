import cron from "node-cron";
import { logger } from "./logger";
import { db, generatedRentsTable, tenantsTable, propertiesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { NOTIF_TYPES, sendPushToUser, formatAmount, formatDate, daysFromToday } from "./push";

// ─── Rent due / overdue reminders ─────────────────────────────────────────────

async function runRentReminders(): Promise<void> {
  const pending = await db
    .select({
      rent: generatedRentsTable,
      tenantName: tenantsTable.name,
      tenantGrace: tenantsTable.gracePeriodDays,
      unitNumber: tenantsTable.unitNumber,
      propertyName: propertiesTable.name,
      ownerId: propertiesTable.userId,
    })
    .from(generatedRentsTable)
    .innerJoin(tenantsTable, eq(generatedRentsTable.tenantId, tenantsTable.id))
    .innerJoin(propertiesTable, eq(generatedRentsTable.propertyId, propertiesTable.id))
    .where(inArray(generatedRentsTable.status, ["pending", "partial"]));

  let sent = 0;
  for (const row of pending) {
    const { rent, tenantName, tenantGrace, unitNumber, propertyName, ownerId } = row;
    if (!ownerId) continue;

    const days = daysFromToday(rent.dueDate);
    const amount = formatAmount(rent.amount);
    const dueDateStr = formatDate(rent.dueDate);
    const baseData = { propertyName, unitNumber };

    if (days === 3) {
      const r = await sendPushToUser({
        userId: ownerId,
        tenantId: rent.tenantId,
        generatedRentId: rent.id,
        type: NOTIF_TYPES.RENT_DUE_3D,
        billingPeriod: rent.billingPeriodStart,
        title: "Rent Due in 3 Days",
        body: `${tenantName} • ${unitNumber}\n${amount} due on ${dueDateStr}`,
        data: { ...baseData, tenantName },
      });
      if (r.sent > 0) sent++;
    }

    if (days === 0) {
      const r = await sendPushToUser({
        userId: ownerId,
        tenantId: rent.tenantId,
        generatedRentId: rent.id,
        type: NOTIF_TYPES.RENT_DUE_TODAY,
        billingPeriod: rent.billingPeriodStart,
        title: "Rent Due Today",
        body: `${tenantName} • ${unitNumber}\n${amount} is due today`,
        data: { ...baseData, tenantName },
      });
      if (r.sent > 0) sent++;
    }

    // Overdue = past due date + grace period
    if (days < -(tenantGrace ?? 5)) {
      const r = await sendPushToUser({
        userId: ownerId,
        tenantId: rent.tenantId,
        generatedRentId: rent.id,
        type: NOTIF_TYPES.RENT_OVERDUE,
        billingPeriod: rent.billingPeriodStart,
        title: "Rent Overdue",
        body: `${tenantName} • ${unitNumber}\n${amount} overdue by ${Math.abs(days)} days (due ${dueDateStr})`,
        data: { ...baseData, tenantName },
      });
      if (r.sent > 0) sent++;
    }
  }

  if (pending.length > 0) logger.info({ checked: pending.length, sent }, "Rent reminders dispatched");
}

// ─── Lease expiry / renewal / escalation reminders ────────────────────────────

function nextEscalationDate(leaseStart: string, frequencyYears: number): string | null {
  try {
    const start = new Date(leaseStart + "T00:00:00Z");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let y = start.getFullYear();
    for (let i = 0; i < 50; i++) {
      y += frequencyYears;
      const candidate = new Date(Date.UTC(y, start.getMonth(), start.getDate()));
      if (candidate > today) return candidate.toISOString().split("T")[0];
    }
    return null;
  } catch {
    return null;
  }
}

async function runLeaseAndEscalationReminders(): Promise<void> {
  const tenants = await db
    .select({
      tenant: tenantsTable,
      propertyName: propertiesTable.name,
      ownerId: propertiesTable.userId,
    })
    .from(tenantsTable)
    .innerJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.status, "active"));

  let sent = 0;
  for (const row of tenants) {
    const { tenant, propertyName, ownerId } = row;
    if (!ownerId) continue;

    const daysLeft = daysFromToday(tenant.leaseEnd);
    const expiryStr = formatDate(tenant.leaseEnd);
    const amount = formatAmount(tenant.rentAmount);
    const baseData = { propertyName, unitNumber: tenant.unitNumber, tenantName: tenant.name };

    // Lease expiry alerts at 60 / 30 / 7 days
    const expiryAlerts = [
      { days: 60, type: NOTIF_TYPES.LEASE_EXPIRY_60D, label: "in 60 days" },
      { days: 30, type: NOTIF_TYPES.LEASE_EXPIRY_30D, label: "in 30 days" },
      { days: 7,  type: NOTIF_TYPES.LEASE_EXPIRY_7D,  label: "in 7 days" },
    ] as const;

    for (const alert of expiryAlerts) {
      if (daysLeft === alert.days) {
        const r = await sendPushToUser({
          userId: ownerId,
          tenantId: tenant.id,
          type: alert.type,
          billingPeriod: tenant.leaseEnd,
          title: "Lease Expiring Soon",
          body: `${tenant.name} • ${tenant.unitNumber}\nLease expires ${alert.label} (${expiryStr})`,
          data: baseData,
        });
        if (r.sent > 0) sent++;
      }
    }

    // Lease renewal reminder (when autoRenewal is on, send at renewalNotice days)
    if (tenant.autoRenewal && daysLeft === tenant.renewalNotice) {
      const r = await sendPushToUser({
        userId: ownerId,
        tenantId: tenant.id,
        type: NOTIF_TYPES.LEASE_RENEWAL,
        billingPeriod: `renewal-${tenant.leaseEnd}`,
        title: "Lease Renewal Due",
        body: `${tenant.name} • ${tenant.unitNumber}\nAuto-renewal in ${tenant.renewalNotice} days (${expiryStr})`,
        data: baseData,
      });
      if (r.sent > 0) sent++;
    }

    // Rent escalation reminder — 30 days before the next escalation anniversary
    if (tenant.rentEscalation && tenant.escalationFrequencyYears > 0) {
      const nextEsc = nextEscalationDate(tenant.leaseStart, tenant.escalationFrequencyYears);
      if (nextEsc && daysFromToday(nextEsc) === 30) {
        const escYear = nextEsc.split("-")[0];
        const r = await sendPushToUser({
          userId: ownerId,
          tenantId: tenant.id,
          type: NOTIF_TYPES.RENT_ESCALATION,
          billingPeriod: `esc-${escYear}`,
          title: "Rent Escalation Due",
          body: `${tenant.name} • ${tenant.unitNumber}\nRent escalation due in 30 days\nCurrent: ${amount}`,
          data: baseData,
        });
        if (r.sent > 0) sent++;
      }
    }
  }

  if (tenants.length > 0) logger.info({ checked: tenants.length, sent }, "Lease/escalation reminders dispatched");
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

export function startCronJobs(): void {
  // Daily at 08:00 UTC (1:30 PM IST)
  cron.schedule("0 8 * * *", async () => {
    logger.info("Running daily push notification scheduler");
    try {
      await runRentReminders();
      await runLeaseAndEscalationReminders();
    } catch (err) {
      logger.error({ err }, "Push notification scheduler error");
    }
  });

  logger.info("Push notification cron jobs registered (daily at 08:00 UTC)");
}
