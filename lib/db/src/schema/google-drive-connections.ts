import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const googleDriveConnectionsTable = pgTable("google_drive_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  googleEmail: text("google_email").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  driveFileId: text("drive_file_id"),
  driveFolderId: text("drive_folder_id"),
  autoBackupEnabled: boolean("auto_backup_enabled").notNull().default(false),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  lastBackupStatus: text("last_backup_status").notNull().default("none"),
  lastBackupError: text("last_backup_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GoogleDriveConnection = typeof googleDriveConnectionsTable.$inferSelect;
export type NewGoogleDriveConnection = typeof googleDriveConnectionsTable.$inferInsert;
