import { logger } from "./logger";
import {
  db, deviceTokensTable, pushNotificationLogsTable,
  userNotificationSettingsTable, DEFAULT_NOTIF_SETTINGS,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Notification type constants ─────────────────────────────────────────────

export const NOTIF_TYPES = {
  RENT_DUE_3D: "rent_due_3d",
  RENT_DUE_TODAY: "rent_due_today",
  RENT_OVERDUE: "rent_overdue",
  PAYMENT_RECEIVED: "payment_received",
  LEASE_EXPIRY_60D: "lease_expiry_60d",
  LEASE_EXPIRY_30D: "lease_expiry_30d",
  LEASE_EXPIRY_7D: "lease_expiry_7d",
  LEASE_RENEWAL: "lease_renewal",
  RENT_ESCALATION: "rent_escalation",
} as const;

export type NotifType = typeof NOTIF_TYPES[keyof typeof NOTIF_TYPES];

// ─── Expo Push API types ──────────────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  priority?: "default" | "normal" | "high";
  channelId?: string;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

// ─── Expo Push API sender ─────────────────────────────────────────────────────

async function callExpoPushApi(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const CHUNK = 100;
  const results: ExpoPushTicket[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const resp = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
      if (!resp.ok) {
        logger.error({ status: resp.status }, "Expo Push API HTTP error");
        results.push(...chunk.map(() => ({ status: "error" as const, message: `HTTP ${resp.status}` })));
        continue;
      }
      const json = await resp.json() as { data: ExpoPushTicket[] };
      results.push(...(json.data ?? []));
    } catch (err) {
      logger.error({ err }, "Expo Push API request failed");
      results.push(...chunk.map(() => ({ status: "error" as const, message: "Network error" })));
    }
  }
  return results;
}

// ─── Notification settings helpers ───────────────────────────────────────────

type SettingsRow = {
  rentDue3d: boolean; rentDueToday: boolean; rentOverdue: boolean;
  paymentReceived: boolean; leaseExpiry: boolean; leaseRenewal: boolean;
  rentEscalation: boolean; quietHoursEnabled: boolean;
  quietHoursStart: string; quietHoursEnd: string;
};

async function getUserNotifSettings(userId: number): Promise<SettingsRow> {
  const [row] = await db
    .select()
    .from(userNotificationSettingsTable)
    .where(eq(userNotificationSettingsTable.userId, userId));
  return row ?? { userId, ...DEFAULT_NOTIF_SETTINGS };
}

function isNotifTypeEnabled(s: SettingsRow, type: NotifType): boolean {
  switch (type) {
    case "rent_due_3d":       return s.rentDue3d;
    case "rent_due_today":    return s.rentDueToday;
    case "rent_overdue":      return s.rentOverdue;
    case "payment_received":  return s.paymentReceived;
    case "lease_expiry_60d":
    case "lease_expiry_30d":
    case "lease_expiry_7d":   return s.leaseExpiry;
    case "lease_renewal":     return s.leaseRenewal;
    case "rent_escalation":   return s.rentEscalation;
    default:                  return true;
  }
}

function isInQuietHours(startStr: string, endStr: string): boolean {
  const now = new Date();
  const curr = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Overnight window e.g. 22:00 → 08:00
  if (start > end) return curr >= start || curr < end;
  return curr >= start && curr < end;
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

async function isAlreadySent(
  userId: number,
  tenantId: number | undefined,
  type: string,
  billingPeriod: string | undefined,
): Promise<boolean> {
  if (!billingPeriod || tenantId == null) return false;
  const rows = await db
    .select({ id: pushNotificationLogsTable.id })
    .from(pushNotificationLogsTable)
    .where(and(
      eq(pushNotificationLogsTable.userId, userId),
      eq(pushNotificationLogsTable.tenantId, tenantId),
      eq(pushNotificationLogsTable.type, type),
      eq(pushNotificationLogsTable.billingPeriod, billingPeriod),
      eq(pushNotificationLogsTable.status, "sent"),
    ))
    .limit(1);
  return rows.length > 0;
}

// ─── Main send function ───────────────────────────────────────────────────────

export interface SendPushOptions {
  userId: number;
  tenantId?: number;
  generatedRentId?: number;
  type: NotifType;
  billingPeriod?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendPushToUser(opts: SendPushOptions): Promise<{ sent: number; skipped: boolean }> {
  const { userId, tenantId, generatedRentId, type, billingPeriod, title, body, data } = opts;

  // Notification settings check (type enabled + quiet hours)
  const userSettings = await getUserNotifSettings(userId);
  if (!isNotifTypeEnabled(userSettings, type)) {
    logger.debug({ userId, type }, "Notification type disabled by user settings — skipping");
    return { sent: 0, skipped: true };
  }
  if (userSettings.quietHoursEnabled && isInQuietHours(userSettings.quietHoursStart, userSettings.quietHoursEnd)) {
    logger.debug({ userId, type }, "In quiet hours — skipping push notification");
    return { sent: 0, skipped: true };
  }

  // Duplicate prevention
  const skip = await isAlreadySent(userId, tenantId, type, billingPeriod);
  if (skip) {
    logger.debug({ userId, tenantId, type, billingPeriod }, "Push already sent — skipping");
    return { sent: 0, skipped: true };
  }

  // Retrieve all tokens for this user (multi-device support)
  const rows = await db
    .select({ token: deviceTokensTable.token })
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.userId, userId));

  if (rows.length === 0) {
    logger.debug({ userId, type }, "No registered device tokens — skipping");
    return { sent: 0, skipped: false };
  }

  const messages: ExpoPushMessage[] = rows.map(({ token }) => ({
    to: token,
    title,
    body,
    data: { ...data, tenantId: tenantId ?? null, screen: "tenant-detail" },
    sound: "default",
    priority: "high",
    channelId: "default",
  }));

  const tickets = await callExpoPushApi(messages);
  const successCount = tickets.filter(t => t.status === "ok").length;
  const failCount = tickets.length - successCount;

  // Record in push_notification_logs for duplicate prevention & audit
  await db.insert(pushNotificationLogsTable).values({
    userId,
    tenantId: tenantId ?? null,
    generatedRentId: generatedRentId ?? null,
    type,
    billingPeriod: billingPeriod ?? null,
    status: successCount > 0 ? "sent" : "failed",
    errorMessage: failCount > 0 ? `${failCount}/${rows.length} token(s) failed` : null,
    sentAt: new Date(),
  });

  logger.info({ userId, type, tenantId, successCount, failCount }, "Push notification dispatched");
  return { sent: successCount, skipped: false };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatAmount(amount: string | number): string {
  const n = parseFloat(String(amount));
  return `₹${n.toLocaleString("en-IN")}`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Days from today to dateStr. Negative means in the past. */
export function daysFromToday(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00Z");
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Today as ISO date string (YYYY-MM-DD) */
export function todayStr(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}
