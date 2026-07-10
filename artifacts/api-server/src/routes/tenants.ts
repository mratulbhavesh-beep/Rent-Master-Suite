import { Router, type IRouter } from "express";
import { and, eq, inArray, desc, lt, sql } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, paymentsTable, maintenanceRequestsTable, rentAgreementsTable, tenantDocumentsTable, leaseRenewalsTable, rentRevisionsTable, generatedRentsTable } from "@workspace/db";
import { computeLedgerSummary, computeMonthHistory, getActiveRent, buildDisplayRevisionHistory, buildLeaseContext, nextEscalationEvent, type LedgerEntry, type LedgerPayment, type LedgerRevision, type LeaseContext } from "@workspace/rent-calc";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { runRentGenerationForTenant, resyncTenantLedger, rebuildTenantBilling } from "../lib/rent-generator";
import { getBusinessDefaults } from "../lib/business-defaults";
import { getUserPropertyIds } from "../lib/ownership";

const router: IRouter = Router();

/**
 * Balance figures (Total Expected / Total Paid / Balance Due / Advance Balance)
 * are always derived from the shared @workspace/rent-calc module, which is the
 * single source of truth for every screen (Dashboard, Reports, Rent Ledger list,
 * Rent Ledger detail / Month History, Tenant Details). Do not re-derive these
 * numbers locally anywhere else in the app.
 */
function computeBalanceFromLedger(
  generatedRents: LedgerEntry[],
  payments: LedgerPayment[],
  today: string,
  lease?: LeaseContext
) {
  return computeLedgerSummary(generatedRents, payments, today, lease);
}

// LeaseContext construction lives in @workspace/rent-calc (buildLeaseContext)
// — the ONE shared builder used by every server module. Never inline it.

function formatTenant(
  t: typeof tenantsTable.$inferSelect,
  propertyName: string | null | undefined,
  payments: { amount: string | number; month?: number | null; year?: number | null }[] = [],
  latestAgreement?: { endDate: string } | null,
  generatedRents: LedgerEntry[] = [],
  revisions: LedgerRevision[] = []
) {
  const today = new Date().toISOString().split("T")[0];
  const lease = buildLeaseContext(t, revisions);
  const nextEscalation = nextEscalationEvent(lease, today);
  return {
    ...t,
    // "Current Rent" is tenant.rentAmount itself — the single source of
    // truth, always directly editable via Edit Tenant. It is intentionally
    // NOT recomputed from the revision timeline here: Rent Revision History
    // is an audit log for display, and must never override what the
    // landlord has set as the current rent.
    rentAmount: parseFloat(String(t.rentAmount)),
    securityDeposit: t.securityDeposit != null ? parseFloat(String(t.securityDeposit)) : null,
    depositStatus: t.depositStatus ?? "held",
    propertyName: propertyName ?? null,
    createdAt: t.createdAt.toISOString(),
    // Escalation preview comes from the shared engine — the mobile app must
    // display these, never recompute its own escalation formula.
    nextEscalationDate: nextEscalation?.effectiveFrom ?? null,
    escalatedRentPreview: nextEscalation?.newRent ?? null,
    ...computeBalanceFromLedger(generatedRents, payments, today, lease),
    activeAgreementEndDate: latestAgreement?.endDate ?? null,
    activeAgreementStatus: latestAgreement
      ? (latestAgreement.endDate >= today ? "active" : "expired")
      : null,
  };
}

