import { Router, type IRouter } from "express";
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db, messageTemplatesTable, reminderLogsTable,
  tenantsTable, propertiesTable,
} from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { logActivity } from "./activity-logs";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Templates — CRUD (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATES = [
  {
    name: "3-Day Advance Reminder",
    type: "reminder_3days",
    body: "Hi {{tenantName}}, your rent of ₹{{amount}} for {{property}} (Unit {{unit}}) is due on {{dueDate}}. Please arrange payment to avoid late fees. Thank you! — {{ownerName}}",
    variables: ["tenantName", "amount", "property", "unit", "dueDate", "ownerName"],
    isActive: true,
  },
  {
    name: "Due-Date Reminder",
    type: "reminder_due",
    body: "Hi {{tenantName}}, your rent of ₹{{amount}} for {{property}} (Unit {{unit}}) is DUE TODAY ({{dueDate}}). Please pay immediately to avoid penalties. — {{ownerName}}",
    variables: ["tenantName", "amount", "property", "unit", "dueDate", "ownerName"],
    isActive: true,
  },
  {
    name: "Overdue Reminder",
    type: "reminder_overdue",
    body: "Hi {{tenantName}}, your rent of ₹{{amount}} for {{property}} (Unit {{unit}}) was due on {{dueDate}} and is now OVERDUE by {{overdueDays}} day(s). Please pay immediately. — {{ownerName}}",
    variables: ["tenantName", "amount", "property", "unit", "dueDate", "ownerName", "overdueDays"],
    isActive: true,
  },
  {
    name: "Payment Receipt",
    type: "receipt_whatsapp",
    body: "Payment Received ✅\nTenant: {{tenantName}}\nProperty: {{property}} (Unit {{unit}})\nAmount: ₹{{amount}}\nDate: {{paymentDate}}\nMode: {{method}}\nReceipt No: {{receiptNumber}}\nThank you! — {{ownerName}}",
    variables: ["tenantName", "property", "unit", "amount", "paymentDate", "method", "receiptNumber", "ownerName"],
    isActive: true,
  },
] as const;

router.get("/reminders/templates", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  let templates = await db.select().from(messageTemplatesTable).orderBy(messageTemplatesTable.id);
  // Auto-seed default templates on first use (production DB starts empty — no migration seed)
  if (templates.length === 0) {
    templates = await db.insert(messageTemplatesTable).values(DEFAULT_TEMPLATES.map(t => ({ ...t, variables: [...t.variables] }))).returning();
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Log a reminder share attempt (called by mobile after sharing)
// status: "shared" | "share_sheet" | "cancelled"
// No Twilio, no auto-send — pure history record.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/reminders/send", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { tenantId, type, message, phone, status = "shared", generatedRentId, templateId } = req.body;
  if (!tenantId || !type) {
    res.status(400).json({ error: "tenantId and type are required" });
    return;
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const toPhone = phone ?? tenant.phone;
  const validStatus = ["shared", "share_sheet", "cancelled", "sent", "failed"].includes(status)
    ? status
    : "shared";

  const [log] = await db.insert(reminderLogsTable).values({
    tenantId,
    type,
    phone: toPhone,
    message: message ?? null,
    status: validStatus,
    error: null,
    sentAt: validStatus !== "cancelled" ? new Date() : null,
    generatedRentId: generatedRentId ?? null,
    templateId: templateId ?? null,
  }).returning();

  if (validStatus === "shared" || validStatus === "share_sheet") {
    await logActivity({
      userId: req.user!.id, userEmail: req.user!.email,
      action: "send", entity: "reminder", entityId: log.id,
      description: `WhatsApp reminder shared with ${tenant.name} (${toPhone}) via ${validStatus === "shared" ? "WhatsApp" : "Share Sheet"}`,
    });
  }

  res.json({ ...log, sentAt: log.sentAt?.toISOString() ?? null, createdAt: log.createdAt.toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logs
// ─────────────────────────────────────────────────────────────────────────────

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
  const logs = await db.select({
    log: reminderLogsTable,
    tenantName: tenantsTable.name,
  })
    .from(reminderLogsTable)
    .leftJoin(tenantsTable, eq(reminderLogsTable.tenantId, tenantsTable.id))
    .where(and(...conditions))
    .orderBy(desc(reminderLogsTable.createdAt))
    .limit(50)
    .offset((pageNum - 1) * 50);

  res.json(logs.map(({ log: l, tenantName }) => ({
    ...l,
    tenantName: tenantName ?? null,
    sentAt: l.sentAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
  })));
});

// ─────────────────────────────────────────────────────────────────────────────
// Config — always ready; no external service needed
// ─────────────────────────────────────────────────────────────────────────────

router.get("/reminders/configured", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.json({ configured: true, method: "whatsapp_share" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual run — kept for admin use but no-op (returns 0 auto-sent)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/reminders/run", requireAuth, requireAdmin, async (_req: AuthRequest, res): Promise<void> => {
  res.json({ sent: 0, note: "Auto-send is disabled. Use Share via WhatsApp from the app." });
});

export default router;
