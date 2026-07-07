import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const backupsTable = pgTable("backups", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  label: text("label").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  data: jsonb("data"),
  dataEncrypted: text("data_encrypted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Backup = typeof backupsTable.$inferSelect;