router.get("/tenants", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { search, propertyId, expiringIn30Days } = req.query as {
    search?: string;
    propertyId?: string;
    expiringIn30Days?: string;
  };

  const userPropertyIds = await getUserPropertyIds(userId);
  if (userPropertyIds.length === 0) { res.json([]); return; }

  const rows = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(inArray(tenantsTable.propertyId, userPropertyIds));

  let results = rows;
  if (propertyId) results = results.filter(r => r.tenant.propertyId === parseInt(propertyId, 10));
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(r =>
      r.tenant.name.toLowerCase().includes(s) ||
      r.tenant.email.toLowerCase().includes(s) ||
      r.tenant.phone.includes(s)
    );
  }

  const tenantIds = results.map(r => r.tenant.id);

  const [allPayments, allAgreements, allGeneratedRents, allRevisions] = await Promise.all([
    tenantIds.length > 0
      ? db.select({ tenantId: paymentsTable.tenantId, amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
          .from(paymentsTable).where(inArray(paymentsTable.tenantId, tenantIds))
      : Promise.resolve([]),
    tenantIds.length > 0
      ? db.select({ tenantId: rentAgreementsTable.tenantId, endDate: rentAgreementsTable.endDate })
          .from(rentAgreementsTable).where(inArray(rentAgreementsTable.tenantId, tenantIds))
      : Promise.resolve([]),
    tenantIds.length > 0
      ? db.select({
          tenantId: generatedRentsTable.tenantId,
          amount: generatedRentsTable.amount,
          dueDate: generatedRentsTable.dueDate,
          status: generatedRentsTable.status,
          billingPeriodStart: generatedRentsTable.billingPeriodStart,
        }).from(generatedRentsTable).where(inArray(generatedRentsTable.tenantId, tenantIds))
      : Promise.resolve([]),
    tenantIds.length > 0
      ? db.select({
          tenantId: rentRevisionsTable.tenantId,
          effectiveFrom: rentRevisionsTable.effectiveFrom,
          newRent: rentRevisionsTable.newRent,
          previousRent: rentRevisionsTable.previousRent,
          status: rentRevisionsTable.status,
          changedBy: rentRevisionsTable.changedBy,
        }).from(rentRevisionsTable).where(inArray(rentRevisionsTable.tenantId, tenantIds))
      : Promise.resolve([]),
  ]);

  const paymentsByTenant = new Map<number, { amount: string | number; month?: number | null; year?: number | null }[]>();
  for (const p of allPayments) {
    if (!paymentsByTenant.has(p.tenantId)) paymentsByTenant.set(p.tenantId, []);
    paymentsByTenant.get(p.tenantId)!.push({ amount: p.amount, month: p.month, year: p.year });
  }

  const agreementByTenant = new Map<number, { endDate: string }>();
  for (const a of allAgreements) {
    const existing = agreementByTenant.get(a.tenantId);
    if (!existing || a.endDate > existing.endDate) {
      agreementByTenant.set(a.tenantId, { endDate: a.endDate });
    }
  }

  const rentsByTenant = new Map<number, LedgerEntry[]>();
  for (const r of allGeneratedRents) {
    if (!rentsByTenant.has(r.tenantId)) rentsByTenant.set(r.tenantId, []);
    rentsByTenant.get(r.tenantId)!.push({
      amount: r.amount,
      dueDate: r.dueDate,
      status: r.status,
      billingPeriodStart: r.billingPeriodStart,
    });
  }

  const revisionsByTenant = new Map<number, LedgerRevision[]>();
  for (const r of allRevisions) {
    if (!revisionsByTenant.has(r.tenantId)) revisionsByTenant.set(r.tenantId, []);
    revisionsByTenant.get(r.tenantId)!.push({
      effectiveFrom: r.effectiveFrom,
      newRent: r.newRent,
      previousRent: r.previousRent,
      status: r.status,
      changedBy: r.changedBy,
    });
  }

  if (expiringIn30Days === "true") {
    const today = new Date().toISOString().split("T")[0];
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    results = results.filter(r => {
      const agr = agreementByTenant.get(r.tenant.id);
      return agr && agr.endDate >= today && agr.endDate <= in30Days;
    });
  }

  res.json(results.map(r =>
    formatTenant(
      r.tenant,
      r.propertyName,
      paymentsByTenant.get(r.tenant.id) ?? [],
      agreementByTenant.get(r.tenant.id),
      rentsByTenant.get(r.tenant.id) ?? [],
      revisionsByTenant.get(r.tenant.id) ?? []
    )
  ));
});

router.post("/tenants", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const {
    name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd, rentAmount, status,
    emergencyContact, notes, securityDeposit, depositDate, depositStatus,
    billingCycle, rentCollectionType, gracePeriodDays, useBusinessDefault,
    rentEscalation, escalationFrequencyYears, escalationType, escalationValue, escalationApply,
    autoRenewal, renewalDuration, customRenewalValue, customRenewalUnit, renewalNotice,
  } = req.body;
  if (!name || !email || !phone || !propertyId || !unitNumber || !leaseStart || !leaseEnd || !rentAmount) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
  if (!property) { res.status(403).json({ error: "Property not found" }); return; }

  // Billing settings source of truth is the tenant row. When the tenant
  // follows business defaults, those defaults are COPIED into the row here
  // (write-time materialization) — never resolved at read time. An explicit
  // billing field means a custom override, which turns the flag off unless
  // the client explicitly says otherwise.
  const hasExplicitBilling = billingCycle != null || rentCollectionType != null || gracePeriodDays != null;
  const followsDefaults = useBusinessDefault ?? !hasExplicitBilling;
  let storedBillingCycle = billingCycle ?? "monthly";
  let storedCollectionType = rentCollectionType ?? "post_paid";
  let storedGraceDays = gracePeriodDays ?? 5;
  if (followsDefaults) {
    const defaults = await getBusinessDefaults(userId);
    if (defaults) {
      storedBillingCycle = defaults.billingCycle;
      storedCollectionType = defaults.rentCollectionType;
      storedGraceDays = defaults.gracePeriodDays;
    }
  }

  const [tenant] = await db.insert(tenantsTable).values({
    name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd,
    rentAmount: String(rentAmount), status: status ?? "active", emergencyContact, notes,
    securityDeposit: securityDeposit != null ? String(securityDeposit) : undefined,
    depositDate: depositDate ?? undefined,
    depositStatus: depositStatus ?? "held",
    billingCycle: storedBillingCycle,
    rentCollectionType: storedCollectionType,
    gracePeriodDays: storedGraceDays,
    useBusinessDefault: followsDefaults,
    rentEscalation: rentEscalation ?? false,
    escalationFrequencyYears: escalationFrequencyYears ?? undefined,
    escalationType: escalationType ?? undefined,
    escalationValue: escalationValue != null ? String(escalationValue) : undefined,
    escalationApply: escalationApply ?? undefined,
    autoRenewal: autoRenewal ?? false,
    renewalDuration: renewalDuration ?? undefined,
    customRenewalValue: customRenewalValue ?? undefined,
    customRenewalUnit: customRenewalUnit ?? undefined,
    renewalNotice: renewalNotice ?? undefined,
  }).returning();

  // Backfill rent periods immediately instead of waiting for the next
  // scheduled cron run — applies identically to advance and post-paid
  // tenants (collection type only affects due-date anchoring inside
  // rent-generator, not whether/when generation runs).
  try {
    await runRentGenerationForTenant(tenant.id);
  } catch (err) {
    logger.error({ err, tenantId: tenant.id }, "Immediate rent generation failed for new tenant");
  }

  res.status(201).json(formatTenant(tenant, property.name, []));
});

