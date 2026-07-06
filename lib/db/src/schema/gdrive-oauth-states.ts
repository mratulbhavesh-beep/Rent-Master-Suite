import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const gdriveOauthStatesTable = pgTable("gdrive_oauth_states", {
  state: text("state").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  googleEmail: text("google_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GdriveOauthState = typeof gdriveOauthStatesTable.$inferSelect;
