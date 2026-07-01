import { pgTable, text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const rentAgreementsTable = pgTable("rent_agreements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  agreementNumber: text("agreement_number").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  monthlyRent: numeric("monthly_rent", { precision: 12, scale: 2 }).notNull(),
  securityDeposit: numeric("security_deposit", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRentAgreementSchema = createInsertSchema(rentAgreementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentAgreement = z.infer<typeof insertRentAgreementSchema>;
export type RentAgreement = typeof rentAgreementsTable.$inferSelect;
