import { pgTable, serial, integer, date, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const rentRevisionsTable = pgTable("rent_revisions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  previousRent: numeric("previous_rent", { precision: 12, scale: 2 }).notNull(),
  newRent: numeric("new_rent", { precision: 12, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  reason: text("reason"),
  changedBy: text("changed_by").notNull().default("manual"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
