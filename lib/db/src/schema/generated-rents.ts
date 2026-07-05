import { pgTable, serial, timestamp, integer, numeric, date, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";

export const generatedRentsTable = pgTable("generated_rents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  billingPeriodStart: date("billing_period_start", { mode: "string" }).notNull(),
  billingPeriodEnd: date("billing_period_end", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  status: text("status").notNull().default("pending"),
  paymentId: integer("payment_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  tenantPeriodUniq: uniqueIndex("generated_rents_tenant_period_idx").on(t.tenantId, t.billingPeriodStart),
}));

export const insertGeneratedRentSchema = createInsertSchema(generatedRentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGeneratedRent = z.infer<typeof insertGeneratedRentSchema>;
export type GeneratedRent = typeof generatedRentsTable.$inferSelect;
