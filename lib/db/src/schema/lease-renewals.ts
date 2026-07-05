import { pgTable, serial, integer, date, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const leaseRenewalsTable = pgTable("lease_renewals", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  renewalDate: date("renewal_date", { mode: "string" }).notNull(),
  previousLeaseStart: date("previous_lease_start", { mode: "string" }).notNull(),
  previousLeaseEnd: date("previous_lease_end", { mode: "string" }).notNull(),
  newLeaseStart: date("new_lease_start", { mode: "string" }).notNull(),
  newLeaseEnd: date("new_lease_end", { mode: "string" }).notNull(),
  previousRent: numeric("previous_rent", { precision: 12, scale: 2 }).notNull(),
  newRent: numeric("new_rent", { precision: 12, scale: 2 }).notNull(),
  increaseAmount: numeric("increase_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  increasePercent: numeric("increase_percent", { precision: 8, scale: 4 }).notNull().default("0"),
  renewedBy: text("renewed_by").notNull().default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
