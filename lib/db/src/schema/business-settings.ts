import { pgTable, serial, timestamp, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const businessSettingsTable = pgTable("business_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id),
  defaultBillingCycle: text("default_billing_cycle").notNull().default("monthly"),
  defaultRentCollectionType: text("default_rent_collection_type").notNull().default("post_paid"),
  defaultGracePeriodDays: integer("default_grace_period_days").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBusinessSettingsSchema = createInsertSchema(businessSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBusinessSettings = z.infer<typeof insertBusinessSettingsSchema>;
export type BusinessSettings = typeof businessSettingsTable.$inferSelect;
