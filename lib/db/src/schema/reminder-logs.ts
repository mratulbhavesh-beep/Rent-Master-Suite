import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { generatedRentsTable } from "./generated-rents";
import { messageTemplatesTable } from "./message-templates";

export const reminderLogsTable = pgTable("reminder_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  generatedRentId: integer("generated_rent_id").references(() => generatedRentsTable.id, { onDelete: "set null" }),
  templateId: integer("template_id").references(() => messageTemplatesTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  phone: text("phone"),
  message: text("message"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
