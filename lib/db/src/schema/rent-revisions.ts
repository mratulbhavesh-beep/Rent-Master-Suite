import { pgTable, serial, integer, date, numeric, text, timestamp, boolean } from "drizzle-orm/pg-core";
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
  // Tracks whether this manual revision has already promoted
  // tenant.rentAmount to its newRent. Immediate revisions (effectiveFrom <=
  // today at creation) are marked applied right away by the Revise
  // endpoint; future-dated ones are promoted later by
  // promoteEffectiveManualRevisions once their effective date arrives. This
  // flag (not just "effectiveFrom <= today") is what prevents re-promoting
  // over a landlord's later Edit Tenant correction.
  appliedToCurrentRent: boolean("applied_to_current_rent").notNull().default(false),
});
