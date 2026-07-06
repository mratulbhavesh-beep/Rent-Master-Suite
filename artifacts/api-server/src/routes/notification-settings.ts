import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db, userNotificationSettingsTable, pushNotificationLogsTable, tenantsTable,
  DEFAULT_NOTIF_SETTINGS,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET notification settings ────────────────────────────────────────────────

router.get("/notification-settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const [settings] = await db
    .select()
    .from(userNotificationSettingsTable)
    .where(eq(userNotificationSettingsTable.userId, userId));

  if (!settings) {
    res.json({ userId, ...DEFAULT_NOTIF_SETTINGS });
    return;
  }
  res.json(settings);
});

// ─── PUT notification settings (upsert) ──────────────────────────────────────

router.put("/notification-settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const {
    rentDue3d, rentDueToday, rentOverdue, paymentReceived,
    leaseExpiry, leaseRenewal, rentEscalation,
    quietHoursEnabled, quietHoursStart, quietHoursEnd,
  } = req.body;

  const values = {
    userId,
    rentDue3d: rentDue3d ?? DEFAULT_NOTIF_SETTINGS.rentDue3d,
    rentDueToday: rentDueToday ?? DEFAULT_NOTIF_SETTINGS.rentDueToday,
    rentOverdue: rentOverdue ?? DEFAULT_NOTIF_SETTINGS.rentOverdue,
    paymentReceived: paymentReceived ?? DEFAULT_NOTIF_SETTINGS.paymentReceived,
    leaseExpiry: leaseExpiry ?? DEFAULT_NOTIF_SETTINGS.leaseExpiry,
    leaseRenewal: leaseRenewal ?? DEFAULT_NOTIF_SETTINGS.leaseRenewal,
    rentEscalation: rentEscalation ?? DEFAULT_NOTIF_SETTINGS.rentEscalation,
    quietHoursEnabled: quietHoursEnabled ?? DEFAULT_NOTIF_SETTINGS.quietHoursEnabled,
    quietHoursStart: quietHoursStart ?? DEFAULT_NOTIF_SETTINGS.quietHoursStart,
    quietHoursEnd: quietHoursEnd ?? DEFAULT_NOTIF_SETTINGS.quietHoursEnd,
    updatedAt: new Date(),
  };

  const [result] = await db
    .insert(userNotificationSettingsTable)
    .values(values)
    .onConflictDoUpdate({
      target: userNotificationSettingsTable.userId,
      set: { ...values, userId: undefined },
    })
    .returning();

  logger.info({ userId }, "Notification settings updated");
  res.json(result);
});

// ─── GET push notification audit log ─────────────────────────────────────────

router.get("/push-notification-logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const limit = Math.min(100, parseInt((req.query.limit as string) ?? "30"));
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1"));

  const rows = await db
    .select({
      log: pushNotificationLogsTable,
      tenantName: tenantsTable.name,
    })
    .from(pushNotificationLogsTable)
    .leftJoin(tenantsTable, eq(pushNotificationLogsTable.tenantId, tenantsTable.id))
    .where(eq(pushNotificationLogsTable.userId, userId))
    .orderBy(desc(pushNotificationLogsTable.sentAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json(rows.map(({ log, tenantName }) => ({
    id: log.id,
    tenantId: log.tenantId,
    tenantName: tenantName ?? null,
    generatedRentId: log.generatedRentId,
    type: log.type,
    billingPeriod: log.billingPeriod,
    status: log.status,
    errorMessage: log.errorMessage,
    sentAt: log.sentAt.toISOString(),
    createdAt: log.createdAt.toISOString(),
  })));
});

export default router;
