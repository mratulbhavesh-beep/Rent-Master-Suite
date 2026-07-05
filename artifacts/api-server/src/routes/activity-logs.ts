import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, lte, inArray } from "drizzle-orm";
import { db, activityLogsTable, propertiesTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

export async function logActivity(params: {
  userId?: number;
  userEmail?: string;
  action: string;
  entity: string;
  entityId?: number;
  description: string;
  oldData?: unknown;
  newData?: unknown;
  propertyId?: number;
  ipAddress?: string;
}) {
  try {
    await db.insert(activityLogsTable).values({
      userId: params.userId ?? null,
      userEmail: params.userEmail ?? null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      description: params.description,
      oldData: params.oldData ? (params.oldData as any) : null,
      newData: params.newData ? (params.newData as any) : null,
      propertyId: params.propertyId ?? null,
      ipAddress: params.ipAddress ?? null,
    });
  } catch {
    // never throw from logging
  }
}

router.get("/activity-logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const role = req.user!.role;
  const { fromDate, toDate, entity, action, propertyId, page, limit } = req.query as Record<string, string>;

  const userPropertyIds = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.userId, userId))
    .then(r => r.map(p => p.id));

  const conditions = [];
  if (role !== "admin") {
    if (userPropertyIds.length === 0) { res.json({ logs: [], total: 0, page: 1, pageSize: 50 }); return; }
    conditions.push(inArray(activityLogsTable.propertyId, userPropertyIds));
  }
  if (fromDate) conditions.push(gte(activityLogsTable.createdAt, new Date(fromDate)));
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(activityLogsTable.createdAt, end));
  }
  if (entity) conditions.push(eq(activityLogsTable.entity, entity));
  if (action) conditions.push(eq(activityLogsTable.action, action));
  if (propertyId) conditions.push(eq(activityLogsTable.propertyId, parseInt(propertyId)));

  const pageNum = Math.max(1, parseInt(page ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit ?? "50")));
  const offset = (pageNum - 1) * pageSize;

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [logs, countRow] = await Promise.all([
    db.select().from(activityLogsTable)
      .where(where)
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(activityLogsTable).where(where),
  ]);

  res.json({
    logs: logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    total: countRow[0]?.count ?? 0,
    page: pageNum,
    pageSize,
  });
});

router.delete("/activity-logs/:id", requireAuth, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  await db.delete(activityLogsTable).where(eq(activityLogsTable.id, id));
  res.sendStatus(204);
});

router.delete("/activity-logs", requireAuth, requireAdmin, async (_req: AuthRequest, res): Promise<void> => {
  await db.delete(activityLogsTable);
  res.sendStatus(204);
});

export default router;
