import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, paymentsTable, expensesTable, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

async function getUserPropertyIds(userId: number): Promise<number[]> {
  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));
  return props.map(p => p.id);
}

router.get("/reports/monthly", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { year, month } = req.query as { year?: string; month?: string };
  if (!year || !month) { res.status(400).json({ error: "year and month required" }); return; }
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  const userPropertyIds = await getUserPropertyIds(userId);

  const payments = userPropertyIds.length > 0
    ? await db
        .select({ payment: paymentsTable, tenantName: tenantsTable.name, propertyName: propertiesTable.name })
        .from(paymentsTable)
        .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
        .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
        .where(and(
          sql`${paymentsTable.year} = ${y} AND ${paymentsTable.month} = ${m}`,
          inArray(paymentsTable.propertyId, userPropertyIds)
        ))
    : [];

  const expenses = await db
    .select({ expense: expensesTable, propertyName: propertiesTable.name })
    .from(expensesTable)
    .leftJoin(propertiesTable, eq(expensesTable.propertyId, propertiesTable.id))
    .where(and(
      sql`EXTRACT(year FROM ${expensesTable.date}) = ${y} AND EXTRACT(month FROM ${expensesTable.date}) = ${m}`,
      eq(expensesTable.userId, userId)
    ));

  const totalIncome = payments.filter(p => p.payment.status === "paid").reduce((s, p) => s + parseFloat(String(p.payment.amount)), 0);
  const totalExpenses = expenses.reduce((s, e) => s + parseFloat(String(e.expense.amount)), 0);
  const collectedRents = payments.filter(p => p.payment.status === "paid").length;
  const pendingRents = payments.filter(p => p.payment.status !== "paid").length;

  res.json({
    year: y, month: m, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses,
    collectedRents, pendingRents,
    payments: payments.map(r => ({
      ...r.payment, amount: parseFloat(String(r.payment.amount)),
      tenantName: r.tenantName ?? null, propertyName: r.propertyName ?? null,
      createdAt: r.payment.createdAt.toISOString(),
    })),
    expenses: expenses.map(r => ({
      ...r.expense, amount: parseFloat(String(r.expense.amount)),
      propertyName: r.propertyName ?? null, createdAt: r.expense.createdAt.toISOString(),
    })),
  });
});

router.get("/reports/yearly", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { year } = req.query as { year?: string };
  if (!year) { res.status(400).json({ error: "year required" }); return; }
  const y = parseInt(year, 10);

  const userPropertyIds = await getUserPropertyIds(userId);
  const payments = userPropertyIds.length > 0
    ? await db.select().from(paymentsTable)
        .where(and(sql`${paymentsTable.year} = ${y}`, inArray(paymentsTable.propertyId, userPropertyIds)))
    : [];

  const yearStart = `${y}-01-01`;
  const yearEnd = `${y}-12-31`;
  const expenses = await db.select().from(expensesTable)
    .where(and(
      gte(expensesTable.date, yearStart),
      lte(expensesTable.date, yearEnd),
      eq(expensesTable.userId, userId)
    ));

  const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1;
    const monthPayments = payments.filter(p => p.month === mo && p.status === "paid");
    const monthExpenses = expenses.filter(e => e.date.startsWith(`${y}-${String(mo).padStart(2, "0")}`));
    const income = monthPayments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
    const exp = monthExpenses.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    return { month: mo, income, expenses: exp, netProfit: income - exp };
  });

  const totalIncome = monthlyBreakdown.reduce((s, mo) => s + mo.income, 0);
  const totalExpenses = monthlyBreakdown.reduce((s, mo) => s + mo.expenses, 0);

  res.json({ year: y, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses, monthlyBreakdown });
});

export default router;