router.get("/tenants/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  const [payments, agreements, generatedRents, revisions] = await Promise.all([
    db.select({ amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
      .from(paymentsTable).where(eq(paymentsTable.tenantId, id)),
    db.select({ endDate: rentAgreementsTable.endDate })
      .from(rentAgreementsTable).where(eq(rentAgreementsTable.tenantId, id)),
    db.select({
        amount: generatedRentsTable.amount,
        dueDate: generatedRentsTable.dueDate,
        status: generatedRentsTable.status,
        billingPeriodStart: generatedRentsTable.billingPeriodStart,
      }).from(generatedRentsTable).where(eq(generatedRentsTable.tenantId, id)),
    db.select({
        effectiveFrom: rentRevisionsTable.effectiveFrom,
        newRent: rentRevisionsTable.newRent,
        previousRent: rentRevisionsTable.previousRent,
        status: rentRevisionsTable.status,
        changedBy: rentRevisionsTable.changedBy,
      }).from(rentRevisionsTable).where(eq(rentRevisionsTable.tenantId, id)),
  ]);
  const latestAgreement = agreements.length > 0
    ? agreements.reduce((best, a) => a.endDate > best.endDate ? a : best)
    : null;

  res.json(formatTenant(row.tenant, row.propertyName, payments, latestAgreement, generatedRents, revisions));
});

/**
 * Month-by-month ledger history for a tenant (Rent Ledger detail / Month
 * History screens). Built server-side from @workspace/rent-calc so the
 * client never has to reconstruct billing periods or re-derive status.
 */
router.get("/tenants/:id/ledger", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const [generatedRents, payments] = await Promise.all([
    db.select({
        id: generatedRentsTable.id,
        amount: generatedRentsTable.amount,
        dueDate: generatedRentsTable.dueDate,
        status: generatedRentsTable.status,
        billingPeriodStart: generatedRentsTable.billingPeriodStart,
        billingPeriodEnd: generatedRentsTable.billingPeriodEnd,
      }).from(generatedRentsTable).where(eq(generatedRentsTable.tenantId, id)),
    db.select({
        amount: paymentsTable.amount,
        generatedRentId: paymentsTable.generatedRentId,
        month: paymentsTable.month,
        year: paymentsTable.year,
      }).from(paymentsTable).where(eq(paymentsTable.tenantId, id)),
  ]);

  const today = new Date().toISOString().split("T")[0];
  res.json(computeMonthHistory(generatedRents, payments, today));
});

