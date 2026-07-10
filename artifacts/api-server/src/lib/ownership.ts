import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";

/**
 * Property ids owned by a user — the single shared ownership-scoping helper.
 * Every route that scopes tenants/payments/rents/maintenance by property
 * ownership must use this instead of a local copy.
 */
export async function getUserPropertyIds(userId: number): Promise<number[]> {
  const props = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));
  return props.map(p => p.id);
}
