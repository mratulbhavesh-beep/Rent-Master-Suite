import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tenantsTable } from "./tenants";
import { generatedRentsTable } from "./generated-rents";

export const pushNotificationLogsTable = pgTable("push_notification_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  generatedRentId: integer("generated_rent_id").references(() => generatedRentsTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  billingPeriod: text("billing_period"),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushNotificationLog = typeof pushNotificationLogsTable.$inferSelect;
