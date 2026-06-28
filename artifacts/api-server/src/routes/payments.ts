import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, paymentsTable, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function formatPayment(p: typeof paymentsTable.$inferSelect, tenantName?: string | null, propertyName?: string | null) {
  return {
    ...p,
    amount: parseFloat(String(p.amount)),
    tenantName: tenantName ?? null,
    propertyName: propertyName ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

function generateReceiptNumber(): string {
  return `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
}

router.get("/payments", requireAuth, async (req, res): Promise<void> => {
  const { tenantId, propertyId, month, status } = req.query as { tenantId?: string; propertyId?: string; month?: string; status?: string };
  const rows = await db
    .select({ payment: paymentsTable, tenantName: tenantsTable.name, propertyName: propertiesTable.name })
    .from(paymentsTable)
    .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id));

  let results = rows;
  if (tenantId) results = results.filter(r => r.payment.tenantId === parseInt(tenantId, 10));
  if (propertyId) results = results.filter(r => r.payment.propertyId === parseInt(propertyId, 10));
  if (status) results = results.filter(r => r.payment.status === status);
  if (month) {
    const [y, m] = month.split("-").map(Number);
    results = results.filter(r => r.payment.year === y && r.payment.month === m);
  }
  res.json(results.map(r => formatPayment(r.payment, r.tenantName, r.propertyName)));
});

router.post("/payments", requireAuth, async (req, res): Promise<void> => {
  const { tenantId, propertyId, amount, paymentDate, month, year, method, status, notes } = req.body;
  if (!tenantId || !propertyId || !amount || !paymentDate || !month || !year || !method) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const receiptNumber = generateReceiptNumber();
  const [payment] = await db.insert(paymentsTable).values({
    tenantId, propertyId, amount: String(amount), paymentDate,
    month, year, method, status: status ?? "paid", notes, receiptNumber,
  }).returning();
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, payment.tenantId));
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, payment.propertyId));
  res.status(201).json(formatPayment(payment, tenant?.name, property?.name));
});

router.get("/payments/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ payment: paymentsTable, tenantName: tenantsTable.name, propertyName: propertiesTable.name })
    .from(paymentsTable)
    .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Payment not found" }); return; }
  res.json(formatPayment(row.payment, row.tenantName, row.propertyName));
});

export default router;