router.patch("/tenants/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["name", "email", "phone", "propertyId", "unitNumber", "leaseStart", "leaseEnd", "status", "emergencyContact", "notes", "depositDate", "depositStatus",
    "billingCycle", "rentCollectionType", "gracePeriodDays", "useBusinessDefault",
    "autoRenewal", "renewalDuration", "customRenewalUnit", "rentEscalation",
    "escalationFrequencyYears", "escalationType", "escalationApply", "renewalNotice"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.rentAmount !== undefined) updates.rentAmount = String(body.rentAmount);
  if (body.securityDeposit !== undefined) updates.securityDeposit = body.securityDeposit != null ? String(body.securityDeposit) : null;
  if (body.escalationValue !== undefined) updates.escalationValue = String(body.escalationValue);
  if (body.customRenewalValue !== undefined) updates.customRenewalValue = body.customRenewalValue != null ? parseInt(String(body.customRenewalValue), 10) : null;

  // Write-time materialization keeps the tenant row the single source of
  // truth for billing settings: switching to business defaults copies the
  // current defaults into the tenant's own columns, and sending an explicit
  // billing field turns the follow-defaults flag off unless the client
  // explicitly re-asserts it. No read path ever resolves defaults.
  const billingFieldKeys = ["billingCycle", "rentCollectionType", "gracePeriodDays"];
  if (updates.useBusinessDefault === true) {
    const defaults = await getBusinessDefaults(userId);
    if (defaults) {
      updates.billingCycle = defaults.billingCycle;
      updates.rentCollectionType = defaults.rentCollectionType;
      updates.gracePeriodDays = defaults.gracePeriodDays;
    }
  } else if (updates.useBusinessDefault === undefined && billingFieldKeys.some(k => k in updates)) {
    updates.useBusinessDefault = false;
  }

  // Edit Tenant and Rent Revision are two completely independent business
  // workflows and must never be conflated:
  //   - Edit Tenant  = correcting/updating tenant data (incl. Rent Amount,
  //     lease dates, billing cycle, advance/postpaid, grace period, deposit).
  //     It must ALWAYS be allowed, even when Rent Revision History already
  //     exists, and it must NEVER create, modify, or delete a rent_revisions
  //     row — automatic or manual.
  //   - Rent Revision = the landlord's official, dated rent increase/decrease.
  //     Only POST /tenants/:id/revise (and lease renewal) may write history.
  //
  // Any edit that changes WHAT the billing timeline produces (rent amount,
  // lease window, cycle, collection type, grace period, escalation, status)
  // triggers a FULL from-scratch rebuild of the tenant's generated_rents —
  // editing a tenant must yield the exact same ledger as creating a new
  // tenant with these settings. The whole edit (tenant row + rebuild) runs
  // in ONE transaction so a failure leaves everything intact.
  const billingDefiningKeys = [
    "rentAmount", "leaseStart", "leaseEnd", "billingCycle", "rentCollectionType",
    "gracePeriodDays", "useBusinessDefault", "status",
    "rentEscalation", "escalationFrequencyYears", "escalationType", "escalationValue", "escalationApply",
  ];
  const billingChanged = billingDefiningKeys.some(k => k in updates);

  const tenant = await db.transaction(async (tx) => {
    const [updated] = await tx.update(tenantsTable).set(updates).where(eq(tenantsTable.id, id)).returning();
    if (!updated) return undefined;

    // Full rebuild: wipe & regenerate generated_rents under the NEW
    // settings, re-allocate payments. Payment/receipt records themselves
    // are never modified. `preserveRevisionHistory: true` is mandatory here
    // — Edit Tenant must never create, modify, or delete a rent_revisions
    // row (manual OR automatic); billing amounts are still computed
    // correctly because the timeline reads the lease + manual revisions
    // directly, never the automatic audit rows.
    if (billingChanged) {
      await rebuildTenantBilling(tx, updated.id, true);
    }

    return updated;
  });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const [[property], payments, agreements, patchGeneratedRents, patchRevisions] = await Promise.all([
    db.select().from(propertiesTable).where(eq(propertiesTable.id, tenant.propertyId)),
    db.select({ amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
      .from(paymentsTable).where(eq(paymentsTable.tenantId, id)),
    db.select({ endDate: rentAgreementsTable.endDate })
      .from(rentAgreementsTable).where(eq(rentAgreementsTable.tenantId, id)),
    db.select({
        amount: generatedRentsTable.amount,
        dueDate: generatedRentsTable.dueDate,
        status: generatedRentsTable.status,
        billingPeriodStart: generatedRentsTable.billingPeriodStart,
      }).from(generatedRentsTable).where(eq(generatedRentsTable.tenantId, id)),
    db.select({
        effectiveFrom: rentRevisionsTable.effectiveFrom,
        newRent: rentRevisionsTable.newRent,
        previousRent: rentRevisionsTable.previousRent,
        status: rentRevisionsTable.status,
        changedBy: rentRevisionsTable.changedBy,
      }).from(rentRevisionsTable).where(eq(rentRevisionsTable.tenantId, id)),
  ]);
  const latestAgreement = agreements.length > 0
    ? agreements.reduce((best, a) => a.endDate > best.endDate ? a : best)
    : null;
  res.json(formatTenant(tenant, property?.name, payments, latestAgreement, patchGeneratedRents, patchRevisions));
});

