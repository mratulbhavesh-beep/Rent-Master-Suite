import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { fmtDate } from "@/utils/dateFormat";
import { useDateInput } from "@/utils/useDateInput";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useCreatePayment,
  useListTenants,
  useGetTenantBillingPeriods,
  getListTenantsQueryKey,
  getListPaymentsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetTenantQueryKey,
  getGetTenantBillingPeriodsQueryKey,
  type BillingPeriod,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const METHODS = [
  { key: "cash", label: "Cash", icon: "dollar-sign" },
  { key: "upi", label: "UPI", icon: "smartphone" },
  { key: "bank_transfer", label: "Bank Transfer", icon: "credit-card" },
  { key: "cheque", label: "Cheque", icon: "file-text" },
  { key: "online", label: "Online", icon: "globe" },
] as const;

type Method = (typeof METHODS)[number]["key"];
type AllocMode = "auto" | "specific";

const today = new Date().toISOString().split("T")[0];

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  overdue: "#ef4444",
  partial: "#3b82f6",
  paid: "#22c55e",
};

function periodLabel(p: BillingPeriod): string {
  if (!p.billingPeriodStart) return "—";
  const d = new Date(p.billingPeriodStart + "T00:00:00");
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (p.billingCycle === "monthly") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const end = p.billingPeriodEnd ? new Date(p.billingPeriodEnd + "T00:00:00") : null;
  if (!end) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

export default function PaymentAddScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [tenantId, setTenantId] = useState<number | null>(
    params.tenantId ? Number(params.tenantId) : null
  );
  const [allocationMode, setAllocationMode] = useState<AllocMode>("auto");
  const [selectedBillingPeriodId, setSelectedBillingPeriodId] = useState<number | null>(null);
  const [paymentType, setPaymentType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const { displayValue: paymentDateDisplay, onChangeDisplay: onPaymentDateChange, isoValue: paymentDate } = useDateInput(today);
  const [method, setMethod] = useState<Method>("cash");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: tenants } = useListTenants(
    {},
    { query: { queryKey: getListTenantsQueryKey({}) } }
  );

  const { data: billingPeriods, isLoading: periodsLoading } = useGetTenantBillingPeriods(
    tenantId!,
    { query: { queryKey: getGetTenantBillingPeriodsQueryKey(tenantId!), enabled: !!tenantId } }
  );

  const createMutation = useCreatePayment();

  useEffect(() => {
    if (tenantId && tenants && !amount) {
      const t = tenants.find((t) => t.id === tenantId);
      if (t) setAmount(t.rentAmount.toString());
    }
  }, [tenantId, tenants]);

  const selectedTenant = useMemo(
    () => tenants?.find((t) => t.id === tenantId) ?? null,
    [tenants, tenantId]
  );

  // Oldest-outstanding period (for info display in Auto mode)
  const oldestOutstanding = useMemo(() => {
    if (!billingPeriods) return null;
    return billingPeriods.find(p => p.status !== "paid" && p.remainingDue > 0) ?? null;
  }, [billingPeriods]);

  const monthFromDate = useMemo(() => {
    const d = new Date(paymentDate);
    return isNaN(d.getTime()) ? new Date() : d;
  }, [paymentDate]);

  const handleSelectTenant = (id: number, rentAmount: number) => {
    setTenantId(id);
    setAmount(rentAmount.toString());
    setSelectedBillingPeriodId(null);
    setErrors((e) => ({ ...e, tenantId: "" }));
  };

  const handleSelectBillingPeriod = (period: BillingPeriod) => {
    if (selectedBillingPeriodId === period.id) {
      setSelectedBillingPeriodId(null);
    } else {
      setSelectedBillingPeriodId(period.id);
      // Pre-fill amount to remaining due (capped at current amount if already set)
      if (period.remainingDue > 0) {
        setAmount(period.remainingDue.toString());
      }
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!tenantId) errs.tenantId = "Please select a tenant";
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      errs.amount = "Enter a valid amount";
    if (paymentDateDisplay.replace(/\D/g, "").length === 0) {
      errs.paymentDate = "Payment date is required";
    } else if (!paymentDate) {
      errs.paymentDate = "Invalid date. Please enter a valid date in DD/MM/YYYY format.";
    }
    if (allocationMode === "specific" && !selectedBillingPeriodId) {
      errs.period = "Select a billing period to allocate this payment to";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const date = new Date(paymentDate);
    const status = paymentType === "full" ? "paid" : "partial";

    createMutation.mutate(
      {
        data: {
          tenantId: tenantId!,
          propertyId: selectedTenant!.propertyId,
          amount: parseFloat(amount),
          paymentDate,
          month: date.getMonth() + 1,
          year: date.getFullYear(),
          method,
          status,
          notes: notes || undefined,
          allocationMode,
          targetGeneratedRentId: allocationMode === "specific" ? (selectedBillingPeriodId ?? undefined) : undefined,
        },
      },
      {
        onSuccess: (payment) => {
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          if (tenantId) {
            queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
            queryClient.invalidateQueries({ queryKey: getGetTenantBillingPeriodsQueryKey(tenantId) });
          }
          router.replace(`/payment-receipt?id=${payment.id}` as any);
        },
        onError: (err: any) => {
          const msg =
            err?.response?.data?.error ||
            err?.message ||
            "Failed to record payment";
          Alert.alert("Error", msg);
        },
      }
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Record Payment
        </Text>
        <View style={styles.iconButton} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Tenant Selection */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Select Tenant *
        </Text>
        {(!tenants || tenants.length === 0) ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="info" size={16} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No tenants found. Add a tenant first.
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.pickerCard,
              {
                borderColor: errors.tenantId ? colors.destructive : colors.border,
              },
            ]}
          >
            {tenants.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.tenantRow,
                  tenantId === t.id && { backgroundColor: `${colors.primary}12` },
                ]}
                onPress={() => handleSelectTenant(t.id, t.rentAmount)}
                activeOpacity={0.7}
              >
                <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: colors.primaryForeground, fontWeight: "bold", fontSize: 14 }}>
                    {t.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.tenantInfo}>
                  <Text style={{ color: tenantId === t.id ? colors.primary : colors.foreground, fontWeight: "600", fontSize: 15 }}>
                    {t.name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {t.propertyName} • Unit {t.unitNumber} •{" "}
                    <Text style={{ color: colors.accent, fontWeight: "600" }}>
                      ₹{t.rentAmount.toLocaleString("en-IN")}/mo
                    </Text>
                  </Text>
                </View>
                {tenantId === t.id && (
                  <Feather name="check-circle" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        {errors.tenantId ? (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.tenantId}</Text>
        ) : null}

        {/* ── Allocation Mode ─────────────────────────────────────────────── */}
        {tenantId && (
          <View style={{ marginTop: 20 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Allocation Mode
            </Text>
            <View style={[styles.segmented, { backgroundColor: colors.input }]}>
              {(["auto", "specific"] as AllocMode[]).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.segmentBtn,
                    allocationMode === mode && { backgroundColor: colors.primary, elevation: 2 },
                  ]}
                  onPress={() => {
                    setAllocationMode(mode);
                    setSelectedBillingPeriodId(null);
                    setErrors((e) => ({ ...e, period: "" }));
                  }}
                  activeOpacity={0.8}
                >
                  <Feather
                    name={mode === "auto" ? "zap" : "target"}
                    size={14}
                    color={allocationMode === mode ? colors.primaryForeground : colors.mutedForeground}
                  />
                  <Text style={{ color: allocationMode === mode ? colors.primaryForeground : colors.mutedForeground, fontWeight: "700", fontSize: 12, marginLeft: 5 }}>
                    {mode === "auto" ? "Auto (FIFO)" : "Specific Period"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Auto mode info banner */}
            {allocationMode === "auto" && (
              <View style={[styles.infoBox, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30`, marginTop: 8 }]}>
                <Feather name="info" size={14} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.infoText, { color: colors.primary }]}>
                    Payment will automatically cover the oldest unpaid periods first (FIFO). Any excess becomes advance credit.
                  </Text>
                  {oldestOutstanding && (
                    <Text style={{ fontSize: 11, color: colors.primary, marginTop: 4, fontWeight: "600" }}>
                      Next due: {periodLabel(oldestOutstanding)} — ₹{oldestOutstanding.remainingDue.toLocaleString("en-IN")} remaining
                    </Text>
                  )}
                  {!oldestOutstanding && billingPeriods && billingPeriods.length > 0 && (
                    <Text style={{ fontSize: 11, color: colors.success ?? colors.primary, marginTop: 4, fontWeight: "600" }}>
                      ✓ All periods are paid — this payment will be advance credit
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Specific mode period picker */}
            {allocationMode === "specific" && (
              <View style={{ marginTop: 8 }}>
                <View style={[styles.infoBox, { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}30`, marginBottom: 10 }]}>
                  <Feather name="target" size={14} color={colors.warning} />
                  <Text style={[styles.infoText, { color: colors.warning }]}>
                    Select which billing period to allocate this payment to. Excess beyond the period's due becomes advance credit.
                  </Text>
                </View>

                {periodsLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (!billingPeriods || billingPeriods.length === 0) ? (
                  <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather name="calendar" size={16} color={colors.mutedForeground} />
                    <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                      No billing periods generated yet for this tenant.
                    </Text>
                  </View>
                ) : (
                  billingPeriods.map((period) => {
                    const isSelected = selectedBillingPeriodId === period.id;
                    const statusColor = STATUS_COLORS[period.status] ?? colors.mutedForeground;
                    const isFullyPaid = period.remainingDue <= 0;
                    return (
                      <TouchableOpacity
                        key={period.id}
                        style={[
                          styles.periodEntry,
                          {
                            borderColor: isSelected ? colors.primary : colors.border,
                            backgroundColor: isSelected ? `${colors.primary}10` : colors.card,
                            opacity: isFullyPaid ? 0.6 : 1,
                          },
                        ]}
                        onPress={() => handleSelectBillingPeriod(period)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: isSelected ? colors.primary : colors.foreground }}>
                            {periodLabel(period)}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                            Expected: ₹{period.expectedAmount.toLocaleString("en-IN")}
                            {period.paidAmount > 0 ? ` · Paid: ₹${period.paidAmount.toLocaleString("en-IN")}` : ""}
                          </Text>
                          {!isFullyPaid && (
                            <Text style={{ fontSize: 12, fontWeight: "700", color: statusColor, marginTop: 3 }}>
                              ₹{period.remainingDue.toLocaleString("en-IN")} remaining
                            </Text>
                          )}
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                          <View style={[styles.periodStatusBadge, { backgroundColor: `${statusColor}20`, borderColor: `${statusColor}40` }]}>
                            <Text style={{ fontSize: 9, fontWeight: "800", color: statusColor }}>
                              {period.status.toUpperCase()}
                            </Text>
                          </View>
                          {isSelected && <Feather name="check-circle" size={18} color={colors.primary} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
                {errors.period ? (
                  <Text style={[styles.errorText, { color: colors.destructive, marginTop: 4 }]}>{errors.period}</Text>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* Payment Type */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
          Payment Type *
        </Text>
        <View style={[styles.segmented, { backgroundColor: colors.input }]}>
          {(["full", "partial"] as const).map((type) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.segmentBtn,
                paymentType === type && { backgroundColor: colors.primary, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 2 },
              ]}
              onPress={() => {
                setPaymentType(type);
                if (type === "full" && selectedTenant) {
                  setAmount(selectedTenant.rentAmount.toString());
                }
              }}
              activeOpacity={0.8}
            >
              <Feather
                name={type === "full" ? "check-circle" : "pie-chart"}
                size={14}
                color={paymentType === type ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text style={{ color: paymentType === type ? colors.primaryForeground : colors.mutedForeground, fontWeight: "700", fontSize: 13, marginLeft: 6 }}>
                {type === "full" ? "Full Payment" : "Partial Payment"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {paymentType === "partial" && (
          <View style={[styles.infoBox, { backgroundColor: `${colors.warning}15`, borderColor: `${colors.warning}40` }]}>
            <Feather name="alert-circle" size={14} color={colors.warning} />
            <Text style={[styles.infoText, { color: colors.warning }]}>
              Partial payment will be marked as "Partial" status
            </Text>
          </View>
        )}

        {/* Amount */}
        <View style={styles.row}>
          <View style={styles.flex1}>
            <Text style={[styles.label, { color: colors.foreground }]}>Amount (₹) *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: errors.amount ? colors.destructive : colors.border }]}
              value={amount}
              onChangeText={(v) => { setAmount(v); setErrors((e) => ({ ...e, amount: "" })); }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
            />
            {selectedTenant && paymentType === "full" && (
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Monthly rent: ₹{selectedTenant.rentAmount.toLocaleString("en-IN")}
              </Text>
            )}
            {errors.amount ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.amount}</Text> : null}
          </View>
          <View style={styles.flex1}>
            <Text style={[styles.label, { color: colors.foreground }]}>Payment Date *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: errors.paymentDate ? colors.destructive : colors.border }]}
              value={paymentDateDisplay}
              onChangeText={(v) => { onPaymentDateChange(v); setErrors((e) => ({ ...e, paymentDate: "" })); }}
              placeholder="DD/MM/YYYY"
              keyboardType="numeric"
              placeholderTextColor={colors.mutedForeground}
            />
            <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
              Recorded for:{" "}
              {monthFromDate.toLocaleString("default", { month: "long", year: "numeric" })}
            </Text>
            {errors.paymentDate ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.paymentDate}</Text> : null}
          </View>
        </View>

        {/* Payment Method */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
          Payment Method *
        </Text>
        <View style={styles.methodGrid}>
          {METHODS.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.methodBtn,
                {
                  backgroundColor: method === m.key ? colors.primary : colors.card,
                  borderColor: method === m.key ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setMethod(m.key)}
              activeOpacity={0.8}
            >
              <Feather name={m.icon as any} size={16} color={method === m.key ? colors.primaryForeground : colors.mutedForeground} />
              <Text style={{ fontSize: 12, marginTop: 4, fontWeight: "600", color: method === m.key ? colors.primaryForeground : colors.foreground }}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Notes */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 20 }]}>
          Notes (Optional)
        </Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          placeholder="Cheque no., transaction ID, etc."
          placeholderTextColor={colors.mutedForeground}
        />
      </KeyboardAwareScrollViewCompat>

      {/* Fixed footer button — OUTSIDE scroll */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary }, createMutation.isPending && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={createMutation.isPending}
          activeOpacity={0.8}
        >
          {createMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Saving...</Text>
            </View>
          ) : (
            <>
              <Feather name="save" size={18} color={colors.primaryForeground} />
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Record Payment</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  pickerCard: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  tenantRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  tenantInfo: { flex: 1 },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderRadius: 12,
  },
  emptyText: { fontSize: 13, flex: 1 },
  segmented: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
  },
  infoText: { fontSize: 12, fontWeight: "500", flex: 1 },
  row: { flexDirection: "row", gap: 12, marginTop: 20 },
  flex1: { flex: 1 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  textArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  hintText: { fontSize: 11, marginTop: 4 },
  errorText: { fontSize: 12, marginTop: 4 },
  methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodBtn: {
    width: "18%",
    minWidth: 60,
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
  },
  footer: { padding: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: {
    height: 52,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  saveBtnText: { fontSize: 16, fontWeight: "bold" },
  periodEntry: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  periodStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
});
