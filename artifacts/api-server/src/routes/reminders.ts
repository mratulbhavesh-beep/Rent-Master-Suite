import { Router, type IRouter } from "express";
import { and, eq, gte, lte, inArray, desc } from "drizzle-orm";
import {
  db, messageTemplatesTable, reminderLogsTable,
  generatedRentsTable, tenantsTable, propertiesTable, businessSettingsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { sendWhatsApp, interpolate, isTwilioConfigured } from "../lib/whatsapp";
import { logActivity } from "./activity-logs";

const router: IRouter = Router();

export async function runDailyReminders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];
  const in3Days = new Date(today);
  in3Days.setDate(in3Days.getDate() + 3);
  const in3DaysStr = in3Days.toISOString().split("T")[0];

  const templates = await db.select().from(messageTemplatesTable).where(eq(messageTemplatesTable.isActive, true));
  const tplMap = Object.fromEntries(templates.map(t => [t.type, t]));

  const pendingRents = await db
    .select({
      rent: generatedRentsTable,
      tenant: tenantsTable,
      property: propertiesTable,
    })
    .from(generatedRentsTable)
    .leftJoin(tenantsTable, eq(generatedRentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(generatedRentsTable.propertyId, propertiesTable.id))
    .where(
      and(
        inArray(generatedRentsTable.status, ["pending", "overdue"]),
        lte(generatedRentsTable.dueDate, in3DaysStr),
      )
    );

  let sent = 0;
  for (const row of pendingRents) {
    if (!row.tenant?.phone || !row.rent.dueDate) continue;
    const dueDate = row.rent.dueDate;
    const overdueDays = Math.max(0, Math.floor((today.getTime() - new Date(dueDate).getTime()) / 86400000));
    const isToday = dueDate === todayStr;
    const is3Days = dueDate === in3DaysStr;
    const isOverdue = overdueDays > 0;

    let type: string;
    if (isOverdue) type = "reminder_overdue";
    else if (isToday) type = "reminder_due";
    else if (is3Days) type = "reminder_3days";
    else continue;

    const alreadySent = await db.select({ id: reminderLogsTable.id })
      .from(reminderLogsTable)
      .where(
        and(
          eq(reminderLogsTable.generatedRentId, row.rent.id),
          eq(reminderLogsTable.type, type),
          ...(isOverdue ? [eq(db.$count(reminderLogsTable) as any, 0)] : []),
        )
      )
      .limit(1);

    if (!isOverdue && alreadySent.length > 0) continue;

    const tpl = tplMap[type];
    if (!tpl) continue;

    const propUserId = row.property?.userId;
    if (propUserId == null) continue;
    const settings = await db.select().from(businessSettingsTable)
      .where(eq(businessSettingsTable.userId, propUserId)).limit(1);

    const ownerName = row.property?.name ?? "Your Landlord";
    const vars: Record<string, string> = {
      tenantName: row.tenant.name,
      amount: parseFloat(String(row.rent.amount)).toLocaleString("en-IN"),
      property: row.property?.name ?? "",
      unit: row.tenant.unitNumber ?? "",
      dueDate,
      ownerName,
      overdueDays: String(overdueDays),
    };

    const message = interpolate(tpl.body, vars);
    const result = await sendWhatsApp(row.tenant.phone, message);
    const status = "error" in result ? "failed" : "sent";

    await db.insert(reminderLogsTable).values({
      tenantId: row.tenant.id,
      generatedRentId: row.rent.id,
      templateId: tpl.id,
      type,
      phone: row.tenant.phone,
      message,
      status,
      error: "error" in result ? result.error : null,
      sentAt: status === "sent" ? new Date() : null,
    });
    sent++;
  }
  return sent;
}

router.get("/reminders/templates", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const templates = await db.select().from(messageTemplatesTable).orderBy(messageTemplatesTable.id);
  res.json(templates.map(t => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  })));
});

router.put("/reminders/templates/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const { name, body, isActive } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (body !== undefined) updates.body = body;
  if (isActive !== undefined) updates.isActive = isActive;
  const [tpl] = await db.update(messageTemplatesTable).set(updates).where(eq(messageTemplatesTable.id, id)).returning();
  if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
  await logActivity({
    userId: req.user!.id, userEmail: req.user!.email,
    action: "update", entity: "message_template", entityId: id,
    description: `Updated message template: ${tpl.name}`,
  });
  res.json({ ...tpl, createdAt: tpl.createdAt.toISOString(), updatedAt: tpl.updatedAt.toISOString() });
});

router.post("/reminders/send", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { tenantId, type, message: customMessage, phone } = req.body;
  if (!tenantId || !type) { res.status(400).json({ error: "tenantId and type are required" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const toPhone = phone ?? tenant.phone;
  if (!toPhone) { res.status(400).json({ error: "No phone number available for this tenant" }); return; }

  const msg = customMessage ?? `Reminder from your landlord for ${tenant.name}`;
  const result = await sendWhatsApp(toPhone, msg);
  const status = "error" in result ? "failed" : "sent";

  const [log] = await db.insert(reminderLogsTable).values({
    tenantId, type, phone: toPhone, message: msg,
    status, error: "error" in result ? result.error : null,
    sentAt: status === "sent" ? new Date() : null,
  }).returning();

  await logActivity({
    userId: req.user!.id, userEmail: req.user!.email,
    action: "send", entity: "reminder", entityId: log.id,
    description: `Manual WhatsApp reminder sent to ${tenant.name} (${toPhone})`,
  });

  res.json({ ...log, sentAt: log.sentAt?.toISOString() ?? null, createdAt: log.createdAt.toISOString() });
});

router.get("/reminders/logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { tenantId, status, page } = req.query as Record<string, string>;

  const userPropertyIds = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.userId, userId))
    .then(r => r.map(p => p.id));

  const tenantIds = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(inArray(tenantsTable.propertyId, userPropertyIds))
    .then(r => r.map(t => t.id));

  if (tenantIds.length === 0) { res.json([]); return; }

  const conditions: ReturnType<typeof eq>[] = [inArray(reminderLogsTable.tenantId, tenantIds)];
  if (tenantId) conditions.push(eq(reminderLogsTable.tenantId, parseInt(tenantId)) as any);
  if (status) conditions.push(eq(reminderLogsTable.status, status) as any);

  const pageNum = Math.max(1, parseInt(page ?? "1"));
  const logs = await db.select().from(reminderLogsTable)
    .where(and(...conditions))
    .orderBy(desc(reminderLogsTable.createdAt))
    .limit(50)
    .offset((pageNum - 1) * 50);

  res.json(logs.map(l => ({
    ...l,
    sentAt: l.sentAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
  })));
});

router.get("/reminders/configured", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.json({ configured: isTwilioConfigured() });
});

router.post("/reminders/run", requireAuth, requireAdmin, async (_req: AuthRequest, res): Promise<void> => {
  const sent = await runDailyReminders();
  res.json({ sent });
});

export default router;