router.get("/tenants/:id/renewals", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  const renewals = await db.select().from(leaseRenewalsTable)
    .where(eq(leaseRenewalsTable.tenantId, id))
    .orderBy(desc(leaseRenewalsTable.createdAt));
  res.json(renewals.map(r => ({
    ...r,
    previousRent: parseFloat(String(r.previousRent)),
    newRent: parseFloat(String(r.newRent)),
    increaseAmount: parseFloat(String(r.increaseAmount)),
    increasePercent: parseFloat(String(r.increasePercent)),
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/tenants/:id/renew", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const t = row.tenant;
  const body = req.body as { newRentAmount?: number; notes?: string };
  const previousLeaseStart = t.leaseStart;
  const previousLeaseEnd = t.leaseEnd;
  const previousRent = parseFloat(String(t.rentAmount));

  const endDate = new Date(previousLeaseEnd + "T00:00:00");
  const newStart = new Date(endDate);
  newStart.setDate(newStart.getDate() + 1);
  const newEnd = new Date(newStart);

  const renewalMethod = t.renewalDuration ?? "same";
  if (renewalMethod === "custom" && t.customRenewalValue && t.customRenewalValue > 0) {
    const unit = t.customRenewalUnit ?? "months";
    if (unit === "years") newEnd.setFullYear(newEnd.getFullYear() + t.customRenewalValue);
    else newEnd.setMonth(newEnd.getMonth() + t.customRenewalValue);
  } else {
    // Same lease duration: compute original length in days and apply
    const origStart = new Date(previousLeaseStart + "T00:00:00");
    const origEnd = new Date(previousLeaseEnd + "T00:00:00");
    const origDays = Math.round((origEnd.getTime() - origStart.getTime()) / (1000 * 60 * 60 * 24));
    newEnd.setDate(newEnd.getDate() + origDays);
  }

  const newLeaseStart = newStart.toISOString().split("T")[0];
  const newLeaseEnd = newEnd.toISOString().split("T")[0];

  // Renewal rent comes from the SHARED billing timeline, not a local
  // elapsed-years heuristic: the rent active on the renewed lease's first
  // day — with escalation anniversaries still anchored to the pre-renewal
  // leaseStart — already accounts for every escalation and manual revision.
  const renewalRevisionRows = await db.select({
    effectiveFrom: rentRevisionsTable.effectiveFrom,
    newRent: rentRevisionsTable.newRent,
    previousRent: rentRevisionsTable.previousRent,
    status: rentRevisionsTable.status,
    changedBy: rentRevisionsTable.changedBy,
  }).from(rentRevisionsTable).where(eq(rentRevisionsTable.tenantId, id));
  const preRenewalLease = buildLeaseContext(t, renewalRevisionRows);

  let newRent = previousRent;
  if (body.newRentAmount != null && body.newRentAmount > 0) {
    newRent = body.newRentAmount;
  } else if (t.rentEscalation && t.escalationApply === "automatic") {
    newRent = getActiveRent(preRenewalLease, newLeaseStart);
  }
  const increaseAmount = newRent - previousRent;
  const increasePercent = previousRent > 0 ? (increaseAmount / previousRent) * 100 : 0;

  const renewalDate = new Date().toISOString().split("T")[0];
  const renewedBy = body.newRentAmount != null ? "manual" : (t.escalationApply ?? "manual");

  const renewal = await db.transaction(async (tx) => {
    const [ren] = await tx.insert(leaseRenewalsTable).values({
      tenantId: id,
      renewalDate,
      previousLeaseStart,
      previousLeaseEnd,
      newLeaseStart,
      newLeaseEnd,
      previousRent: String(previousRent),
      newRent: String(newRent),
      increaseAmount: String(increaseAmount),
      increasePercent: String(increasePercent),
      renewedBy,
      notes: body.notes ?? null,
    }).returning();

    await tx.update(tenantsTable).set({
      leaseStart: newLeaseStart,
      leaseEnd: newLeaseEnd,
      rentAmount: String(newRent),
    }).where(eq(tenantsTable.id, id));

    // The renewal revision is ALWAYS recorded — even when the rent amount is
    // unchanged. Once leaseStart moves, the shared timeline re-anchors to the
    // new lease, so a same-amount revision is what carries the pre-renewal
    // (possibly escalated) rent forward; without it the next resync would
    // collapse the rent back to base.
    const upsertRevision = async (effectiveFrom: string, prev: number, next: number, reason: string) => {
      const [sameDate] = await tx.select({ id: rentRevisionsTable.id })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.effectiveFrom, effectiveFrom),
          eq(rentRevisionsTable.status, "active"),
          eq(rentRevisionsTable.changedBy, "manual")
        ));
      // Renewal always writes tenant.rentAmount immediately above (line
      // ~543), even for early renewals whose newLeaseStart is still in the
      // future — so these revisions must be marked applied right away too,
      // or promoteEffectiveManualRevisions would try to "promote" them again
      // once effectiveFrom arrives and clobber any Edit Tenant correction
      // made in the meantime.
      if (sameDate) {
        await tx.update(rentRevisionsTable)
          .set({ newRent: String(next), previousRent: String(prev), reason, appliedToCurrentRent: true })
          .where(eq(rentRevisionsTable.id, sameDate.id));
      } else {
        await tx.insert(rentRevisionsTable).values({
          tenantId: id,
          previousRent: String(prev),
          newRent: String(next),
          effectiveFrom,
          reason,
          changedBy: "manual",
          appliedToCurrentRent: true,
        });
      }
    };

    // Early renewal (executed before the new lease begins): freeze the
    // pre-renewal active rent from the renewal date so the gap window and
    // the tenant.rentAmount snapshot keep the carried rent until the new
    // lease actually starts.
    if (renewalDate < newLeaseStart) {
      const carriedRent = getActiveRent(preRenewalLease, renewalDate);
      await upsertRevision(renewalDate, carriedRent, carriedRent, "Lease renewal carry-over");
    }
    await upsertRevision(newLeaseStart, previousRent, newRent, "Lease renewal");

    // Single shared ledger-sync path — runs AFTER leaseStart has moved so
    // the resync sees the renewed lease's timeline.
    await resyncTenantLedger(tx, id);

    return ren;
  });

  res.json({
    ...renewal,
    previousRent: parseFloat(String(renewal.previousRent)),
    newRent: parseFloat(String(renewal.newRent)),
    increaseAmount: parseFloat(String(renewal.increaseAmount)),
    increasePercent: parseFloat(String(renewal.increasePercent)),
    createdAt: renewal.createdAt.toISOString(),
  });
});

