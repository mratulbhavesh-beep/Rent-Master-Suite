import { pgTable, serial, timestamp, integer, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { paymentsTable } from "./payments";

export const paymentAllocationsTable = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  generatedRentId: integer("generated_rent_id").notNull(),
  allocatedAmount: numeric("allocated_amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  paymentPeriodUniq: uniqueIndex("payment_allocations_payment_period_idx").on(t.paymentId, t.generatedRentId),
  paymentIdIdx: index("payment_allocations_payment_id_idx").on(t.paymentId),
  generatedRentIdIdx: index("payment_allocations_generated_rent_id_idx").on(t.generatedRentId),
}));

export const insertPaymentAllocationSchema = createInsertSchema(paymentAllocationsTable).omit({ id: true, createdAt: true });
export type InsertPaymentAllocation = z.infer<typeof insertPaymentAllocationSchema>;
export type PaymentAllocation = typeof paymentAllocationsTable.$inferSelect;
