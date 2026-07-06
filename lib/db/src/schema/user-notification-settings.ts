import { pgTable, boolean, timestamp, integer, text } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userNotificationSettingsTable = pgTable("user_notification_settings", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  rentDue3d: boolean("rent_due_3d").notNull().default(true),
  rentDueToday: boolean("rent_due_today").notNull().default(true),
  rentOverdue: boolean("rent_overdue").notNull().default(true),
  paymentReceived: boolean("payment_received").notNull().default(true),
  leaseExpiry: boolean("lease_expiry").notNull().default(true),
  leaseRenewal: boolean("lease_renewal").notNull().default(true),
  rentEscalation: boolean("rent_escalation").notNull().default(true),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
  quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("08:00"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserNotificationSettings = typeof userNotificationSettingsTable.$inferSelect;

export const DEFAULT_NOTIF_SETTINGS = {
  rentDue3d: true,
  rentDueToday: true,
  rentOverdue: true,
  paymentReceived: true,
  leaseExpiry: true,
  leaseRenewal: true,
  rentEscalation: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
} as const;