router.get("/tenants/:id/revisions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  const revisions = await db.select().from(rentRevisionsTable)
    .where(eq(rentRevisionsTable.tenantId, id))
    .orderBy(desc(rentRevisionsTable.createdAt));
  const today = new Date().toISOString().split("T")[0];
  const parsedRevisions = revisions.map(r => ({
    ...r,
    previousRent: parseFloat(String(r.previousRent)),
    newRent: parseFloat(String(r.newRent)),
    createdAt: r.createdAt.toISOString(),
  }));
  const lease = buildLeaseContext(row.tenant, parsedRevisions);
  // Automatic (escalation) revisions display at the true lease-anniversary
  // date computed from the lease agreement's terms, not the date the cron
  // job happened to run. This is a read-time correction only — it does not
  // rewrite the underlying rent_revisions rows.
  res.json(buildDisplayRevisionHistory(lease, parsedRevisions, today));
});

router.post("/tenants/:id/revise", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  // Auth check (read-only, outside transaction)
  const [authRow] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!authRow || authRow.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const body = req.body as { newRent: number; effectiveFrom: string; reason?: string; currentRent?: number };
  if (!body.newRent || body.newRent <= 0) { res.status(400).json({ error: "newRent must be a positive number" }); return; }
  if (!body.effectiveFrom) { res.status(400).json({ error: "effectiveFrom is required (YYYY-MM-DD)" }); return; }

  let revision: typeof rentRevisionsTable.$inferSelect;

  try {
    revision = await db.transaction(async (tx) => {
      // Re-read tenant inside transaction for consistent snapshot
      const [row] = await tx
        .select({ tenant: tenantsTable })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, id));

      const t = row.tenant;

      // ── Concurrency guard ─────────────────────────────────────────────────
      // If the client sent the rent they were looking at, verify it hasn't changed.
      if (body.currentRent != null) {
        const actualRent = parseFloat(String(t.rentAmount));
        if (Math.abs(actualRent - body.currentRent) > 0.005) {
          throw Object.assign(new Error("STALE_RENT"), { code: "STALE_RENT" });
        }
      }

      // Validate: effectiveFrom must not be before lease start
      if (body.effectiveFrom < t.leaseStart) {
        throw Object.assign(
          new Error(`Effective date cannot be before the lease start date (${t.leaseStart})`),
          { code: "VALIDATION", statusCode: 400 }
        );
      }

      // Validate: no duplicate active effectiveFrom for this tenant
      const [dupCheck] = await tx
        .select({ id: rentRevisionsTable.id })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.effectiveFrom, body.effectiveFrom),
          eq(rentRevisionsTable.status, "active")
        ));
      if (dupCheck) {
        throw Object.assign(
          new Error("A revision already exists for this effective date. Use a different date."),
          { code: "VALIDATION", statusCode: 409 }
        );
      }

      // Determine previousRent: closest prior active revision, or current rent
      const [priorRevision] = await tx
        .select({ newRent: rentRevisionsTable.newRent })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.status, "active"),
          lt(rentRevisionsTable.effectiveFrom, body.effectiveFrom)
        ))
        .orderBy(desc(rentRevisionsTable.effectiveFrom))
        .limit(1);

      const previousRent = priorRevision
        ? parseFloat(String(priorRevision.newRent))
        : parseFloat(String(t.rentAmount));

      const [rev] = await tx.insert(rentRevisionsTable).values({
        tenantId: id,
        previousRent: String(previousRent),
        newRent: String(body.newRent),
        effectiveFrom: body.effectiveFrom,
        reason: body.reason ?? null,
        changedBy: "manual",
      }).returning();

      // Immediate (already-effective) revisions promote tenant.rentAmount —
      // the single source of truth for Current Rent — the moment the
      // revision itself takes effect, and are marked applied so later
      // promotion runs don't re-touch them. Future-dated revisions are left
      // unpromoted/unmarked; promoteEffectiveManualRevisions (run as part of
      // period generation) promotes them once their effective date arrives.
      const today = new Date().toISOString().split("T")[0];
      if (body.effectiveFrom <= today) {
        await tx.update(tenantsTable)
          .set({ rentAmount: String(body.newRent) })
          .where(eq(tenantsTable.id, id));
        await tx.update(rentRevisionsTable)
          .set({ appliedToCurrentRent: true })
          .where(eq(rentRevisionsTable.id, rev.id));
      }

      // Single shared ledger-sync path: recomputes every unsettled row from
      // the merged revision + escalation timeline.
      const updatedRentRows = await resyncTenantLedger(tx, id);

      logger.info(
        { tenantId: id, effectiveFrom: body.effectiveFrom, newRent: body.newRent, updatedRentRows },
        "Manual revision applied — ledger resynced"
      );

      return rev;
    });
  } catch (err: any) {
    if (err.code === "STALE_RENT") {
      res.status(409).json({ error: "This tenant's rent has been updated by another user. Please refresh and review the latest rent before creating a new revision." }); return;
    }
    if (err.code === "VALIDATION") {
      res.status(err.statusCode ?? 400).json({ error: err.message }); return;
    }
    throw err;
  }

  res.json({
    ...revision,
    previousRent: parseFloat(String(revision.previousRent)),
    newRent: parseFloat(String(revision.newRent)),
    createdAt: revision.createdAt.toISOString(),
  });
});

