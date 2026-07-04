import { pgTable, text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  method: text("method").notNull().default("cash"),
  status: text("status").notNull().default("paid"),
  notes: text("notes"),
  receiptNumber: text("receipt_number"),
  generatedRentId: integer("generated_rent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
