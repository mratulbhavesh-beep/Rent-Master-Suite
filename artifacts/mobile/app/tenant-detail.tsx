import React, { useState, useEffect } from "react";
import { useDateInput, isValidCalendarDate } from "@/utils/useDateInput";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Linking, Switch, Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useGetTenant, getGetTenantQueryKey, useUpdateTenant, useDeleteTenant,
  useDeletePayment, useListPayments, getListPaymentsQueryKey,
  getListTenantsQueryKey, getGetDashboardSummaryQueryKey,
  useListTenantAgreements, getListTenantAgreementsQueryKey,
  useCreateAgreement, useUpdateAgreement, useDeleteAgreement,
  useListTenantDocuments, getListTenantDocumentsQueryKey,
  useDeleteDocument,
  useListGeneratedRents, getListGeneratedRentsQueryKey,
  useListLeaseRenewals, getListLeaseRenewalsQueryKey, useRenewLease,
  LeaseRenewal,
  useListRentRevisions, getListRentRevisionsQueryKey, useReviseRent,
  useUpdateRentRevision, useCancelRentRevision,
  RentRevision,
  Agreement,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather, FontAwesome } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Image as ExpoImage } from "expo-image";
import { fmtDate } from "@/utils/dateFormat";
import { shareViaWhatsApp } from "@/utils/whatsapp";
import { confirmAction } from "@/utils/confirm";

function addMonthsUTC(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split("T")[0];
}
function addDaysUTC(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}
function deriveYearsMonths(leaseStart: string, leaseEnd: string): { years: number; months: number } {
  const excl = addDaysUTC(leaseEnd, 1);
  const s = new Date(leaseStart + "T00:00:00Z");
  const e = new Date(excl + "T00:00:00Z");
  const total = Math.max(0, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()));
  return { years: Math.floor(total / 12), months: total % 12 };
}

type ActiveTab = "overview" | "agreement" | "documents";

const DOC_TYPES = [
  { type: "aadhaar", label: "Aadhaar", icon: "credit-card" as const, isImage: true },
  { type: "pan", label: "PAN Card", icon: "credit-card" as const, isImage: true },
  { type: "photo", label: "Tenant Photo", icon: "camera" as const, isImage: true },
  { type: "agreement", label: "Agreement PDF", icon: "file-text" as const, isImage: false },
  { type: "other", label: "Other Document", icon: "paperclip" as const, isImage: false },
] as const;