// ── Edit a pending (future) manual revision ───────────────────────────────
router.put("/tenants/:id/revisions/:revId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const revId = parseInt(Array.isArray(req.params.revId) ? req.params.revId[0] : req.params.revId, 10);

  // Auth check (read-only, outside transaction)
  const [authRow] = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!authRow || authRow.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const body = req.body as { newRent?: number; effectiveFrom?: string; reason?: string };
  const today = new Date().toISOString().split("T")[0];

  let updated: typeof rentRevisionsTable.$inferSelect;

  try {
    updated = await db.transaction(async (tx) => {
      // Re-read revision inside transaction for consistent snapshot
      const [revision] = await tx.select().from(rentRevisionsTable)
        .where(and(eq(rentRevisionsTable.id, revId), eq(rentRevisionsTable.tenantId, id)));
      if (!revision) throw Object.assign(new Error("Revision not found"), { code: "NOT_FOUND" });

      if (revision.effectiveFrom <= today) {
        throw Object.assign(new Error("This revision is already effective and cannot be edited."), { code: "CONFLICT" });
      }
      if (revision.status === "cancelled") {
        throw Object.assign(new Error("A cancelled revision cannot be edited."), { code: "CONFLICT" });
      }
      if (revision.changedBy !== "manual") {
        throw Object.assign(new Error("Automatic escalation entries cannot be edited manually."), { code: "CONFLICT" });
      }
      // A future-dated row can still be marked applied ahead of its date —
      // e.g. an early lease renewal writes tenant.rentAmount immediately
      // even though effectiveFrom is the (future) newLeaseStart. Editing it
      // here would desync tenant.rentAmount from what this row claims to
      // represent, so it must be blocked the same as an already-effective
      // revision.
      if (revision.appliedToCurrentRent) {
        throw Object.assign(new Error("This revision has already been applied to Current Rent and cannot be edited."), { code: "CONFLICT" });
      }

      const newEffectiveFrom = body.effectiveFrom ?? revision.effectiveFrom;
      const newRentAmount = body.newRent != null ? body.newRent : parseFloat(String(revision.newRent));

      if (newRentAmount <= 0) throw Object.assign(new Error("newRent must be a positive number"), { code: "VALIDATION", statusCode: 400 });
      if (newEffectiveFrom < authRow.tenant.leaseStart) {
        throw Object.assign(
          new Error(`Effective date cannot be before the lease start date (${authRow.tenant.leaseStart})`),
          { code: "VALIDATION", statusCode: 400 }
        );
      }
      if (newEffectiveFrom <= today) {
        throw Object.assign(new Error("New effective date must be in the future."), { code: "VALIDATION", statusCode: 400 });
      }

      // Duplicate check (excluding self)
      if (newEffectiveFrom !== revision.effectiveFrom) {
        const [dupCheck] = await tx
          .select({ id: rentRevisionsTable.id })
          .from(rentRevisionsTable)
          .where(and(
            eq(rentRevisionsTable.tenantId, id),
            eq(rentRevisionsTable.effectiveFrom, newEffectiveFrom),
            eq(rentRevisionsTable.status, "active"),
            sql`${rentRevisionsTable.id} != ${revId}`
          ));
        if (dupCheck) {
          throw Object.assign(
            new Error("A revision already exists for this effective date. Use a different date."),
            { code: "VALIDATION", statusCode: 409 }
          );
        }
      }

      // Update the revision row, then run the single shared ledger-sync —
      // it recomputes every unsettled row from the full merged timeline, so
      // no hand-rolled revert/apply range SQL is needed here.
      const [upd] = await tx.update(rentRevisionsTable)
        .set({
          newRent: String(newRentAmount),
          effectiveFrom: newEffectiveFrom,
          reason: body.reason !== undefined ? (body.reason || null) : revision.reason,
        })
        .where(eq(rentRevisionsTable.id, revId))
        .returning();

      await resyncTenantLedger(tx, id);

      logger.info({ tenantId: id, revId, newRentAmount, newEffectiveFrom }, "Rent revision edited — ledger resynced");
      return upd;
    });
  } catch (err: any) {
    if (err.code === "NOT_FOUND") { res.status(404).json({ error: err.message }); return; }
    if (err.code === "CONFLICT") { res.status(409).json({ error: err.message }); return; }
    if (err.code === "VALIDATION") { res.status(err.statusCode ?? 400).json({ error: err.message }); return; }
    throw err;
  }

  res.json({
    ...updated,
    previousRent: parseFloat(String(updated.previousRent)),
    newRent: parseFloat(String(updated.newRent)),
    createdAt: updated.createdAt.toISOString(),
  });
});

