import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { confirmAction } from "@/utils/confirm";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useGetPayment,
  getGetPaymentQueryKey,
  useUpdatePayment,
  useDeletePayment,
  getListPaymentsQueryKey,
  getGetDashboardSummaryQueryKey,
  getListTenantsQueryKey,
  getGetTenantQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const METHODS = [
  { key: "cash", label: "Cash", icon: "dollar-sign" },
  { key: "upi", label: "UPI", icon: "smartphone" },
  { key: "bank_transfer", label: "Bank", icon: "credit-card" },
  { key: "cheque", label: "Cheque", icon: "file-text" },
  { key: "online", label: "Online", icon: "globe" },
] as const;

type Method = (typeof METHODS)[number]["key"];
type Status = "paid" | "partial" | "overdue";

const STATUS_OPTIONS: { key: Status; label: string; icon: string }[] = [
  { key: "paid", label: "Paid", icon: "check-circle" },
  { key: "partial", label: "Partial", icon: "pie-chart" },
  { key: "overdue", label: "Overdue", icon: "alert-circle" },
];

function invalidatePaymentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  paymentId: number,
  tenantId?: number
) {
  queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetPaymentQueryKey(paymentId) });
  queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
  if (tenantId) {
    queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
  }
}

export default function PaymentEditScreen() {
  const { id } = useLocalSearchParams();
  const paymentId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [status, setStatus] = useState<Status>("paid");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: payment, isLoading } = useGetPayment(paymentId, {
    query: { queryKey: getGetPaymentQueryKey(paymentId), enabled: !!paymentId },
  });

  const updateMutation = useUpdatePayment();
  const deleteMutation = useDeletePayment();

  useEffect(() => {
    if (payment) {
      setAmount(String(Number(payment.amount)));
      setPaymentDate(payment.paymentDate.split("T")[0]);
      setMethod(payment.method as Method);
      setStatus(payment.status as Status);
      setNotes(payment.notes || "");
    }
  }, [payment]);

  const monthLabel = (() => {
    const d = new Date(paymentDate);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("default", { month: "long", year: "numeric" });
  })();

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0)
      errs.amount = "Enter a valid amount greater than zero";
    if (!paymentDate) errs.paymentDate = "Payment date is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate() || !payment) return;
    const d = new Date(paymentDate);
    updateMutation.mutate(
      {
        id: paymentId,
        data: {
          tenantId: payment.tenantId!,
          propertyId: payment.propertyId!,
          amount: parseFloat(amount),
          paymentDate,
          month: d.getMonth() + 1,
          year: d.getFullYear(),
          method,
          status,
          notes: notes || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidatePaymentQueries(queryClient, paymentId, payment.tenantId ?? undefined);
          router.back();
        },
        onError: (err: any) => {
          Alert.alert("Error", err?.response?.data?.error || "Failed to update payment");
        },
      }
    );
  };

  const handleDelete = () => {
    if (!payment) return;
    const msg = `Delete this payment of ₹${Number(payment.amount).toLocaleString("en-IN")}?\n\nThis will update the tenant's balance and cannot be undone.`;
    const doDelete = () => {
      deleteMutation.mutate(
        { id: paymentId },
        {
          onSuccess: () => {
            invalidatePaymentQueries(queryClient, paymentId, payment.tenantId ?? undefined);
            router.back();
          },
          onError: (err: any) => {
            Alert.alert("Error", err?.response?.data?.error || "Failed to delete payment");
          },
        }
      );
    };
    confirmAction("Delete Payment", msg, doDelete);
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading payment…</Text>
      </View>
    );
  }

  if (!payment) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Feather name="alert-circle" size={48} color={colors.mutedForeground} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Payment not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isBusy = updateMutation.isPending || deleteMutation.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()} disabled={isBusy}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Edit Payment</Text>
        <TouchableOpacity
          style={[styles.deleteIconBtn]}
          onPress={handleDelete}
          disabled={isBusy}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Feather name="trash-2" size={20} color={colors.destructive} />
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Tenant / property context — read-only */}
        <View style={[styles.contextCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontWeight: "bold", fontSize: 16 }}>
              {(payment.tenantName || "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.contextInfo}>
            <Text style={[styles.contextName, { color: colors.foreground }]}>
              {payment.tenantName || "Unknown Tenant"}
            </Text>
            <Text style={[styles.contextSub, { color: colors.mutedForeground }]}>
              {payment.propertyName || "Unknown Property"} • Receipt {payment.receiptNumber || `#${payment.id}`}
            </Text>
          </View>
          <View style={[styles.readOnlyBadge, { backgroundColor: `${colors.primary}15` }]}>
            <Text style={[styles.readOnlyText, { color: colors.primary }]}>Read-only</Text>
          </View>
        </View>

        {/* Amount */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 20 }]}>
          Amount (₹) *
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.input,
              color: colors.text,
              borderColor: errors.amount ? colors.destructive : colors.border,
            },
          ]}
          value={amount}
          onChangeText={(v) => { setAmount(v); setErrors((e) => ({ ...e, amount: "" })); }}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.mutedForeground}
          editable={!isBusy}
        />
        {errors.amount ? (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.amount}</Text>
        ) : null}

        {/* Payment Date */}
        <View style={[styles.row, { marginTop: 16 }]}>
          <View style={styles.flex1}>
            <Text style={[styles.label, { color: colors.foreground }]}>Payment Date *</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                  borderColor: errors.paymentDate ? colors.destructive : colors.border,
                },
              ]}
              value={paymentDate}
              onChangeText={(v) => { setPaymentDate(v); setErrors((e) => ({ ...e, paymentDate: "" })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              editable={!isBusy}
            />
            {monthLabel ? (
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>For: {monthLabel}</Text>
            ) : null}
            {errors.paymentDate ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.paymentDate}</Text>
            ) : null}
          </View>
        </View>

        {/* Status */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
          Payment Status *
        </Text>
        <View style={styles.statusRow}>
          {STATUS_OPTIONS.map((s) => {
            const isSelected = status === s.key;
            const color =
              s.key === "paid" ? colors.success : s.key === "partial" ? colors.warning : colors.destructive;
            return (
              <TouchableOpacity
                key={s.key}
                style={[
                  styles.statusBtn,
                  {
                    backgroundColor: isSelected ? `${color}18` : colors.card,
                    borderColor: isSelected ? color : colors.border,
                  },
                ]}
                onPress={() => setStatus(s.key)}
                disabled={isBusy}
                activeOpacity={0.8}
              >
                <Feather name={s.icon as any} size={15} color={isSelected ? color : colors.mutedForeground} />
                <Text
                  style={{
                    color: isSelected ? color : colors.mutedForeground,
                    fontSize: 12,
                    fontWeight: "700",
                    marginTop: 4,
                  }}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
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
              disabled={isBusy}
              activeOpacity={0.8}
            >
              <Feather
                name={m.icon as any}
                size={16}
                color={method === m.key ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  fontWeight: "600",
                  color: method === m.key ? colors.primaryForeground : colors.foreground,
                }}
              >
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
          style={[
            styles.input,
            styles.textArea,
            { backgroundColor: colors.input, color: colors.text, borderColor: colors.border },
          ]}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          placeholder="Cheque no., transaction ID, remarks…"
          placeholderTextColor={colors.mutedForeground}
          editable={!isBusy}
        />

        {/* Negative-due info */}
        {status === "paid" && (
          <View style={[styles.infoBox, { backgroundColor: `${colors.success}12`, borderColor: `${colors.success}30` }]}>
            <Feather name="info" size={13} color={colors.success} />
            <Text style={[styles.infoText, { color: colors.success }]}>
              Tenant balance recalculates automatically — due amount will never go below ₹0.
            </Text>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>

      {/* Fixed save button */}
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary }, isBusy && { opacity: 0.65 }]}
          onPress={handleSave}
          disabled={isBusy}
          activeOpacity={0.8}
        >
          {updateMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Saving…</Text>
            </View>
          ) : (
            <>
              <Feather name="save" size={18} color={colors.primaryForeground} />
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, marginTop: 8 },
  backLink: { padding: 8 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  deleteIconBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 8 },
  contextCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
  },
  contextInfo: { flex: 1 },
  contextName: { fontSize: 15, fontWeight: "700" },
  contextSub: { fontSize: 12, marginTop: 2 },
  readOnlyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  readOnlyText: { fontSize: 11, fontWeight: "700" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  textArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  hintText: { fontSize: 11, marginTop: 4 },
  errorText: { fontSize: 12, marginTop: 4 },
  statusRow: { flexDirection: "row", gap: 10 },
  statusBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodBtn: {
    flex: 1,
    minWidth: 56,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
  },
  infoText: { fontSize: 12, flex: 1, lineHeight: 17 },
  footer: {
    padding: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
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
});