function docTypeIcon(docType: string): keyof typeof Feather.glyphMap {
  const t = DOC_TYPES.find(d => d.type === docType);
  return t ? t.icon : "file";
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtBillingDate(dateStr: string | null | undefined): string {
  return fmtDate(dateStr);
}

function addOneDayStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

// Mirrors lib/rent-calc computePeriodEnd exactly — kept local to avoid
// adding a new workspace dependency to the mobile bundle.
// weekly: 7-day period (day 0 → day 6); others: addMonths(n) − 1 day.
function computeNextPeriodEnd(periodStart: string, billingCycle: string): string {
  if (billingCycle === "weekly") {
    const d = new Date(periodStart + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().split("T")[0];
  }
  const months = billingCycle === "quarterly" ? 3 : billingCycle === "yearly" ? 12 : 1;
  const d = new Date(periodStart + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  const end = new Date(d.toISOString().split("T")[0] + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().split("T")[0];
}

export default function TenantDetailScreen() {
  const { id } = useLocalSearchParams();
  const tenantId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const auth = useAuth();

  const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

  // Tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  // Overview edit state
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "evicted">("active");
  const { displayValue: leaseStartDisplay, onChangeDisplay: onLeaseStartChangeRaw, isoValue: leaseStart, setFromIso: setLeaseStartFromIso } = useDateInput("");
  const [durationYears, setDurationYears] = useState(0);
  const [durationMonths, setDurationMonths] = useState(0);
  const [originalLeaseEnd, setOriginalLeaseEnd] = useState("");
  const [leaseDurationDirty, setLeaseDurationDirty] = useState(false);
  const computedLeaseEnd = leaseStart
    ? addDaysUTC(addMonthsUTC(leaseStart, durationYears * 12 + durationMonths), -1)
    : null;
  const leaseEndToSubmit = leaseDurationDirty ? (computedLeaseEnd ?? originalLeaseEnd) : originalLeaseEnd;
  const onLeaseStartChange = (v: string) => { onLeaseStartChangeRaw(v); setLeaseDurationDirty(true); };
  const [depositAmount, setDepositAmount] = useState("");
  const { displayValue: depositDateDisplay, onChangeDisplay: onDepositDateChange, isoValue: depositDate, setFromIso: setDepositDateFromIso } = useDateInput("");
  const [depositStatus, setDepositStatus] = useState<"held" | "refunded">("held");
  const [billingCycle, setBillingCycle] = useState<"weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [rentCollectionType, setRentCollectionType] = useState<"advance" | "post_paid">("post_paid");
  const [gracePeriodDays, setGracePeriodDays] = useState(5);
  const [useBusinessDefault, setUseBusinessDefault] = useState(true);

  // Lease Management state
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [renewalMethod, setRenewalMethod] = useState<"same" | "custom">("same");
  const [renewalYears, setRenewalYears] = useState(0);
  const [renewalMonths, setRenewalMonths] = useState(11);
  const [rentEscalation, setRentEscalation] = useState(false);
  const [escalationFrequencyYears, setEscalationFrequencyYears] = useState("1");
  const [escalationType, setEscalationType] = useState<"percentage" | "fixed">("percentage");
  const [escalationValue, setEscalationValue] = useState("0");
  const [escalationApply, setEscalationApply] = useState<"automatic" | "manual">("manual");
  const [renewalNotice, setRenewalNotice] = useState(30);
  const [showRenewalForm, setShowRenewalForm] = useState(false);
  const [newRentForRenewal, setNewRentForRenewal] = useState("");
  const [renewalNotes, setRenewalNotes] = useState("");

  // Manual Rent Revision state
  const [revisionEnabled, setRevisionEnabled] = useState(false);
  const [newRevisionAmount, setNewRevisionAmount] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionError, setRevisionError] = useState("");
  const [showRevisionConfirm, setShowRevisionConfirm] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<{ newRent: number; isoDate: string; displayDate: string; reason: string } | null>(null);

  // Edit revision state
  const [editingRevision, setEditingRevision] = useState<RentRevision | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState("");

  // Agreement form state
  const [showAgrForm, setShowAgrForm] = useState(false);
  const [editingAgrId, setEditingAgrId] = useState<number | null>(null);
  const [agrNumber, setAgrNumber] = useState("");
  const [agrStart, setAgrStart] = useState("");
  const [agrEnd, setAgrEnd] = useState("");
  const [agrRent, setAgrRent] = useState("");
  const [agrDeposit, setAgrDeposit] = useState("");
  const [agrNotes, setAgrNotes] = useState("");

  // Document state
  const [uploading, setUploading] = useState(false);

  // Queries
  const { data: tenant, isLoading } = useGetTenant(tenantId, {
    query: { queryKey: getGetTenantQueryKey(tenantId), enabled: !!tenantId }
  });
  const updateMutation = useUpdateTenant();
  const deleteMutation = useDeleteTenant();
  const deletePmtMutation = useDeletePayment();

  const { data: payments, isLoading: paymentsLoading } = useListPayments(
    { tenantId },
    { query: { queryKey: getListPaymentsQueryKey({ tenantId }), enabled: !!tenantId } }
  );

  const { data: agreements, isLoading: agreementsLoading, refetch: refetchAgreements } = useListTenantAgreements(
    tenantId,
    { query: { queryKey: getListTenantAgreementsQueryKey(tenantId), enabled: !!tenantId } }
  );

  const createAgrMutation = useCreateAgreement();
  const updateAgrMutation = useUpdateAgreement();
  const deleteAgrMutation = useDeleteAgreement();

  const { data: documents, isLoading: documentsLoading, refetch: refetchDocuments } = useListTenantDocuments(
    tenantId,
    { query: { queryKey: getListTenantDocumentsQueryKey(tenantId), enabled: !!tenantId } }
  );
  const deleteDocMutation = useDeleteDocument();

  const { data: generatedRents } = useListGeneratedRents(
    { tenantId },
    { query: { queryKey: getListGeneratedRentsQueryKey({ tenantId }), enabled: !!tenantId } }
  );

  const { data: leaseRenewals, refetch: refetchRenewals } = useListLeaseRenewals(
    tenantId,
    { query: { queryKey: getListLeaseRenewalsQueryKey(tenantId), enabled: !!tenantId } }
  );
  const renewMutation = useRenewLease();

  const { data: rentRevisions } = useListRentRevisions(
    tenantId,
    { query: { queryKey: getListRentRevisionsQueryKey(tenantId), enabled: !!tenantId } }
  );
  const reviseMutation = useReviseRent();
  const updateRevisionMutation = useUpdateRentRevision();
  const cancelRevisionMutation = useCancelRentRevision();

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setEmail(tenant.email);
      setPhone(tenant.phone);
      setUnitNumber(tenant.unitNumber);
      setRentAmount(tenant.rentAmount.toString());
      setStatus(tenant.status as "active" | "inactive" | "evicted");
      const ls = tenant.leaseStart.split("T")[0];
      const le = tenant.leaseEnd.split("T")[0];
      setLeaseStartFromIso(ls);
      setOriginalLeaseEnd(le);
      setLeaseDurationDirty(false);
      const { years, months } = deriveYearsMonths(ls, le);
      setDurationYears(years);
      setDurationMonths(months);
      const t = tenant as any;
      setDepositAmount(t.securityDeposit != null ? String(t.securityDeposit) : "");
      setDepositDateFromIso(t.depositDate ? String(t.depositDate).split("T")[0] : "");
      setDepositStatus((t.depositStatus as "held" | "refunded") ?? "held");
      setBillingCycle(((t as any).billingCycle as "monthly" | "quarterly" | "yearly") ?? "monthly");
      setRentCollectionType(((t as any).rentCollectionType as "advance" | "post_paid") ?? "post_paid");
      setGracePeriodDays((t as any).gracePeriodDays ?? 5);
      setUseBusinessDefault((t as any).useBusinessDefault ?? true);
      setAutoRenewal((t as any).autoRenewal ?? false);
      setRenewalMethod(((t as any).renewalDuration as "same" | "custom") === "custom" ? "custom" : "same");
      const rawVal: number = Number((t as any).customRenewalValue ?? 11);
      const rawUnit: string = (t as any).customRenewalUnit ?? "months";
      const totalRenewalMos = rawUnit === "years" ? rawVal * 12 : rawVal;
      setRenewalYears(Math.floor(totalRenewalMos / 12));
      setRenewalMonths(totalRenewalMos % 12);
      setRentEscalation((t as any).rentEscalation ?? false);
      setEscalationFrequencyYears(String((t as any).escalationFrequencyYears ?? "1"));
      setEscalationType(((t as any).escalationType as "percentage" | "fixed") ?? "percentage");
      setEscalationValue(String((t as any).escalationValue ?? "0"));
      setEscalationApply(((t as any).escalationApply as "automatic" | "manual") ?? "manual");
      setRenewalNotice((t as any).renewalNotice ?? 30);
    }
  }, [tenant]);

  const handleSave = () => {
    if (!name || !email || !phone || !unitNumber || !rentAmount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    if (leaseStartDisplay.replace(/\D/g, "").length === 0 || !leaseStart) {
      Alert.alert("Invalid Date", "Please enter a valid lease start date in DD/MM/YYYY format.");
      return;
    }
    if (!leaseEndToSubmit) {
      Alert.alert("Invalid Date", "Could not determine lease end date. Please check Lease Start and Duration.");
      return;
    }
    if (leaseDurationDirty && durationYears * 12 + durationMonths === 0) {
      Alert.alert("Invalid Duration", "Lease duration must be at least 1 month.");
      return;
    }
    if (depositDateDisplay.replace(/\D/g, "").length > 0 && !depositDate) {
      Alert.alert("Invalid Date", "Please enter a valid deposit date in DD/MM/YYYY format.");
      return;
    }
    updateMutation.mutate(
      {
        id: tenantId,
        data: {
          name, email, phone, unitNumber,
          rentAmount: parseFloat(rentAmount),
          status, leaseStart, leaseEnd: leaseEndToSubmit,
          securityDeposit: depositAmount ? parseFloat(depositAmount) : undefined,
          depositDate: depositDate || undefined,
          depositStatus,
          billingCycle: useBusinessDefault ? undefined : billingCycle,
          rentCollectionType: useBusinessDefault ? undefined : rentCollectionType,
          gracePeriodDays: useBusinessDefault ? undefined : gracePeriodDays,
          useBusinessDefault,
          autoRenewal,
          renewalDuration: renewalMethod,
          customRenewalValue: renewalMethod === "custom" ? (renewalYears * 12 + renewalMonths || 11) : undefined,
          customRenewalUnit: renewalMethod === "custom" ? "months" : undefined,
          rentEscalation,
          escalationFrequencyYears: parseInt(escalationFrequencyYears, 10) || 1,
          escalationType,
          escalationValue: parseFloat(escalationValue) || 0,
          escalationApply,
          renewalNotice,
        }
      },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTenantQueryKey(tenantId), data);
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setIsEditing(false);
          Alert.alert("Success", "Tenant updated");
        },
        onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to update tenant")
      }
    );
  };

  const performDelete = () => {
    deleteMutation.mutate(
      { id: tenantId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
          router.back();
        },
        onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to delete tenant"),
      }
    );
  };

  const handleDelete = () => {
    const msg = `Delete "${tenant?.name}"?\n\nAll payment and maintenance records will also be deleted. This cannot be undone.`;
    confirmAction("Delete Tenant", msg, performDelete);
  };

  const handleRenewal = (customRentAmount?: number) => {
    const body: { newRentAmount?: number; notes?: string } = {};
    if (customRentAmount != null && customRentAmount > 0) body.newRentAmount = customRentAmount;
    if (renewalNotes.trim()) body.notes = renewalNotes.trim();
    renewMutation.mutate(
      { id: tenantId, data: body },
      {
        onSuccess: (data: LeaseRenewal) => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListLeaseRenewalsQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          refetchRenewals();
          setShowRenewalForm(false);
          setNewRentForRenewal("");
          setRenewalNotes("");
          Alert.alert(
            "Lease Renewed ✓",
            `New lease: ${fmtDate(data.newLeaseStart)} → ${fmtDate(data.newLeaseEnd)}\nNew Rent: ₹${Math.round(data.newRent).toLocaleString("en-IN")}`
          );
        },
        onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to renew lease"),
      }
    );
  };

  const handleRevision = () => {
    setRevisionError("");
    // Parse DD/MM/YYYY
    const parts = revisionDate.trim().split("/");
    const isoDate = parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4
      ? `${parts[2]}-${parts[1]}-${parts[0]}`
      : "";

    if (!newRevisionAmount.trim()) {
      setRevisionError("New rent amount is required.");
      return;
    }
    const newRent = parseFloat(newRevisionAmount);
    if (isNaN(newRent) || newRent <= 0) {
      setRevisionError("Enter a valid rent amount greater than zero.");
      return;
    }
    if (!isoDate) {
      setRevisionError("Enter a valid effective date in DD/MM/YYYY format.");
      return;
    }
    if (!isValidCalendarDate(isoDate)) {
      setRevisionError("Invalid date. Please enter a valid date in DD/MM/YYYY format.");
      return;
    }
    // Client-side: effectiveFrom cannot be before lease start
    if (tenant?.leaseStart && isoDate < tenant.leaseStart) {
      const leaseStartDisplay = fmtDate(tenant.leaseStart);
      setRevisionError(`Effective date cannot be before the lease start date (${leaseStartDisplay}).`);
      return;
    }
    // Client-side: prevent duplicate effective date
    const duplicate = (rentRevisions ?? []).some(r => r.effectiveFrom === isoDate);
    if (duplicate) {
      setRevisionError("A revision already exists for this effective date. Choose a different date.");
      return;
    }

    // All valid — show confirmation
    setPendingRevision({ newRent, isoDate, displayDate: revisionDate.trim(), reason: revisionReason.trim() });
    setShowRevisionConfirm(true);
  };

  const confirmRevision = () => {
    if (!pendingRevision) return;
    setShowRevisionConfirm(false);
    reviseMutation.mutate(
      { id: tenantId, data: { newRent: pendingRevision.newRent, effectiveFrom: pendingRevision.isoDate, reason: pendingRevision.reason || undefined, currentRent: tenant ? parseFloat(String(tenant.rentAmount)) : undefined } },
      {
        onSuccess: (data: RentRevision) => {
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRentRevisionsQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setRevisionEnabled(false);
          setNewRevisionAmount("");
          setRevisionDate("");
          setRevisionReason("");
          setRevisionError("");
          setPendingRevision(null);
          Alert.alert(
            "Rent Revised",
            `New rent ₹${Math.round(data.newRent).toLocaleString("en-IN")} effective from ${pendingRevision.displayDate}`
          );
        },
        onError: (err: any) => {
          setRevisionError(err?.response?.data?.error || "Failed to apply revision. Please try again.");
          setPendingRevision(null);
        },
      }
    );
  };

  const handleEditRevision = (r: RentRevision) => {
    const prev = parseFloat(String(r.newRent));
    setEditingRevision(r);
    setEditAmount(String(Math.round(prev)));
    setEditDate(fmtDate(r.effectiveFrom));
    setEditReason(r.reason ?? "");
    setEditError("");
  };

  const confirmEditRevision = () => {
    if (!editingRevision) return;
    setEditError("");
    const parts = editDate.trim().split("/");
    if (parts.length !== 3 || parts[2].length !== 4) { setEditError("Enter date as DD/MM/YYYY."); return; }
    const isoDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    if (!isValidCalendarDate(isoDate)) { setEditError("Invalid date. Please enter a valid date in DD/MM/YYYY format."); return; }
    const amt = parseFloat(editAmount);
    if (!editAmount.trim() || isNaN(amt) || amt <= 0) { setEditError("Enter a valid rent amount greater than zero."); return; }
    updateRevisionMutation.mutate(
      { id: tenantId, revId: editingRevision.id, data: { newRent: amt, effectiveFrom: isoDate, reason: editReason.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRentRevisionsQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getListGeneratedRentsQueryKey({ tenantId }) });
          setEditingRevision(null);
          Alert.alert("Revision Updated", `Rent updated to ₹${Math.round(amt).toLocaleString("en-IN")} effective ${editDate}`);
        },
        onError: (err: any) => setEditError(err?.response?.data?.error || "Failed to update revision."),
      }
    );
  };

  const handleCancelRevision = (r: RentRevision) => {
    const msg = `Cancel the planned revision to ₹${Math.round(parseFloat(String(r.newRent))).toLocaleString("en-IN")} effective ${fmtDate(r.effectiveFrom)}?\n\nFuture unpaid rents will revert to the previous active amount.`;
    confirmAction(
      "Cancel Revision",
      msg,
      () =>
        cancelRevisionMutation.mutate(
          { id: tenantId, revId: r.id },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListRentRevisionsQueryKey(tenantId) });
              queryClient.invalidateQueries({ queryKey: getListGeneratedRentsQueryKey({ tenantId }) });
              Alert.alert("Revision Cancelled", "Future unpaid rents have been reverted.");
            },
            onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to cancel revision."),
          }
        ),
      { cancelText: "Keep It", confirmText: "Cancel Revision" }
    );
  };

  const handleDeletePayment = (paymentId: number) => {
    const msg = "Delete this payment record? This cannot be undone.";
    const doDelete = () => {
      deletePmtMutation.mutate(
        { id: paymentId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          },
          onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to delete payment"),
        }
      );
    };
    confirmAction("Delete Payment", msg, doDelete);
  };

  // ─── Agreement handlers ─────────────────────────────────────────────────

  const openAgrForm = (agr?: Agreement) => {
    if (agr) {
      setEditingAgrId(agr.id);
      setAgrNumber(agr.agreementNumber);
      setAgrStart(agr.startDate);
      setAgrEnd(agr.endDate);
      setAgrRent(String(agr.monthlyRent));
      setAgrDeposit(agr.securityDeposit != null ? String(agr.securityDeposit) : "");
      setAgrNotes(agr.notes ?? "");
    } else {
      setEditingAgrId(null);
      setAgrNumber("");
      setAgrStart(new Date().toISOString().split("T")[0]);
      setAgrEnd("");
      setAgrRent(tenant ? String(tenant.rentAmount) : "");
      setAgrDeposit("");
      setAgrNotes("");
    }
    setShowAgrForm(true);
  };

  const closeAgrForm = () => {
    setShowAgrForm(false);
    setEditingAgrId(null);
  };

  const handleSaveAgreement = () => {
    if (!agrNumber || !agrStart || !agrEnd || !agrRent) {
      Alert.alert("Error", "Agreement Number, Start Date, End Date and Monthly Rent are required");
      return;
    }
    const data = {
      agreementNumber: agrNumber,
      startDate: agrStart,
      endDate: agrEnd,
      monthlyRent: parseFloat(agrRent),
      securityDeposit: agrDeposit ? parseFloat(agrDeposit) : undefined,
      notes: agrNotes || undefined,
    };
    if (editingAgrId) {
      updateAgrMutation.mutate(
        { id: editingAgrId, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListTenantAgreementsQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
            closeAgrForm();
          },
          onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to update agreement"),
        }
      );
    } else {
      createAgrMutation.mutate(
        { id: tenantId, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListTenantAgreementsQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
            closeAgrForm();
          },
          onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to create agreement"),
        }
      );
    }
  };

  const handleDeleteAgreement = (agrId: number) => {
    const msg = "Delete this rent agreement? This cannot be undone.";
    const doDelete = () => {
      deleteAgrMutation.mutate(
        { id: agrId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListTenantAgreementsQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          },
          onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to delete agreement"),
        }
      );
    };
    confirmAction("Delete Agreement", msg, doDelete);
  };

  // ─── Document handlers ──────────────────────────────────────────────────

  const uploadDocument = async (docType: string, uri: string, fileName: string, mimeType: string) => {
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("documentType", docType);
      formData.append("file", { uri, name: fileName, type: mimeType } as any);
      const resp = await fetch(`${baseUrl}/api/tenants/${tenantId}/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        body: formData,
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error((errData as any).error || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: getListTenantDocumentsQueryKey(tenantId) });
      Alert.alert("Success", "Document uploaded successfully");
    } catch (e: any) {
      Alert.alert("Upload Error", e.message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const pickImageAndUpload = async (docType: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission Needed", "Please allow access to your photo library");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const fileName = asset.fileName || `${docType}_${Date.now()}.jpg`;
      await uploadDocument(docType, asset.uri, fileName, asset.mimeType || "image/jpeg");
    }
  };

  const pickDocAndUpload = async (docType: string) => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      await uploadDocument(docType, asset.uri, asset.name, asset.mimeType || "application/octet-stream");
    }
  };

  const handleDeleteDocument = (docId: number, docName: string) => {
    const msg = `Delete "${docName}"? This cannot be undone.`;
    const doDelete = () => {
      deleteDocMutation.mutate(
        { id: docId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListTenantDocumentsQueryKey(tenantId) });
          },
          onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to delete document"),
        }
      );
    };
    confirmAction("Delete Document", msg, doDelete);
  };

  // ─── Loading / not found ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!tenant) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Tenant not found.</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const anyTenant = tenant as any;
  const monthsElapsed: number = anyTenant.monthsElapsed ?? 1;
  const totalExpected: number = anyTenant.totalExpected ?? 0;
  const totalPaid: number = anyTenant.totalPaid ?? 0;
  const balanceDue: number = anyTenant.balanceDue ?? 0;
  const pendingAdjustment: number = anyTenant.pendingAdjustment ?? 0;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const billingCycleValue: string = anyTenant.billingCycle ?? "monthly";
  const periodLabel =
    billingCycleValue === "weekly" ? "Weeks" :
    billingCycleValue === "quarterly" ? "Quarters" :
    billingCycleValue === "yearly" ? "Years" : "Months";
  const rentSuffix =
    billingCycleValue === "weekly" ? "/wk" :
    billingCycleValue === "quarterly" ? "/qtr" :
    billingCycleValue === "yearly" ? "/yr" : "/mo";
  const billingCycleDisplay =
    billingCycleValue.charAt(0).toUpperCase() + billingCycleValue.slice(1);
  const rentPeriodLabel =
    billingCycleValue === "weekly" ? "Rent Per Week" :
    billingCycleValue === "quarterly" ? "Rent Per Quarter" :
    billingCycleValue === "yearly" ? "Rent Per Year" : "Rent Per Month";

  // The tenant's stored fields ARE the billing settings — business defaults
  // are materialized into them server-side at write time. Never re-resolve
  // defaults here; every screen must show the same stored value.
  const collectionTypeValue: string = anyTenant.rentCollectionType ?? "post_paid";
  const gracePeriodValue: number = anyTenant.gracePeriodDays ?? 5;

  // Latest generated rent (most recent by billing period end)
  const latestRent = generatedRents && generatedRents.length > 0
    ? [...generatedRents].sort((a, b) =>
        ((b as any).billingPeriodEnd ?? "").localeCompare((a as any).billingPeriodEnd ?? "")
      )[0] as any
    : null;
  const currentPeriodDisplay = latestRent
    ? `${fmtBillingDate(latestRent.billingPeriodStart)} – ${fmtBillingDate(latestRent.billingPeriodEnd)}`
    : "Not generated yet";
  const dueDateDisplay = latestRent ? fmtBillingDate(latestRent.dueDate) : "—";
  const nextGenDateDisplay = latestRent
    ? (() => {
        const nextPeriodStart = addOneDayStr(latestRent.billingPeriodEnd);
        // Advance gate: periodStart <= today → next gen = start of next period
        // Post-paid gate: periodEnd <= today → next gen = end of next period
        return fmtBillingDate(
          collectionTypeValue === "advance"
            ? nextPeriodStart
            : computeNextPeriodEnd(nextPeriodStart, billingCycleValue)
        );
      })()
    : "—";

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Tenant Details</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {activeTab === "overview" && !isEditing && (
            <>
              <TouchableOpacity style={styles.iconButton} onPress={() => setIsEditing(true)}>
                <Feather name="edit-2" size={20} color={colors.foreground} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={handleDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending
                  ? <ActivityIndicator size="small" color={colors.destructive} />
                  : <Feather name="trash-2" size={20} color={colors.destructive} />}
              </TouchableOpacity>
            </>
          )}
          {activeTab === "overview" && isEditing && (
            <>
              <TouchableOpacity style={styles.iconButton} onPress={() => setIsEditing(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Feather name="check" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(["overview", "agreement", "documents"] as ActiveTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => { setActiveTab(tab); setIsEditing(false); }}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.mutedForeground }]}>
              {tab === "overview" ? "Overview" : tab === "agreement" ? "Agreement" : "Documents"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─── OVERVIEW TAB ─────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <ScrollView contentContainerStyle={styles.content}>
          {!isEditing ? (
            <>
              {/* Lease expiry notification banner */}
              {(() => {
                const t = tenant as any;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const expiry = new Date(tenant.leaseEnd + "T00:00:00");
                const diffMs = expiry.getTime() - today.getTime();
                const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                const notice = t.renewalNotice ?? 30;
                if (daysLeft > notice) return null;
                const isExpired = daysLeft < 0;
                const isUrgent = !isExpired && daysLeft <= 7;
                const bannerColor = isExpired ? colors.destructive : isUrgent ? colors.warning : colors.primary;
                return (
                  <View style={{ backgroundColor: `${bannerColor}14`, borderWidth: 1, borderColor: `${bannerColor}40`, borderRadius: 12, padding: 14, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <Feather name={isExpired ? "alert-octagon" : "alert-triangle"} size={18} color={bannerColor} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: bannerColor }}>
                        {isExpired ? "Lease Expired" : isUrgent ? `Lease Expiring in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : `Lease Expiring in ${daysLeft} days`}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 3 }}>
                        {isExpired
                          ? `Lease ended ${fmtDate(tenant.leaseEnd)}. ${t.autoRenewal ? "Auto-renewal will process shortly." : "Manual renewal required."}`
                          : `Lease ends ${fmtDate(tenant.leaseEnd)}. ${t.autoRenewal ? "Auto-renewal enabled." : "Renewal action needed."}`}
                      </Text>
                      {!t.autoRenewal && (
                        <TouchableOpacity
                          onPress={() => setShowRenewalForm(v => !v)}
                          style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: `${bannerColor}18`, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignSelf: "flex-start" }}
                        >
                          <Feather name="refresh-cw" size={13} color={bannerColor} />
                          <Text style={{ fontSize: 12, fontWeight: "700", color: bannerColor }}>Renew Lease</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })()}

              {/* Renewal form (inline quick-action) */}
              {showRenewalForm && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1.5, marginBottom: 12 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Feather name="refresh-cw" size={15} color={colors.primary} />
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Renew Lease</Text>
                    <TouchableOpacity style={{ marginLeft: "auto" as any }} onPress={() => setShowRenewalForm(false)}>
                      <Feather name="x" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                  {(() => {
                    const t = tenant as any;
                    const prevRent = tenant.rentAmount;
                    const freqYrs = t.escalationFrequencyYears ?? 1;
                    // Escalation preview comes from the API (shared billing
                    // engine) — never recomputed with a local formula.
                    const escalatedRent = t.escalatedRentPreview ?? prevRent;
                    return (
                      <>
                        <View style={{ flexDirection: "row", gap: 12, marginBottom: 6 }}>
                          <View style={{ flex: 1, backgroundColor: `${colors.primary}10`, borderRadius: 10, padding: 10, alignItems: "center" }}>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Current Rent</Text>
                            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>₹{Math.round(prevRent).toLocaleString("en-IN")}</Text>
                          </View>
                          {t.rentEscalation && (
                            <View style={{ flex: 1, backgroundColor: `${colors.success}10`, borderRadius: 10, padding: 10, alignItems: "center" }}>
                              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>If Escalation Due</Text>
                              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.success }}>₹{Math.round(escalatedRent).toLocaleString("en-IN")}</Text>
                            </View>
                          )}
                        </View>
                        {t.rentEscalation && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: `${colors.primary}08`, padding: 8, borderRadius: 8, marginBottom: 8 }}>
                            <Feather name="info" size={12} color={colors.mutedForeground} />
                            <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1 }}>
                              Escalation applies every {freqYrs} year{freqYrs === 1 ? "" : "s"}. The server checks if it's due.
                            </Text>
                          </View>
                        )}
                        <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12 }]}>Override New Rent (optional)</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border, marginBottom: 8 }]}
                          value={newRentForRenewal}
                          onChangeText={setNewRentForRenewal}
                          keyboardType="numeric"
                          placeholder={`Leave blank to use ₹${Math.round(escalatedRent).toLocaleString("en-IN")}`}
                          placeholderTextColor={colors.mutedForeground}
                        />
                        <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12 }]}>Notes (optional)</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border, marginBottom: 12 }]}
                          value={renewalNotes}
                          onChangeText={setRenewalNotes}
                          placeholder="e.g. Annual renewal, 5% increase"
                          placeholderTextColor={colors.mutedForeground}
                        />
                        <TouchableOpacity
                          style={[styles.recordBtn, { backgroundColor: colors.primary, justifyContent: "center" }]}
                          onPress={() => {
                            const parsed = parseFloat(newRentForRenewal);
                            handleRenewal(isNaN(parsed) ? undefined : parsed);
                          }}
                          disabled={renewMutation.isPending}
                          activeOpacity={0.85}
                        >
                          {renewMutation.isPending
                            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                            : <Feather name="check-circle" size={16} color={colors.primaryForeground} />}
                          <Text style={{ color: colors.primaryForeground, fontWeight: "700", fontSize: 14 }}>Confirm Renewal</Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                </View>
              )}

              {/* Profile card */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.avatarSection}>
                  <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                    <Text style={{ color: colors.primaryForeground, fontSize: 32, fontWeight: "bold" }}>
                      {tenant.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.name, { color: colors.foreground }]}>{tenant.name}</Text>
                  <Text style={[styles.propertyText, { color: colors.mutedForeground }]}>
                    {(tenant as any).propertyName} • Unit {tenant.unitNumber}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: `${tenant.status === "active" ? colors.success : colors.destructive}20`, marginTop: 8 }]}>
                    <Text style={{ color: tenant.status === "active" ? colors.success : colors.destructive, fontWeight: "bold", fontSize: 12, textTransform: "uppercase" }}>
                      {tenant.status}
                    </Text>
                  </View>
                </View>
                <View style={styles.divider} />
                {[
                  { label: "Email", value: tenant.email },
                  { label: "Phone", value: tenant.phone },
                  { label: "Rent Amount", value: `₹${tenant.rentAmount.toLocaleString("en-IN")}${rentSuffix}` },
                  { label: "Billing", value: billingCycleDisplay },
                  { label: "Lease Start", value: fmtDate(tenant.leaseStart) },
                  { label: "Lease End", value: fmtDate(tenant.leaseEnd) },
                ].map(row => (
                  <View key={row.label} style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
                    <Text style={[styles.value, { color: colors.cardForeground }]}>{row.value}</Text>
                  </View>
                ))}
              </View>

              {/* Billing Information */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Feather name="clock" size={16} color={colors.primary} />
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Billing Information</Text>
                </View>
                {([
                  { label: "Billing Cycle", value: billingCycleDisplay },
                  { label: "Collection Type", value: collectionTypeValue === "advance" ? "Advance" : "Post-paid" },
                  { label: "Grace Period", value: gracePeriodValue === 0 ? "None" : `${gracePeriodValue} days` },
                  { label: "Billing Source", value: anyTenant.useBusinessDefault ? "Business Default" : "Custom" },
                  { label: "Current Period", value: currentPeriodDisplay },
                  { label: "Due Date", value: dueDateDisplay },
                  { label: "Next Generation", value: nextGenDateDisplay },
                ] as { label: string; value: string }[]).map((row, idx, arr) => (
                  <View key={row.label} style={[styles.infoRow, { borderBottomColor: colors.border }, idx === arr.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
                    <Text style={[styles.value, { color: colors.cardForeground }]}>{row.value}</Text>
                  </View>
                ))}
              </View>

              {/* Lease Management info card */}
              {(() => {
                const t = tenant as any;
                return (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <Feather name="refresh-cw" size={16} color={colors.primary} />
                      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Lease Management</Text>
                      <View style={[styles.badge, { marginLeft: "auto" as any, backgroundColor: t.autoRenewal ? `${colors.success}18` : `${colors.border}` }]}>
                        <Text style={{ fontSize: 10, fontWeight: "800", color: t.autoRenewal ? colors.success : colors.mutedForeground }}>
                          {t.autoRenewal ? "AUTO-RENEW ON" : "MANUAL"}
                        </Text>
                      </View>
                    </View>
                    {([
                      { label: "Auto Renewal", value: t.autoRenewal ? "Enabled" : "Disabled" },
                      ...(t.autoRenewal ? [
                        {
                          label: "Renewal Method",
                          value: t.renewalDuration === "custom"
                            ? ((): string => {
                                const rawV = Number(t.customRenewalValue ?? 11);
                                const rawU = (t.customRenewalUnit as string) ?? "months";
                                const tot = rawU === "years" ? rawV * 12 : rawV;
                                const yrs = Math.floor(tot / 12);
                                const mos = tot % 12;
                                const p: string[] = [];
                                if (yrs > 0) p.push(`${yrs} year${yrs === 1 ? "" : "s"}`);
                                if (mos > 0) p.push(`${mos} month${mos === 1 ? "" : "s"}`);
                                return p.length ? p.join(" ") : "11 months";
                              })()
                            : "Same Lease Duration"
                        },
                      ] : []),
                      { label: "Rent Escalation", value: t.rentEscalation ? "Enabled" : "Disabled" },
                      ...(t.rentEscalation ? [
                        { label: "Escalation Frequency", value: `Every ${t.escalationFrequencyYears ?? 1} Year${(t.escalationFrequencyYears ?? 1) === 1 ? "" : "s"}` },
                        { label: "Escalation Type", value: t.escalationType === "fixed" ? "Fixed Amount" : "Percentage" },
                        { label: "Escalation Value", value: t.escalationType === "fixed" ? `₹${parseFloat(String(t.escalationValue)).toLocaleString("en-IN")}` : `${parseFloat(String(t.escalationValue))}%` },
                        { label: "Apply", value: t.escalationApply === "automatic" ? "Automatic" : "Manual" },
                      ] : []),
                      { label: "Renewal Notice", value: `${t.renewalNotice ?? 30} days before expiry` },
                    ] as { label: string; value: string }[]).map((row, idx, arr) => (
                      <View key={row.label} style={[styles.infoRow, { borderBottomColor: colors.border }, idx === arr.length - 1 && { borderBottomWidth: 0 }]}>
                        <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
                        <Text style={[styles.value, { color: colors.cardForeground }]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}

              {/* Balance card */}
              <View style={[styles.balanceCard, {
                backgroundColor: balanceDue > 0 ? `${colors.destructive}08` : `${colors.success}08`,
                borderColor: balanceDue > 0 ? `${colors.destructive}30` : `${colors.success}30`,
                marginTop: 16,
              }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Feather name={balanceDue > 0 ? "alert-circle" : "check-circle"} size={16}
                    color={balanceDue > 0 ? colors.destructive : colors.success} />
                  <Text style={{ fontSize: 15, fontWeight: "700", color: balanceDue > 0 ? colors.destructive : colors.success }}>
                    {balanceDue > 0 ? "Outstanding Balance" : "All Paid Up"}
                  </Text>
                </View>
                {[
                  { label: rentPeriodLabel, value: fmt(tenant.rentAmount), color: colors.foreground },
                  { label: `${periodLabel} Active`, value: `${monthsElapsed} ${periodLabel.toLowerCase()}`, color: colors.foreground },
                  { label: "Total Expected", value: fmt(totalExpected), color: colors.primary },
                  { label: "Total Received", value: fmt(totalPaid), color: colors.success },
                  ...(pendingAdjustment > 0 ? [{ label: "Pending Adjustment", value: fmt(pendingAdjustment), color: colors.warning }] : []),
                  { label: "Outstanding Due", value: fmt(balanceDue), color: balanceDue > 0 ? colors.destructive : colors.success },
                ].map(row => (
                  <View key={row.label} style={[styles.balanceRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
                    <Text style={[styles.value, { color: row.color }]}>{row.value}</Text>
                  </View>
                ))}
              </View>

              {/* Action buttons */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  style={[styles.recordBtn, { backgroundColor: colors.primary, flex: 1 }]}
                  onPress={() => router.push(`/payment-add?tenantId=${tenantId}&propertyId=${tenant.propertyId}` as any)}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={16} color={colors.primaryForeground} />
                  <Text style={{ color: colors.primaryForeground, fontWeight: "700", fontSize: 14 }}>Record Payment</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recordBtn, { backgroundColor: "#25D366", flex: 1 }]}
                  onPress={async () => {
                    if (!tenant.phone) { Alert.alert("No Phone Number", "This tenant has no phone number on file."); return; }
                    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                    const now = new Date();
                    const message = [
                      `Hello ${tenant.name},`, ``,
                      `This is a friendly reminder for your rent payment.`, ``,
                      `🏠 Property: ${(tenant as any).propertyName ?? ""}`,
                      `📦 Unit: ${tenant.unitNumber ?? ""}`,
                      `💰 Monthly Rent: ₹${Math.round(tenant.rentAmount).toLocaleString("en-IN")}`,
                      `⚠️ Outstanding Due: ₹${Math.round(balanceDue).toLocaleString("en-IN")}`,
                      `📅 Billing Period: ${MONTHS[now.getMonth()]} ${now.getFullYear()}`, ``,
                      `Please make the payment at your earliest convenience.`, ``,
                      `Thank you,`, `Gemini Rent Manager`,
                    ].join("\n");
                    const result = await shareViaWhatsApp(tenant.phone, message);
                    if (result !== "cancelled") {
                      try {
                        await fetch(`${baseUrl}/api/reminders/send`, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
                          body: JSON.stringify({
                            tenantId: tenant.id,
                            type: "reminder_overdue",
                            message,
                            phone: tenant.phone,
                            status: result === "whatsapp" ? "shared" : "share_sheet",
                          }),
                        });
                      } catch { /* logging is best-effort */ }
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <FontAwesome name="whatsapp" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Send Reminder</Text>
                </TouchableOpacity>
              </View>

              {/* Security deposit card */}
              {(() => {
                const t = tenant as any;
                const hasDeposit = t.securityDeposit != null;
                const isRefunded = t.depositStatus === "refunded";
                const depositColor = isRefunded ? colors.mutedForeground : colors.warning;
                return (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: isRefunded ? colors.border : `${colors.warning}40`, marginTop: 16 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Feather name="shield" size={16} color={depositColor} />
                        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Security Deposit</Text>
                      </View>
                      {hasDeposit && (
                        <View style={[styles.badge, { backgroundColor: `${depositColor}18` }]}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: depositColor, textTransform: "uppercase" }}>
                            {isRefunded ? "Refunded" : "Held"}
                          </Text>
                        </View>
                      )}
                    </View>
                    {!hasDeposit ? (
                      <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }} onPress={() => setIsEditing(true)}>
                        <Feather name="plus-circle" size={16} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14 }}>Add security deposit</Text>
                      </TouchableOpacity>
                    ) : (
                      <>
                        <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                          <Text style={[styles.label, { color: colors.mutedForeground }]}>Amount</Text>
                          <Text style={[styles.value, { color: colors.foreground }]}>₹{Number(t.securityDeposit).toLocaleString("en-IN")}</Text>
                        </View>
                        {t.depositDate ? (
                          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.label, { color: colors.mutedForeground }]}>Deposit Date</Text>
                            <Text style={[styles.value, { color: colors.foreground }]}>{fmtDate(t.depositDate)}</Text>
                          </View>
                        ) : null}
                        {!isRefunded && (
                          <TouchableOpacity
                            style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: `${colors.success}12`, borderWidth: 1, borderColor: `${colors.success}30` }}
                            onPress={() => {
                              const msg = `Mark the deposit of ₹${Number(t.securityDeposit).toLocaleString("en-IN")} as refunded?`;
                              const doRefund = () => {
                                updateMutation.mutate(
                                  { id: tenantId, data: { depositStatus: "refunded" } as any },
                                  {
                                    onSuccess: (data) => {
                                      queryClient.setQueryData(getGetTenantQueryKey(tenantId), data);
                                      queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
                                    },
                                    onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to update deposit"),
                                  }
                                );
                              };
                              confirmAction("Refund Deposit", msg, doRefund, { confirmText: "Mark Refunded", destructive: false });
                            }}
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending ? <ActivityIndicator size="small" color={colors.success} /> : <Feather name="check-circle" size={15} color={colors.success} />}
                            <Text style={{ color: colors.success, fontWeight: "700", fontSize: 14 }}>Mark as Refunded</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                );
              })()}

              {/* Rent Revision History */}
              {rentRevisions && rentRevisions.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Feather name="edit-2" size={16} color={colors.primary} />
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Rent Revision History</Text>
                    <View style={[styles.badge, { marginLeft: "auto" as any, backgroundColor: `${colors.primary}14` }]}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: colors.primary }}>{rentRevisions.length} REVISION{rentRevisions.length !== 1 ? "S" : ""}</Text>
                    </View>
                  </View>
                  {rentRevisions.map((r, idx) => {
                    const prev = parseFloat(String(r.previousRent));
                    const next = parseFloat(String(r.newRent));
                    const isIncrease = next > prev;
                    const changedOnDate = new Date(r.createdAt);
                    const changedOnDisplay = `${String(changedOnDate.getDate()).padStart(2, "0")}/${String(changedOnDate.getMonth() + 1).padStart(2, "0")}/${changedOnDate.getFullYear()}`;
                    const todayIso = new Date().toISOString().split("T")[0];
                    const isFuture = r.effectiveFrom > todayIso;
                    const isCancelled = r.status === "cancelled";
                    const isEditable = isFuture && !isCancelled && r.changedBy === "manual";
                    return (
                      <View key={r.id} style={[{ paddingVertical: 12, opacity: isCancelled ? 0.55 : 1 }, idx < rentRevisions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                        {/* Amount + status badge row */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: isCancelled ? colors.mutedForeground : colors.foreground, textDecorationLine: isCancelled ? "line-through" : "none" }}>
                            ₹{Math.round(prev).toLocaleString("en-IN")} → ₹{Math.round(next).toLocaleString("en-IN")}
                          </Text>
                          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                            {isCancelled ? (
                              <View style={[styles.badge, { backgroundColor: `${colors.mutedForeground}18` }]}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: colors.mutedForeground }}>CANCELLED</Text>
                              </View>
                            ) : isFuture ? (
                              <View style={[styles.badge, { backgroundColor: `${colors.primary}14` }]}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>PENDING</Text>
                              </View>
                            ) : (
                              <View style={[styles.badge, { backgroundColor: isIncrease ? `${colors.destructive}15` : `${colors.primary}15` }]}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: isIncrease ? colors.destructive : colors.primary }}>
                                  {isIncrease ? "↑ INCREASE" : "↓ DECREASE"}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                        {/* Audit fields grid */}
                        <View style={{ gap: 3 }}>
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground, width: 90 }}>Effective From</Text>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }}>{fmtDate(r.effectiveFrom)}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground, width: 90 }}>Changed By</Text>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground, textTransform: "capitalize" }}>{r.changedBy ?? "manual"}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground, width: 90 }}>Changed On</Text>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }}>{changedOnDisplay}</Text>
                          </View>
                          {r.reason ? (
                            <View style={{ flexDirection: "row", gap: 4 }}>
                              <Text style={{ fontSize: 11, color: colors.mutedForeground, width: 90 }}>Reason</Text>
                              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground, flex: 1 }}>{r.reason}</Text>
                            </View>
                          ) : null}
                        </View>
                        {/* Edit / Cancel actions — only for future active manual revisions */}
                        {isEditable && (
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                            <TouchableOpacity
                              onPress={() => handleEditRevision(r)}
                              style={{ flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.primary, alignItems: "center" }}
                            >
                              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleCancelRevision(r)}
                              style={{ flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.destructive, alignItems: "center" }}
                            >
                              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.destructive }}>Cancel Revision</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Lease Renewal History */}
              {leaseRenewals && leaseRenewals.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Feather name="git-branch" size={16} color={colors.primary} />
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Renewal History</Text>
                    <View style={[styles.badge, { marginLeft: "auto" as any, backgroundColor: `${colors.primary}14` }]}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: colors.primary }}>{leaseRenewals.length} RENEWAL{leaseRenewals.length !== 1 ? "S" : ""}</Text>
                    </View>
                  </View>
                  {leaseRenewals.map((r, idx) => {
                    const increase = r.increaseAmount ?? 0;
                    const pct = r.increasePercent ?? 0;
                    return (
                      <View key={r.id} style={[{ paddingVertical: 12, borderBottomWidth: idx < leaseRenewals.length - 1 ? 1 : 0, borderBottomColor: colors.border }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{fmtDate(r.renewalDate)}</Text>
                          <View style={[styles.badge, { backgroundColor: r.renewedBy === "automatic" ? `${colors.primary}18` : `${colors.success}18` }]}>
                            <Text style={{ fontSize: 10, fontWeight: "800", color: r.renewedBy === "automatic" ? colors.primary : colors.success }}>
                              {(r.renewedBy ?? "manual").toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                          <View style={{ flex: 1, minWidth: 120 }}>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Prev Lease</Text>
                            <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "500" }}>{fmtDate(r.previousLeaseStart)} → {fmtDate(r.previousLeaseEnd)}</Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 120 }}>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>New Lease</Text>
                            <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "500" }}>{fmtDate(r.newLeaseStart)} → {fmtDate(r.newLeaseEnd)}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                          <View>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Old Rent</Text>
                            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>₹{Math.round(r.previousRent).toLocaleString("en-IN")}</Text>
                          </View>
                          <Feather name="arrow-right" size={14} color={colors.mutedForeground} style={{ alignSelf: "flex-end", marginBottom: 2 }} />
                          <View>
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>New Rent</Text>
                            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.success }}>₹{Math.round(r.newRent).toLocaleString("en-IN")}</Text>
                          </View>
                          {increase !== 0 && (
                            <View style={{ marginLeft: "auto" as any, alignItems: "flex-end" }}>
                              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Increase</Text>
                              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.success }}>+₹{Math.round(increase).toLocaleString("en-IN")} ({parseFloat(String(pct)).toFixed(1)}%)</Text>
                            </View>
                          )}
                        </View>
                        {r.notes && <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 6, fontStyle: "italic" }}>{r.notes}</Text>}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Rent Ledger */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Rent Ledger</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{payments?.length ?? 0} records</Text>
                </View>
                {paymentsLoading ? (
                  <View style={{ padding: 20, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>
                ) : !payments || payments.length === 0 ? (
                  <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                    <Feather name="inbox" size={32} color={colors.mutedForeground} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No payments recorded yet</Text>
                  </View>
                ) : (
                  [...payments].reverse().map((p, idx) => {
                    const monthLabel = new Date(p.year, p.month - 1).toLocaleString("default", { month: "short", year: "numeric" });
                    const statusColor = p.status === "paid" ? colors.success : p.status === "partial" ? colors.warning : colors.destructive;
                    return (
                      <View key={p.id} style={[styles.ledgerRow, { borderBottomColor: colors.border }, idx === payments.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{monthLabel}</Text>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                            {p.method.replace(/_/g, " ")} • {fmtDate(p.paymentDate)}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginRight: 8 }}>
                          ₹{Number(p.amount).toLocaleString("en-IN")}
                        </Text>
                        <View style={[styles.badge, { backgroundColor: `${statusColor}20` }]}>
                          <Text style={{ fontSize: 9, fontWeight: "800", color: statusColor }}>{p.status.toUpperCase()}</Text>
                        </View>
                        <TouchableOpacity style={{ padding: 8 }} onPress={() => router.push(`/payment-edit?id=${p.id}` as any)}>
                          <Feather name="edit-2" size={14} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity style={{ padding: 8 }} onPress={() => router.push(`/payment-receipt?id=${p.id}` as any)}>
                          <Feather name="external-link" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                        <TouchableOpacity style={{ padding: 8 }} onPress={() => handleDeletePayment(p.id)} disabled={deletePmtMutation.isPending}>
                          <Feather name="trash-2" size={14} color={colors.destructive} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </View>
            </>
          ) : (
            /* Edit form */
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Full Name</Text>
              <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={name} onChangeText={setName} />
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Email</Text>
              <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Phone</Text>
              <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.foreground }]}>Unit Number</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={unitNumber} onChangeText={setUnitNumber} />
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.foreground }]}>Rent Amount</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={rentAmount} onChangeText={setRentAmount} keyboardType="numeric" />
                </View>
              </View>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Status</Text>
              <View style={[styles.segmentedControl, { marginBottom: 16 }]}>
                {(["active", "inactive", "evicted"] as const).map(s => (
                  <TouchableOpacity key={s} style={[styles.segmentOption, status === s && { backgroundColor: colors.primary }]} onPress={() => setStatus(s)}>
                    <Text style={{ fontSize: 12, color: status === s ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Lease Start */}
              <View style={{ marginBottom: 4 }}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease Start (DD/MM/YYYY)</Text>
                <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={leaseStartDisplay} onChangeText={onLeaseStartChange} placeholder="DD/MM/YYYY" placeholderTextColor="#999" keyboardType="numeric" />
              </View>

              {/* Lease Duration */}
              <View style={{ marginBottom: 4 }}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease Duration</Text>
                <View style={styles.row}>
                  <View style={styles.flex1}>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Years (0 – 99)</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.input, overflow: "hidden" }}>
                      <TouchableOpacity
                        style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
                        onPress={() => { setDurationYears(y => Math.max(0, y - 1)); setLeaseDurationDirty(true); }}
                      >
                        <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>−</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{durationYears}</Text>
                      </View>
                      <TouchableOpacity
                        style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}
                        onPress={() => { setDurationYears(y => Math.min(99, y + 1)); setLeaseDurationDirty(true); }}
                      >
                        <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.flex1}>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Months (0 – 11)</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.input, overflow: "hidden" }}>
                      <TouchableOpacity
                        style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
                        onPress={() => { setDurationMonths(m => Math.max(0, m - 1)); setLeaseDurationDirty(true); }}
                      >
                        <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>−</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{durationMonths}</Text>
                      </View>
                      <TouchableOpacity
                        style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}
                        onPress={() => { setDurationMonths(m => Math.min(11, m + 1)); setLeaseDurationDirty(true); }}
                      >
                        <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>

              {/* Lease End — auto-calculated, read-only */}
              <View style={{ marginBottom: 4 }}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease End (auto-calculated)</Text>
                <View style={[styles.input, { backgroundColor: colors.card, justifyContent: "center", borderColor: colors.border }]}>
                  <Text style={{ fontSize: 16, color: leaseEndToSubmit ? colors.foreground : colors.mutedForeground }}>
                    {leaseEndToSubmit ? fmtDate(leaseEndToSubmit) : "— / — / ——"}
                  </Text>
                </View>
              </View>
              <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>Security Deposit (Optional)</Text>
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Amount (₹)</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={depositAmount} onChangeText={setDepositAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedForeground} />
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Date (DD/MM/YYYY)</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={depositDateDisplay} onChangeText={onDepositDateChange} placeholder="DD/MM/YYYY" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                </View>
              </View>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 8 }]}>Status</Text>
              <View style={[styles.segmentedControl, { marginBottom: 8 }]}>
                {(["held", "refunded"] as const).map(s => (
                  <TouchableOpacity key={s} style={[styles.segmentOption, depositStatus === s && { backgroundColor: s === "refunded" ? colors.success : colors.warning }]} onPress={() => setDepositStatus(s)}>
                    <Text style={{ fontSize: 12, color: depositStatus === s ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Billing Settings */}
              <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>Billing Settings</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
                Controls how rent entries are automatically generated for this tenant
              </Text>

              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 }}
                onPress={() => setUseBusinessDefault(v => !v)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Use Business Default</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>Apply global billing settings</Text>
                </View>
                <View style={[{
                  width: 46, height: 26, borderRadius: 13, padding: 2,
                  backgroundColor: useBusinessDefault ? colors.primary : colors.border,
                  justifyContent: "center",
                }]}>
                  <View style={[{
                    width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff",
                    alignSelf: useBusinessDefault ? "flex-end" : "flex-start",
                  }]} />
                </View>
              </TouchableOpacity>

              {!useBusinessDefault && (
                <View style={{ marginTop: 12, gap: 12 }}>
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Billing Cycle</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                      {(["weekly", "monthly", "quarterly", "yearly"] as const).map(opt => (
                        <TouchableOpacity
                          key={opt}
                          style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, alignItems: "center" },
                            billingCycle === opt
                              ? { backgroundColor: `${colors.primary}15`, borderColor: colors.primary }
                              : { backgroundColor: colors.input, borderColor: colors.border }]}
                          onPress={() => setBillingCycle(opt)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: billingCycle === opt ? colors.primary : colors.foreground, textTransform: "capitalize" }}>{opt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Collection Timing</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                      {(["post_paid", "advance"] as const).map(opt => (
                        <TouchableOpacity
                          key={opt}
                          style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, alignItems: "center" },
                            rentCollectionType === opt
                              ? { backgroundColor: `${colors.primary}15`, borderColor: colors.primary }
                              : { backgroundColor: colors.input, borderColor: colors.border }]}
                          onPress={() => setRentCollectionType(opt)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: rentCollectionType === opt ? colors.primary : colors.foreground }}>
                            {opt === "post_paid" ? "Post-paid" : "Advance"}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Grace Period (days)</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      {[0, 3, 5, 7, 10].map(d => (
                        <TouchableOpacity
                          key={d}
                          style={[{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5 },
                            gracePeriodDays === d
                              ? { backgroundColor: colors.primary, borderColor: colors.primary }
                              : { backgroundColor: colors.input, borderColor: colors.border }]}
                          onPress={() => setGracePeriodDays(d)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: gracePeriodDays === d ? colors.primaryForeground : colors.foreground }}>
                            {d === 0 ? "None" : `${d}d`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {/* Lease Management */}
              <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>Lease Management</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
                Configure automatic renewal, rent escalation, and notification preferences.
              </Text>

              {/* Auto Renewal */}
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 }}
                onPress={() => setAutoRenewal(v => !v)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Auto Renewal</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>Automatically extend lease on expiry</Text>
                </View>
                <View style={[{ width: 46, height: 26, borderRadius: 13, padding: 2, backgroundColor: autoRenewal ? colors.primary : colors.border, justifyContent: "center" }]}>
                  <View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: autoRenewal ? "flex-end" : "flex-start" }]} />
                </View>
              </TouchableOpacity>

              {autoRenewal && (
                <View style={{ marginTop: 10, gap: 10 }}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Renewal Method</Text>
                  {(["same", "custom"] as const).map(opt => (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => setRenewalMethod(opt)}
                      activeOpacity={0.7}
                      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6 }}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: renewalMethod === opt ? colors.primary : colors.border, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                        {renewalMethod === opt && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                          {opt === "same" ? "Renew for Same Lease Duration" : "Choose New Lease Duration"}
                        </Text>
                        {opt === "same" && <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 1 }}>New lease will match the original lease length</Text>}
                      </View>
                    </TouchableOpacity>
                  ))}
                  {renewalMethod === "custom" && (
                    <View style={{ marginTop: 4, gap: 10 }}>
                      {/* Quick presets — active when total months match */}
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                        {([
                          { label: "11 Mo", total: 11 },
                          { label: "12 Mo", total: 12 },
                          { label: "18 Mo", total: 18 },
                          { label: "2 Yr",  total: 24 },
                          { label: "3 Yr",  total: 36 },
                          { label: "5 Yr",  total: 60 },
                          { label: "11 Yr", total: 132 },
                        ]).map(({ label, total }) => {
                          const active = renewalYears * 12 + renewalMonths === total;
                          return (
                            <TouchableOpacity
                              key={label}
                              style={[{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, borderWidth: 1.5 },
                                active ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                       : { backgroundColor: colors.input, borderColor: colors.border }]}
                              onPress={() => { setRenewalYears(Math.floor(total / 12)); setRenewalMonths(total % 12); }}
                              activeOpacity={0.7}
                            >
                              <Text style={{ fontSize: 12, fontWeight: "600", color: active ? colors.primaryForeground : colors.foreground }}>{label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Years + Months steppers */}
                      <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Custom Lease Duration</Text>
                      <View style={styles.row}>
                        <View style={styles.flex1}>
                          <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Years (0 – 99)</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.input, overflow: "hidden" }}>
                            <TouchableOpacity
                              style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
                              onPress={() => setRenewalYears(y => Math.max(0, y - 1))}
                            >
                              <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>−</Text>
                            </TouchableOpacity>
                            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                              <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{renewalYears}</Text>
                            </View>
                            <TouchableOpacity
                              style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}
                              onPress={() => setRenewalYears(y => Math.min(99, y + 1))}
                            >
                              <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>+</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.flex1}>
                          <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Months (0 – 11)</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.input, overflow: "hidden" }}>
                            <TouchableOpacity
                              style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
                              onPress={() => setRenewalMonths(m => Math.max(0, m - 1))}
                            >
                              <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>−</Text>
                            </TouchableOpacity>
                            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                              <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{renewalMonths}</Text>
                            </View>
                            <TouchableOpacity
                              style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}
                              onPress={() => setRenewalMonths(m => Math.min(11, m + 1))}
                            >
                              <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>+</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {(renewalYears > 0 || renewalMonths > 0) && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: `${colors.primary}10`, padding: 10, borderRadius: 8 }}>
                          <Feather name="calendar" size={12} color={colors.primary} />
                          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>
                            {(() => {
                              const p: string[] = [];
                              if (renewalYears > 0) p.push(`${renewalYears} year${renewalYears === 1 ? "" : "s"}`);
                              if (renewalMonths > 0) p.push(`${renewalMonths} month${renewalMonths === 1 ? "" : "s"}`);
                              return `Lease will renew for ${p.join(" ")}`;
                            })()}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* Rent Escalation */}
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, marginTop: 8 }}
                onPress={() => setRentEscalation(v => !v)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Rent Escalation</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>Increase rent on a fixed schedule, independent of lease renewal</Text>
                </View>
                <View style={[{ width: 46, height: 26, borderRadius: 13, padding: 2, backgroundColor: rentEscalation ? colors.primary : colors.border, justifyContent: "center" }]}>
                  <View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: rentEscalation ? "flex-end" : "flex-start" }]} />
                </View>
              </TouchableOpacity>

              {rentEscalation && (
                <View style={{ marginTop: 10, gap: 12 }}>
                  {/* Escalation Frequency */}
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Escalation Frequency</Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 8 }}>Rent increases every N years, independent of lease renewal</Text>
                    {/* Quick presets */}
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["1", "2", "3", "5"].map(preset => {
                        const active = escalationFrequencyYears === preset;
                        return (
                          <TouchableOpacity
                            key={preset}
                            style={[{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5 },
                              active ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                     : { backgroundColor: colors.input, borderColor: colors.border }]}
                            onPress={() => setEscalationFrequencyYears(preset)}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "600", color: active ? colors.primaryForeground : colors.foreground }}>
                              Every {preset} Year{preset === "1" ? "" : "s"}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {/* Custom frequency */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontWeight: "500" }}>Every</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border, width: 80, marginBottom: 0, height: 44, textAlign: "center" }]}
                        value={escalationFrequencyYears}
                        onChangeText={v => setEscalationFrequencyYears(v.replace(/[^0-9]/g, ""))}
                        keyboardType="numeric"
                        placeholder="N"
                        placeholderTextColor={colors.mutedForeground}
                      />
                      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontWeight: "500" }}>
                        Year{escalationFrequencyYears === "1" ? "" : "s"}
                      </Text>
                    </View>
                  </View>
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Escalation Type</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                      {([["percentage", "Percentage (%)"], ["fixed", "Fixed Amount (₹)"]] as const).map(([opt, label]) => (
                        <TouchableOpacity
                          key={opt}
                          style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, alignItems: "center" },
                            escalationType === opt
                              ? { backgroundColor: `${colors.primary}15`, borderColor: colors.primary }
                              : { backgroundColor: colors.input, borderColor: colors.border }]}
                          onPress={() => setEscalationType(opt)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: escalationType === opt ? colors.primary : colors.foreground }}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>
                      {escalationType === "percentage" ? "Increase By (%)" : "Increase By (₹)"}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      {(escalationType === "percentage" ? ["5", "8", "10"] : ["500", "1000", "2000"]).map(preset => (
                        <TouchableOpacity
                          key={preset}
                          style={[{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5 },
                            escalationValue === preset
                              ? { backgroundColor: colors.primary, borderColor: colors.primary }
                              : { backgroundColor: colors.input, borderColor: colors.border }]}
                          onPress={() => setEscalationValue(preset)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: escalationValue === preset ? colors.primaryForeground : colors.foreground }}>
                            {escalationType === "percentage" ? `${preset}%` : `₹${preset}`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      <TextInput
                        style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border, flex: 1, marginBottom: 0, height: 40 }]}
                        value={escalationValue}
                        onChangeText={setEscalationValue}
                        keyboardType="numeric"
                        placeholder={escalationType === "percentage" ? "Custom %" : "Custom ₹"}
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                    {tenant && escalationValue && parseFloat(escalationValue) > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: `${colors.success}12`, padding: 10, borderRadius: 8 }}>
                        <Feather name="trending-up" size={12} color={colors.success} />
                        <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>
                          ₹{Math.round(tenant.rentAmount).toLocaleString("en-IN")} →{" "}
                          ₹{escalationType === "percentage"
                            ? Math.round(tenant.rentAmount * (1 + parseFloat(escalationValue) / 100)).toLocaleString("en-IN")
                            : Math.round(tenant.rentAmount + parseFloat(escalationValue)).toLocaleString("en-IN")}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View>
                    <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Apply</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                      {([["automatic", "Automatic"], ["manual", "Manual"]] as const).map(([opt, label]) => (
                        <TouchableOpacity
                          key={opt}
                          style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, alignItems: "center" },
                            escalationApply === opt
                              ? { backgroundColor: `${colors.primary}15`, borderColor: colors.primary }
                              : { backgroundColor: colors.input, borderColor: colors.border }]}
                          onPress={() => setEscalationApply(opt)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: escalationApply === opt ? colors.primary : colors.foreground }}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {/* Manual Rent Revision */}
              <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
              <View style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 2 }]}>Manual Rent Revision</Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Override current rent without triggering a full lease renewal</Text>
                  </View>
                  <Switch
                    value={revisionEnabled}
                    onValueChange={(v) => { setRevisionEnabled(v); setRevisionError(""); }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.background}
                  />
                </View>
                {revisionEnabled && (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    <View>
                      <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>New Rent Amount (₹)</Text>
                      <TextInput
                        style={[styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: revisionError && !newRevisionAmount.trim() ? colors.destructive : colors.border }]}
                        value={newRevisionAmount}
                        onChangeText={(v) => { setNewRevisionAmount(v); setRevisionError(""); }}
                        placeholder={`Current: ₹${Math.round(parseFloat(String(tenant?.rentAmount ?? "0"))).toLocaleString("en-IN")}`}
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="numeric"
                      />
                    </View>
                    <View>
                      <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Effective From (DD/MM/YYYY)</Text>
                      {tenant?.leaseStart ? (
                        <Text style={{ fontSize: 10, color: colors.mutedForeground, marginBottom: 4 }}>
                          Must be on or after lease start: {fmtDate(tenant.leaseStart)}
                        </Text>
                      ) : null}
                      <TextInput
                        style={[styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }]}
                        value={revisionDate}
                        onChangeText={(v) => { setRevisionDate(v); setRevisionError(""); }}
                        placeholder="e.g. 01/08/2025"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="numeric"
                        maxLength={10}
                      />
                    </View>
                    <View>
                      <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Reason (Optional)</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {["Negotiation", "Discount", "Market Rate", "Owner Decision", "Agreement Amendment", "Other"].map(opt => (
                          <TouchableOpacity
                            key={opt}
                            style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
                              revisionReason === opt
                                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                : { backgroundColor: colors.input, borderColor: colors.border }]}
                            onPress={() => setRevisionReason(r => r === opt ? "" : opt)}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 11, fontWeight: "600", color: revisionReason === opt ? colors.primaryForeground : colors.foreground }}>{opt}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    {/* Inline validation error */}
                    {revisionError ? (
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 10, borderRadius: 8, backgroundColor: `${colors.destructive}12` }}>
                        <Feather name="alert-circle" size={14} color={colors.destructive} style={{ marginTop: 1 }} />
                        <Text style={{ fontSize: 12, color: colors.destructive, flex: 1, lineHeight: 18 }}>{revisionError}</Text>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                      <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, alignItems: "center", borderColor: colors.border, backgroundColor: colors.input }}
                        onPress={() => { setRevisionEnabled(false); setNewRevisionAmount(""); setRevisionDate(""); setRevisionReason(""); setRevisionError(""); }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.mutedForeground }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 2, paddingVertical: 11, borderRadius: 10, alignItems: "center", backgroundColor: colors.primary, opacity: reviseMutation.isPending ? 0.6 : 1 }}
                        onPress={handleRevision}
                        disabled={reviseMutation.isPending}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primaryForeground }}>
                          {reviseMutation.isPending ? "Applying..." : "Review & Confirm"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* Revision Confirmation Modal */}
              <Modal
                visible={showRevisionConfirm}
                transparent
                animationType="fade"
                onRequestClose={() => setShowRevisionConfirm(false)}
              >
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
                  <View style={{ width: "100%", maxWidth: 400, backgroundColor: colors.card, borderRadius: 16, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                    {/* Header */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <Feather name="edit-2" size={18} color={colors.primary} />
                      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>Confirm Rent Revision</Text>
                    </View>
                    {/* Summary rows */}
                    <View style={{ gap: 10, marginBottom: 16 }}>
                      {[
                        { label: "Current Rent", value: `₹${Math.round(parseFloat(String(tenant?.rentAmount ?? "0"))).toLocaleString("en-IN")}` },
                        { label: "New Rent", value: `₹${pendingRevision ? Math.round(pendingRevision.newRent).toLocaleString("en-IN") : "—"}` },
                        { label: "Effective From", value: pendingRevision?.displayDate ?? "—" },
                        { label: "Escalation Base", value: `₹${pendingRevision ? Math.round(pendingRevision.newRent).toLocaleString("en-IN") : "—"}` },
                      ].map(({ label, value }) => (
                        <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{label}</Text>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{value}</Text>
                        </View>
                      ))}
                    </View>
                    {/* Disclaimer */}
                    <View style={{ padding: 12, borderRadius: 10, backgroundColor: `${colors.primary}10`, marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, color: colors.foreground, lineHeight: 18 }}>
                        Historical records, receipts, payment history, ledger and reports will remain unchanged.{"\n\n"}Only future rent generation will use the revised rent.
                      </Text>
                    </View>
                    {/* Buttons */}
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: "center", borderColor: colors.border, backgroundColor: colors.input }}
                        onPress={() => { setShowRevisionConfirm(false); setPendingRevision(null); }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.mutedForeground }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: colors.primary, opacity: reviseMutation.isPending ? 0.6 : 1 }}
                        onPress={confirmRevision}
                        disabled={reviseMutation.isPending}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primaryForeground }}>
                          {reviseMutation.isPending ? "Applying..." : "Confirm Revision"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>

              {/* Edit Revision Modal */}
              <Modal
                visible={!!editingRevision}
                transparent
                animationType="fade"
                onRequestClose={() => setEditingRevision(null)}
              >
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
                  <View style={{ width: "100%", maxWidth: 400, backgroundColor: colors.card, borderRadius: 16, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <Feather name="edit-2" size={18} color={colors.primary} />
                      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>Edit Pending Revision</Text>
                    </View>
                    {editError ? (
                      <View style={{ padding: 10, borderRadius: 8, backgroundColor: `${colors.destructive}14`, marginBottom: 12 }}>
                        <Text style={{ fontSize: 12, color: colors.destructive }}>{editError}</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>New Rent Amount (₹)</Text>
                    <TextInput
                      style={[styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: editError && !editAmount.trim() ? colors.destructive : colors.border, marginBottom: 12 }]}
                      value={editAmount}
                      onChangeText={(v) => { setEditAmount(v); setEditError(""); }}
                      keyboardType="numeric"
                      placeholder="Enter new rent"
                      placeholderTextColor={colors.mutedForeground}
                    />
                    <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>Effective From (DD/MM/YYYY)</Text>
                    <TextInput
                      style={[styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border, marginBottom: 12 }]}
                      value={editDate}
                      onChangeText={(v) => { setEditDate(v); setEditError(""); }}
                      placeholder="DD/MM/YYYY"
                      placeholderTextColor={colors.mutedForeground}
                    />
                    <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>Reason (optional)</Text>
                    <TextInput
                      style={[styles.input, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border, marginBottom: 20 }]}
                      value={editReason}
                      onChangeText={setEditReason}
                      placeholder="Reason for revision"
                      placeholderTextColor={colors.mutedForeground}
                    />
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: "center", borderColor: colors.border, backgroundColor: colors.input }}
                        onPress={() => setEditingRevision(null)}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.mutedForeground }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: colors.primary, opacity: updateRevisionMutation.isPending ? 0.6 : 1 }}
                        onPress={confirmEditRevision}
                        disabled={updateRevisionMutation.isPending}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primaryForeground }}>
                          {updateRevisionMutation.isPending ? "Saving..." : "Save Changes"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>

              {/* Renewal Notice */}
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Renewal Notice Period</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>Show expiry reminder this many days before lease ends</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {([30, 60, 90] as const).map(d => (
                    <TouchableOpacity
                      key={d}
                      style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, alignItems: "center" },
                        renewalNotice === d
                          ? { backgroundColor: colors.primary, borderColor: colors.primary }
                          : { backgroundColor: colors.input, borderColor: colors.border }]}
                      onPress={() => setRenewalNotice(d)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: renewalNotice === d ? colors.primaryForeground : colors.foreground }}>{d} days</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* ─── AGREEMENT TAB ────────────────────────────────────────────── */}
      {activeTab === "agreement" && (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Agreement creation / edit form */}
          {showAgrForm && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1.5, marginBottom: 16 }]}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>
                {editingAgrId ? "Edit Agreement" : "New Rent Agreement"}
              </Text>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Agreement Number *</Text>
              <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={agrNumber} onChangeText={setAgrNumber} placeholder="e.g. AGR-2025-001" placeholderTextColor={colors.mutedForeground} />
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.foreground }]}>Start Date *</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={agrStart} onChangeText={setAgrStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} />
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.foreground }]}>End Date *</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={agrEnd} onChangeText={setAgrEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.foreground }]}>Monthly Rent (₹) *</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={agrRent} onChangeText={setAgrRent} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedForeground} />
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.inputLabel, { color: colors.foreground }]}>Security Deposit (₹)</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} value={agrDeposit} onChangeText={setAgrDeposit} keyboardType="numeric" placeholder="Optional" placeholderTextColor={colors.mutedForeground} />
                </View>
              </View>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Notes</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border, height: 80, textAlignVertical: "top", paddingTop: 10 }]}
                value={agrNotes}
                onChangeText={setAgrNotes}
                placeholder="Optional notes..."
                placeholderTextColor={colors.mutedForeground}
                multiline
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[styles.recordBtn, { flex: 1, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }]} onPress={closeAgrForm}>
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recordBtn, { flex: 1, backgroundColor: colors.primary }]}
                  onPress={handleSaveAgreement}
                  disabled={createAgrMutation.isPending || updateAgrMutation.isPending}
                >
                  {(createAgrMutation.isPending || updateAgrMutation.isPending)
                    ? <ActivityIndicator color={colors.primaryForeground} />
                    : <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>{editingAgrId ? "Update" : "Create"} Agreement</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Add Agreement button */}
          {!showAgrForm && (
            <TouchableOpacity
              style={[styles.recordBtn, { backgroundColor: colors.primary, marginBottom: 16 }]}
              onPress={() => openAgrForm()}
            >
              <Feather name="plus" size={18} color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontWeight: "700", fontSize: 15 }}>Add Rent Agreement</Text>
            </TouchableOpacity>
          )}

          {/* Agreements list */}
          {agreementsLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />
          ) : !agreements || agreements.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 48, gap: 10 }}>
              <Feather name="file-text" size={48} color={colors.mutedForeground} />
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>No Agreements Yet</Text>
              <Text style={{ fontSize: 14, color: colors.mutedForeground, textAlign: "center" }}>
                Tap "Add Rent Agreement" to create the first agreement for this tenant.
              </Text>
            </View>
          ) : (
            agreements.map(agr => {
              const isActive = agr.status === "active";
              const today = new Date().toISOString().split("T")[0];
              const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
              const isExpiringSoon = isActive && agr.endDate <= in30Days;
              const statusColor = isActive ? (isExpiringSoon ? colors.warning : colors.success) : colors.destructive;
              return (
                <View key={agr.id} style={[styles.card, { backgroundColor: colors.card, borderColor: isExpiringSoon ? `${colors.warning}50` : colors.border, marginBottom: 14 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{agr.agreementNumber}</Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                        Created {fmtDate(agr.createdAt)}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: `${statusColor}18` }]}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: statusColor, textTransform: "uppercase" }}>
                        {isExpiringSoon ? "Expiring Soon" : agr.status}
                      </Text>
                    </View>
                  </View>
                  {[
                    { label: "Start Date", value: fmtDate(agr.startDate) },
                    { label: "End Date", value: fmtDate(agr.endDate) },
                    { label: "Monthly Rent", value: `₹${agr.monthlyRent.toLocaleString("en-IN")}` },
                    ...(agr.securityDeposit != null ? [{ label: "Security Deposit", value: `₹${agr.securityDeposit.toLocaleString("en-IN")}` }] : []),
                  ].map(row => (
                    <View key={row.label} style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
                      <Text style={[styles.value, { color: colors.foreground }]}>{row.value}</Text>
                    </View>
                  ))}
                  {agr.notes ? (
                    <View style={{ marginTop: 10, padding: 10, backgroundColor: `${colors.primary}08`, borderRadius: 8 }}>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontStyle: "italic" }}>{agr.notes}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                    <TouchableOpacity
                      style={[styles.recordBtn, { flex: 1, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }]}
                      onPress={() => openAgrForm(agr)}
                    >
                      <Feather name="edit-2" size={14} color={colors.foreground} />
                      <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.recordBtn, { flex: 1, backgroundColor: `${colors.destructive}10`, borderWidth: 1, borderColor: `${colors.destructive}30` }]}
                      onPress={() => handleDeleteAgreement(agr.id)}
                      disabled={deleteAgrMutation.isPending}
                    >
                      {deleteAgrMutation.isPending
                        ? <ActivityIndicator size="small" color={colors.destructive} />
                        : <Feather name="trash-2" size={14} color={colors.destructive} />}
                      <Text style={{ color: colors.destructive, fontWeight: "600", fontSize: 14 }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ─── DOCUMENTS TAB ────────────────────────────────────────────── */}
      {activeTab === "documents" && (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Upload section */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16 }]}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 14 }}>Upload Documents</Text>
            {uploading && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 14 }}>Uploading...</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {DOC_TYPES.map(dt => (
                <TouchableOpacity
                  key={dt.type}
                  style={[styles.uploadBtn, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` }]}
                  onPress={() => dt.isImage ? pickImageAndUpload(dt.type) : pickDocAndUpload(dt.type)}
                  disabled={uploading}
                >
                  <Feather name={dt.icon} size={18} color={colors.primary} />
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600", textAlign: "center" }}>{dt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Documents list */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Uploaded Documents</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{documents?.length ?? 0} files</Text>
          </View>

          {documentsLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />
          ) : !documents || documents.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 48, gap: 10 }}>
              <Feather name="folder" size={48} color={colors.mutedForeground} />
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>No Documents Yet</Text>
              <Text style={{ fontSize: 14, color: colors.mutedForeground, textAlign: "center" }}>
                Upload Aadhaar, PAN, photo, agreement PDF or other documents above.
              </Text>
            </View>
          ) : (
            documents.map(doc => {
              const isImg = isImageMime(doc.mimeType);
              const docTypeInfo = DOC_TYPES.find(d => d.type === doc.documentType);
              const fileUrl = `${baseUrl}${doc.fileUrl}?token=${auth.token}`;
              return (
                <View key={doc.id} style={[styles.docCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.docLeft}>
                    {isImg ? (
                      <ExpoImage
                        source={{ uri: fileUrl }}
                        style={styles.docThumbnail}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.docIconBox, { backgroundColor: `${colors.primary}12` }]}>
                        <Feather name={docTypeIcon(doc.documentType)} size={22} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.docInfo}>
                      <Text style={[styles.docName, { color: colors.foreground }]} numberOfLines={1}>{doc.originalName}</Text>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 3 }}>
                        <View style={[styles.badge, { backgroundColor: `${colors.primary}12` }]}>
                          <Text style={[styles.badgeText, { color: colors.primary }]}>
                            {docTypeInfo?.label || doc.documentType}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{fmtFileSize(doc.fileSize)}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                        {fmtDate(doc.createdAt)}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    <TouchableOpacity
                      style={[styles.iconButton, { backgroundColor: `${colors.primary}10`, borderRadius: 8 }]}
                      onPress={() => Linking.openURL(fileUrl).catch(() => Alert.alert("Error", "Cannot open file"))}
                    >
                      <Feather name="external-link" size={16} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconButton, { backgroundColor: `${colors.destructive}10`, borderRadius: 8 }]}
                      onPress={() => handleDeleteDocument(doc.id, doc.originalName)}
                      disabled={deleteDocMutation.isPending}
                    >
                      {deleteDocMutation.isPending
                        ? <ActivityIndicator size="small" color={colors.destructive} />
                        : <Feather name="trash-2" size={16} color={colors.destructive} />}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabText: { fontSize: 13, fontWeight: "600" },
  content: { padding: 16, paddingBottom: 60 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 4 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatar: { width: 80, height: 80, borderRadius: 40, justifyContent: "center", alignItems: "center", marginBottom: 12 },
  name: { fontSize: 24, fontWeight: "bold", marginBottom: 4 },
  propertyText: { fontSize: 16 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.1)", marginBottom: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14, fontWeight: "500" },
  value: { fontSize: 14, fontWeight: "700" },
  balanceCard: { padding: 16, borderRadius: 16, borderWidth: 1 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12 },
  ledgerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  sectionDivider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  segmentedControl: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8, padding: 4, marginBottom: 8 },
  segmentOption: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  uploadBtn: { width: "47%", paddingVertical: 14, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", gap: 6 },
  docCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  docLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  docThumbnail: { width: 48, height: 48, borderRadius: 8 },
  docIconBox: { width: 48, height: 48, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  docInfo: { flex: 1 },
  docName: { fontSize: 14, fontWeight: "600" },
});