// ── Cancel a pending (future) manual revision ─────────────────────────────
router.delete("/tenants/:id/revisions/:revId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const revId = parseInt(Array.isArray(req.params.revId) ? req.params.revId[0] : req.params.revId, 10);

  // Auth check (read-only, outside transaction)
  const [authRow] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!authRow || authRow.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const today = new Date().toISOString().split("T")[0];
  let cancelled: typeof rentRevisionsTable.$inferSelect;

  try {
    cancelled = await db.transaction(async (tx) => {
      // Re-read revision inside transaction for consistent snapshot
      const [revision] = await tx.select().from(rentRevisionsTable)
        .where(and(eq(rentRevisionsTable.id, revId), eq(rentRevisionsTable.tenantId, id)));
      if (!revision) throw Object.assign(new Error("Revision not found"), { code: "NOT_FOUND" });

      if (revision.effectiveFrom <= today) {
        throw Object.assign(new Error("This revision is already effective and cannot be cancelled."), { code: "CONFLICT" });
      }
      if (revision.status === "cancelled") {
        throw Object.assign(new Error("This revision is already cancelled."), { code: "CONFLICT" });
      }
      if (revision.changedBy !== "manual") {
        throw Object.assign(new Error("Automatic escalation entries cannot be cancelled manually."), { code: "CONFLICT" });
      }
      // See matching guard in the edit route above: a renewal-originated row
      // can be future-dated yet already applied to tenant.rentAmount.
      // Cancelling it here would silently desync Current Rent with no
      // compensating rollback.
      if (revision.appliedToCurrentRent) {
        throw Object.assign(new Error("This revision has already been applied to Current Rent and cannot be cancelled."), { code: "CONFLICT" });
      }

      // Soft-cancel: preserve the audit trail. The shared ledger-sync then
      // recomputes every unsettled row from the timeline (which now skips
      // this cancelled revision) — no hand-rolled revert-range SQL needed.
      const [can] = await tx.update(rentRevisionsTable)
        .set({ status: "cancelled" })
        .where(eq(rentRevisionsTable.id, revId))
        .returning();

      await resyncTenantLedger(tx, id);

      logger.info({ tenantId: id, revId }, "Rent revision cancelled — ledger resynced");
      return can;
    });
  } catch (err: any) {
    if (err.code === "NOT_FOUND") { res.status(404).json({ error: err.message }); return; }
    if (err.code === "CONFLICT") { res.status(409).json({ error: err.message }); return; }
    throw err;
  }

  res.json({
    ...cancelled,
    previousRent: parseFloat(String(cancelled.previousRent)),
    newRent: parseFloat(String(cancelled.newRent)),
    createdAt: cancelled.createdAt.toISOString(),
  });
});

router.delete("/tenants/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, id));
  await db.delete(maintenanceRequestsTable).where(eq(maintenanceRequestsTable.tenantId, id));
  await db.delete(rentAgreementsTable).where(eq(rentAgreementsTable.tenantId, id));
  await db.delete(tenantDocumentsTable).where(eq(tenantDocumentsTable.tenantId, id));
  await db.delete(rentRevisionsTable).where(eq(rentRevisionsTable.tenantId, id));
  const deleted = await db.delete(tenantsTable).where(eq(tenantsTable.id, id)).returning();
  if (!deleted.length) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.sendStatus(204);
});

export default router;
