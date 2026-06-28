import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, loansTable, loanPaymentsTable, propertiesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function formatLoan(l: typeof loansTable.$inferSelect, propertyName?: string | null) {
  const principal = parseFloat(String(l.principalAmount));
  const emi = parseFloat(String(l.emiAmount));
  const remaining = Math.max(0, principal - (l.paidMonths * emi));
  return {
    ...l,
    principalAmount: principal,
    interestRate: parseFloat(String(l.interestRate)),
    emiAmount: emi,
    remainingAmount: remaining,
    propertyName: propertyName ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}

router.get("/loans", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({ loan: loansTable, propertyName: propertiesTable.name })
    .from(loansTable)
    .leftJoin(propertiesTable, eq(loansTable.propertyId, propertiesTable.id));
  res.json(rows.map(r => formatLoan(r.loan, r.propertyName)));
});

router.post("/loans", requireAuth, async (req, res): Promise<void> => {
  const { lenderName, principalAmount, interestRate, emiAmount, startDate, totalMonths, propertyId, notes } = req.body;
  if (!lenderName || !principalAmount || !interestRate || !emiAmount || !startDate || !totalMonths) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [loan] = await db.insert(loansTable).values({
    lenderName, principalAmount: String(principalAmount), interestRate: String(interestRate),
    emiAmount: String(emiAmount), startDate, totalMonths, propertyId: propertyId ?? null, notes,
  }).returning();
  let propertyName: string | null = null;
  if (loan.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, loan.propertyId));
    propertyName = p?.name ?? null;
  }
  res.status(201).json(formatLoan(loan, propertyName));
});

router.patch("/loans/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["lenderName","startDate","totalMonths","status","propertyId","notes"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  for (const key of ["principalAmount","interestRate","emiAmount"]) {
    if (body[key] !== undefined) updates[key] = String(body[key]);
  }
  const [loan] = await db.update(loansTable).set(updates).where(eq(loansTable.id, id)).returning();
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  let propertyName: string | null = null;
  if (loan.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, loan.propertyId));
    propertyName = p?.name ?? null;
  }
  res.json(formatLoan(loan, propertyName));
});

router.delete("/loans/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(loansTable).where(eq(loansTable.id, id));
  res.sendStatus(204);
});

router.post("/loans/:id/payments", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { amount, paymentDate, notes } = req.body;
  if (!amount || !paymentDate) {
    res.status(400).json({ error: "Amount and paymentDate required" });
    return;
  }
  const [loan] = await db.select().from(loansTable).where(eq(loansTable.id, id));
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const [loanPayment] = await db.insert(loanPaymentsTable).values({
    loanId: id, amount: String(amount), paymentDate, notes,
  }).returning();
  const newPaidMonths = loan.paidMonths + 1;
  const newStatus = newPaidMonths >= loan.totalMonths ? "completed" : loan.status;
  await db.update(loansTable).set({ paidMonths: newPaidMonths, status: newStatus }).where(eq(loansTable.id, id));
  res.status(201).json({ ...loanPayment, amount: parseFloat(String(loanPayment.amount)), createdAt: loanPayment.createdAt.toISOString() });
});

export default router;
