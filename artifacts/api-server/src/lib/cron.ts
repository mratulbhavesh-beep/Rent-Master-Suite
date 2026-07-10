import cron from "node-cron";
import { logger } from "./logger";
import { db, generatedRentsTable, tenantsTable, propertiesTable, googleDriveConnectionsTable, rentRevisionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { buildLeaseContext, nextEscalationEvent, type LedgerRevision } from "@workspace/rent-calc";
import { NOTIF_TYPES, sendPushToUser, formatAmount, formatDate, daysFromToday } from "./push";
import {
  encryptString,
  decryptString,
  refreshAccessToken,
  uploadFileToDrive,
  encryptBackupContent,
} from "./gdrive";
import { gatherUserData } from "../routes/backup";

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

  // Revisions are needed so the escalation reminder reflects the SAME
  // timeline (via @workspace/rent-calc) every other screen uses.
  const tenantIds = tenants.map(r => r.tenant.id);
  const allRevisions = tenantIds.length > 0
    ? await db.select({
        tenantId: rentRevisionsTable.tenantId,
        effectiveFrom: rentRevisionsTable.effectiveFrom,
        newRent: rentRevisionsTable.newRent,
        previousRent: rentRevisionsTable.previousRent,
        status: rentRevisionsTable.status,
        changedBy: rentRevisionsTable.changedBy,
      }).from(rentRevisionsTable).where(inArray(rentRevisionsTable.tenantId, tenantIds))
    : [];
  const revisionsByTenant = new Map<number, LedgerRevision[]>();
  for (const r of allRevisions) {
    const list = revisionsByTenant.get(r.tenantId) ?? [];
    list.push(r);
    revisionsByTenant.set(r.tenantId, list);
  }

  const todayStr = new Date().toISOString().split("T")[0];
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

    // Rent escalation reminder — 30 days before the next escalation
    // anniversary, computed by the shared engine (never re-derived locally)
    // so the date AND the new amount match what every screen shows.
    if (tenant.rentEscalation) {
      const lease = buildLeaseContext(tenant, revisionsByTenant.get(tenant.id) ?? []);
      const nextEsc = nextEscalationEvent(lease, todayStr);
      if (nextEsc && daysFromToday(nextEsc.effectiveFrom) === 30) {
        const escYear = nextEsc.effectiveFrom.split("-")[0];
        const r = await sendPushToUser({
          userId: ownerId,
          tenantId: tenant.id,
          type: NOTIF_TYPES.RENT_ESCALATION,
          billingPeriod: `esc-${escYear}`,
          title: "Rent Escalation Due",
          body: `${tenant.name} • ${tenant.unitNumber}\nRent escalation due in 30 days (${formatDate(nextEsc.effectiveFrom)})\nCurrent: ${amount} → New: ${formatAmount(nextEsc.newRent)}`,
          data: baseData,
        });
        if (r.sent > 0) sent++;
      }
    }
  }

  if (tenants.length > 0) logger.info({ checked: tenants.length, sent }, "Lease/escalation reminders dispatched");
}

// ─── Google Drive auto-backup ─────────────────────────────────────────────────

async function runDriveAutoBackup(): Promise<void> {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.BACKUP_ENCRYPTION_KEY
  ) {
    logger.info("Drive auto-backup skipped: credentials not configured");
    return;
  }
  const connections = await db
    .select()
    .from(googleDriveConnectionsTable)
    .where(eq(googleDriveConnectionsTable.autoBackupEnabled, true));

  logger.info({ count: connections.length }, "Starting Drive auto-backups");

  for (const conn of connections) {
    try {
      const refreshToken = decryptString(conn.refreshTokenEnc);
      const { access_token } = await refreshAccessToken(refreshToken);
      await db
        .update(googleDriveConnectionsTable)
        .set({ accessTokenEnc: encryptString(access_token) })
        .where(eq(googleDriveConnectionsTable.id, conn.id));

      const data = await gatherUserData(conn.userId);
      const encBuf = encryptBackupContent(JSON.stringify(data));
      const fileName = `GeminiRent_Backup_uid${conn.userId}.enc`;

      const fileId = await uploadFileToDrive({
        accessToken: access_token,
        content: encBuf,
        mimeType: "application/octet-stream",
        fileName,
        fileId: conn.driveFileId ?? undefined,
      });

      await db
        .update(googleDriveConnectionsTable)
        .set({
          driveFileId: fileId,
          lastBackupAt: new Date(),
          lastBackupStatus: "success",
          lastBackupError: null,
          updatedAt: new Date(),
        })
        .where(eq(googleDriveConnectionsTable.id, conn.id));

      logger.info({ userId: conn.userId, email: conn.googleEmail }, "Drive auto-backup complete");
    } catch (err: any) {
      logger.error({ err, userId: conn.userId }, "Drive auto-backup failed for user");
      await db
        .update(googleDriveConnectionsTable)
        .set({ lastBackupStatus: "error", lastBackupError: err.message ?? "Unknown", updatedAt: new Date() })
        .where(eq(googleDriveConnectionsTable.id, conn.id))
        .catch(() => {});
    }
  }
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

export function startCronJobs(): void {
  // Daily at 08:00 UTC (1:30 PM IST) — push notifications
  cron.schedule("0 8 * * *", async () => {
    logger.info("Running daily push notification scheduler");
    try {
      await runRentReminders();
      await runLeaseAndEscalationReminders();
    } catch (err) {
      logger.error({ err }, "Push notification scheduler error");
    }
  });

  // Daily at 02:00 UTC — Google Drive auto-backup
  cron.schedule("0 2 * * *", async () => {
    logger.info("Running Google Drive auto-backup scheduler");
    try {
      await runDriveAutoBackup();
    } catch (err) {
      logger.error({ err }, "Drive auto-backup scheduler error");
    }
  });

  logger.info("Cron jobs registered (notifications at 08:00 UTC, Drive backup at 02:00 UTC)");
}
