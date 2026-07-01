import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useGetProperty,
  getGetPropertyQueryKey,
  useUpdateProperty,
  useDeleteProperty,
  PropertyUpdateStatus,
  PropertyUpdateType,
  useListTenants,
  getListTenantsQueryKey,
  useListPayments,
  getListPaymentsQueryKey,
  useDeleteTenant,
  useCreatePayment,
  PaymentInputMethod,
  getGetDashboardSummaryQueryKey,
  Tenant,
  Payment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;


// ── QuickPay Modal ────────────────────────────────────────────────────────
// Defined OUTSIDE screen so its type reference is stable across renders

type QuickPayProps = {
  visible: boolean;
  tenant: Tenant | null;
  propertyId: number;
  onClose: () => void;
  onSuccess: () => void;
  colors: ReturnType<typeof useColors>;
  insetBottom: number;
};

function QuickPayModal({
  visible,
  tenant,
  propertyId,
  onClose,
  onSuccess,
  colors,
  insetBottom,
}: QuickPayProps) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentInputMethod>(PaymentInputMethod.cash);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const createPayment = useCreatePayment();

  const methodLabels: Record<PaymentInputMethod, string> = {
    cash: "Cash",
    upi: "UPI",
    bank_transfer: "Bank",
    cheque: "Cheque",
    online: "Online",
  };

  const handlePay = () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      Alert.alert("Error", "Enter a valid amount");
      return;
    }
    if (!tenant) return;
    const d = new Date(date);
    createPayment.mutate(
      {
        data: {
          tenantId: tenant.id,
          propertyId,
          amount: amt,
          paymentDate: date,
          month: d.getMonth() + 1,
          year: d.getFullYear(),
          method,
          status: "paid" as any,
        },
      },
      {
        onSuccess: () => {
          setAmount("");
          setMethod(PaymentInputMethod.cash);
          setDate(new Date().toISOString().split("T")[0]);
          onSuccess();
          onClose();
        },
        onError: () => Alert.alert("Error", "Failed to record payment"),
      }
    );
  };

  if (!tenant) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ms.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={[ms.sheet, { backgroundColor: colors.card, paddingBottom: insetBottom + 16 }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={[ms.handle, { backgroundColor: colors.border }]} />
          <Text style={[ms.title, { color: colors.foreground }]}>Record Payment</Text>
          <Text style={[ms.sub, { color: colors.mutedForeground }]}>
            {tenant.name} · Unit {tenant.unitNumber}
          </Text>

          <Text style={[ms.lbl, { color: colors.foreground }]}>Amount (₹)</Text>
          <TextInput
            style={[ms.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder={String(Math.round(parseFloat(String(tenant.rentAmount))))}
            placeholderTextColor={colors.mutedForeground}
            autoFocus
          />

          <Text style={[ms.lbl, { color: colors.foreground }]}>Payment Method</Text>
          <View style={ms.methodRow}>
            {(Object.values(PaymentInputMethod) as PaymentInputMethod[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[
                  ms.methodBtn,
                  { borderColor: colors.border },
                  method === m && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setMethod(m)}
              >
                <Text style={{ fontSize: 11, color: method === m ? colors.primaryForeground : colors.mutedForeground }}>
                  {methodLabels[m]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[ms.lbl, { color: colors.foreground }]}>Date</Text>
          <TextInput
            style={[ms.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
          />

          <View style={ms.btnRow}>
            <TouchableOpacity style={[ms.cancelBtn, { borderColor: colors.border }]} onPress={onClose}>
              <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ms.confirmBtn, { backgroundColor: colors.primary }, createPayment.isPending && { opacity: 0.7 }]}
              onPress={handlePay}
              disabled={createPayment.isPending}
            >
              {createPayment.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={{ color: colors.primaryForeground, fontWeight: "bold" }}>Record</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Edit Property Modal ────────────────────────────────────────────────────
// Defined OUTSIDE screen for stable component reference

type EditPropertyProps = {
  visible: boolean;
  propertyId: number;
  initial: {
    name: string;
    address: string;
    type: PropertyUpdateType;
    totalUnits: string;
    rentAmount: string;
    status: PropertyUpdateStatus;
    description: string;
  };
  onClose: () => void;
  onSuccess: () => void;
  colors: ReturnType<typeof useColors>;
};

function EditPropertyModal({ visible, propertyId, initial, onClose, onSuccess, colors }: EditPropertyProps) {
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [type, setType] = useState<PropertyUpdateType>(initial.type);
  const [totalUnits, setTotalUnits] = useState(initial.totalUnits);
  const [rentAmount, setRentAmount] = useState(initial.rentAmount);
  const [status, setStatus] = useState<PropertyUpdateStatus>(initial.status);
  const [description, setDescription] = useState(initial.description);
  const updateMutation = useUpdateProperty();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setAddress(initial.address);
      setType(initial.type);
      setTotalUnits(initial.totalUnits);
      setRentAmount(initial.rentAmount);
      setStatus(initial.status);
      setDescription(initial.description);
    }
  }, [visible]);

  const handleSave = () => {
    if (!name || !address || !totalUnits || !rentAmount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    updateMutation.mutate(
      {
        id: propertyId,
        data: {
          name,
          address,
          type,
          totalUnits: parseInt(totalUnits, 10),
          rentAmount: parseFloat(rentAmount),
          status,
          description,
        },
      },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetPropertyQueryKey(propertyId), data);
          queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
          onSuccess();
          onClose();
        },
        onError: () => Alert.alert("Error", "Failed to update property"),
      }
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[es.container, { backgroundColor: colors.background }]}>
        <View style={[es.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity style={es.iconBtn} onPress={onClose}>
            <Feather name="x" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[es.title, { color: colors.foreground }]}>Edit Property</Text>
          <TouchableOpacity style={es.iconBtn} onPress={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Feather name="check" size={24} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={es.content}>
          <View style={[es.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[es.lbl, { color: colors.foreground }]}>Property Name *</Text>
            <TextInput
              style={[es.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Sunset Apartments"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[es.lbl, { color: colors.foreground }]}>Address *</Text>
            <TextInput
              style={[es.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Full Address"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[es.lbl, { color: colors.foreground }]}>Property Type</Text>
            <View style={es.segmented}>
              {(["apartment", "house", "commercial", "land"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[es.seg, type === t && { backgroundColor: colors.primary }]}
                  onPress={() => setType(t)}
                >
                  <Text style={{ fontSize: 11, textTransform: "capitalize", color: type === t ? colors.primaryForeground : colors.mutedForeground }}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[es.lbl, { color: colors.foreground }]}>Total Units *</Text>
                <TextInput
                  style={[es.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={totalUnits}
                  onChangeText={setTotalUnits}
                  keyboardType="numeric"
                  placeholder="e.g. 10"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[es.lbl, { color: colors.foreground }]}>Base Rent (₹) *</Text>
                <TextInput
                  style={[es.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={rentAmount}
                  onChangeText={setRentAmount}
                  keyboardType="numeric"
                  placeholder="e.g. 15000"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>

            <Text style={[es.lbl, { color: colors.foreground }]}>Status</Text>
            <View style={[es.segmented, { marginBottom: 12 }]}>
              {(["available", "occupied", "maintenance"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[es.seg, status === s && { backgroundColor: colors.primary }]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={{ fontSize: 11, textTransform: "capitalize", color: status === s ? colors.primaryForeground : colors.mutedForeground }}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[es.lbl, { color: colors.foreground }]}>Description (Optional)</Text>
            <TextInput
              style={[es.input, es.textArea, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              placeholder="Additional details..."
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────

type Tab = "overview" | "info";

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams();
  const propertyId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [payTenant, setPayTenant] = useState<Tenant | null>(null);

  const { data: property, isLoading: propLoading } = useGetProperty(propertyId, {
    query: { queryKey: getGetPropertyQueryKey(propertyId), enabled: !!propertyId },
  });

  const { data: tenants = [], isLoading: tenantsLoading } = useListTenants(
    { propertyId },
    { query: { queryKey: getListTenantsQueryKey({ propertyId }) } }
  );

  const { data: payments = [] } = useListPayments(
    { propertyId },
    { query: { queryKey: getListPaymentsQueryKey({ propertyId }) } }
  );

  const deletePropMutation = useDeleteProperty();
  const deleteTenantMutation = useDeleteTenant();

  // ── Computed stats ────────────────────────────────────────────────────
  const totalUnits = property ? parseFloat(String(property.totalUnits)) : 0;
  const occupiedCount = tenants.length;
  const vacantCount = Math.max(0, totalUnits - occupiedCount);
  const totalMonthlyRent = tenants.reduce((s, t) => s + parseFloat(String(t.rentAmount)), 0);
  const totalPendingDue = tenants.reduce((s, t) => s + ((t as any).balanceDue ?? 0), 0);

  const _now = new Date();
  const _cm = _now.getMonth() + 1;
  const _cy = _now.getFullYear();
  const collectedThisMonth = payments
    .filter(p => p.month === _cm && p.year === _cy && (p.status === "paid" || p.status === "partial"))
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);
  const pendingCollection = Math.max(0, totalMonthlyRent - collectedThisMonth);
  const occupancyPct = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0;

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleWhatsAppRemind = (tenant: Tenant) => {
    const rawPhone = (tenant as any).phone as string | undefined;
    if (!rawPhone) {
      Alert.alert("No Phone Number", "This tenant has no phone number on file.");
      return;
    }
    let digits = rawPhone.replace(/\D/g, "");
    if (digits.length === 10) digits = "91" + digits;
    else if (digits.startsWith("0")) digits = "91" + digits.slice(1);
    const bal = (tenant as any).balanceDue ?? 0;
    const message = [
      `Hello ${tenant.name},`,
      ``,
      `This is a friendly reminder for your rent payment.`,
      ``,
      `🏠 Property: ${property?.name ?? ""}`,
      `📦 Unit: ${tenant.unitNumber}`,
      `💰 Monthly Rent: ₹${Math.round(parseFloat(String(tenant.rentAmount))).toLocaleString("en-IN")}`,
      `⚠️ Balance Due: ₹${Math.round(bal).toLocaleString("en-IN")}`,
      ``,
      `Please make the payment at your earliest convenience.`,
      ``,
      `Thank you,`,
      `Gemini Rent Manager`,
    ].join("\n");
    const url = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert("WhatsApp Not Available", "Please check if WhatsApp is installed.")
    );
  };

  const doDeleteProperty = () => {
    deletePropMutation.mutate(
      { id: propertyId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          router.back();
        },
        onError: () => Alert.alert("Error", "Failed to delete property"),
      }
    );
  };

  const handleDeleteProperty = () => {
    const msg = `Delete "${property?.name}"?\n\nAll tenants and payment records will also be removed. This cannot be undone.`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) doDeleteProperty();
    } else {
      Alert.alert("Delete Property", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDeleteProperty },
      ]);
    }
  };

  const doDeleteTenant = (tenantId: number) => {
    deleteTenantMutation.mutate(
      { id: tenantId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey({ propertyId }) });
          queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        },
        onError: () => Alert.alert("Error", "Failed to remove tenant"),
      }
    );
  };

  const handleDeleteTenant = (tenant: Tenant) => {
    const msg = `Remove "${tenant.name}" from this property?\n\nAll payment and maintenance records will also be deleted.`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) doDeleteTenant(tenant.id);
    } else {
      Alert.alert("Remove Tenant", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => doDeleteTenant(tenant.id) },
      ]);
    }
  };

  const refreshPayments = () => {
    queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey({ propertyId }) });
    queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  // ── Loading / not found ───────────────────────────────────────────────
  if (propLoading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={48} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Property not found</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Per-tenant status helpers ─────────────────────────────────────────
  const tenantStatusLabel = (t: Tenant, bal: number) =>
    t.status === "inactive" ? "Inactive" : bal <= 0 ? "Clear" : "Due";
  const tenantStatusBg = (t: Tenant, bal: number) =>
    t.status === "inactive" ? `${colors.mutedForeground}22` : bal <= 0 ? `${colors.success}22` : `${colors.destructive}22`;
  const tenantStatusFg = (t: Tenant, bal: number) =>
    t.status === "inactive" ? colors.mutedForeground : bal <= 0 ? colors.success : colors.destructive;

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          {property.name}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setEditOpen(true)}>
            <Feather name="edit-2" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={handleDeleteProperty} disabled={deletePropMutation.isPending}>
            {deletePropMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : (
              <Feather name="trash-2" size={20} color={colors.destructive} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={[s.tabBar, { borderBottomColor: colors.border }]}>
        {(["overview", "info"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[s.tabText, { color: activeTab === tab ? colors.primary : colors.mutedForeground }]}>
              {tab === "overview" ? "Overview" : "Property Info"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" ? (
        <ScrollView contentContainerStyle={s.content}>
          {/* Summary Card */}
          <View style={[s.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.cardTitle, { color: colors.foreground }]}>{property.name}</Text>
            <Text style={[s.cardSub, { color: colors.mutedForeground }]}>
              📍 {property.address}
            </Text>

            <View style={s.statsGrid}>
              <View style={[s.statBox, { backgroundColor: `${colors.primary}14` }]}>
                <Text style={[s.statNum, { color: colors.primary }]}>{totalUnits}</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Total Units</Text>
              </View>
              <View style={[s.statBox, { backgroundColor: `${colors.success}14` }]}>
                <Text style={[s.statNum, { color: colors.success }]}>{occupiedCount}</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Occupied</Text>
              </View>
              <View style={[s.statBox, { backgroundColor: `${colors.mutedForeground}14` }]}>
                <Text style={[s.statNum, { color: colors.mutedForeground }]}>{vacantCount}</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Vacant</Text>
              </View>
            </View>

            <View style={[s.divider, { backgroundColor: colors.border }]} />

            <View style={s.moneyRow}>
              <View style={s.moneyStat}>
                <Text style={[s.moneyNum, { color: colors.foreground }]}>{fmt(totalMonthlyRent)}</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Expected Income</Text>
              </View>
              <View style={[s.moneyStat, { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
                <Text style={[s.moneyNum, { color: totalPendingDue > 0 ? colors.destructive : colors.success }]}>
                  {fmt(totalPendingDue)}
                </Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Total Pending Due</Text>
              </View>
            </View>

            <View style={[s.divider, { backgroundColor: colors.border }]} />

            <View style={s.statsGrid}>
              <View style={[s.statBox, { backgroundColor: `${colors.success}14` }]}>
                <Text style={[s.statNum, { color: colors.success, fontSize: 15 }]}>{fmt(collectedThisMonth)}</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Collected This Month</Text>
              </View>
              <View style={[s.statBox, { backgroundColor: `${colors.destructive}14` }]}>
                <Text style={[s.statNum, { color: colors.destructive, fontSize: 15 }]}>{fmt(pendingCollection)}</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Pending Collection</Text>
              </View>
              <View style={[s.statBox, { backgroundColor: `${colors.primary}14` }]}>
                <Text style={[s.statNum, { color: colors.primary }]}>{occupancyPct}%</Text>
                <Text style={[s.statLbl, { color: colors.mutedForeground }]}>Occupancy</Text>
              </View>
            </View>
          </View>

          {/* Section: Units & Tenants */}
          <View style={s.sectionRow}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Units & Tenants</Text>
            <TouchableOpacity
              style={[s.addBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push(`/tenant-add?propertyId=${propertyId}` as any)}
            >
              <Feather name="user-plus" size={14} color={colors.primaryForeground} />
              <Text style={[s.addBtnText, { color: colors.primaryForeground }]}>Add Tenant</Text>
            </TouchableOpacity>
          </View>

          {tenantsLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : (
            <>
              {/* Occupied tenant rows */}
              {tenants.map((tenant) => {
                const bal = (tenant as any).currentMonthDue ?? 0;
                return (
                  <View
                    key={tenant.id}
                    style={[s.tenantCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    {/* Row 1: unit + status + view */}
                    <View style={s.tcRow}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[s.unitNum, { color: colors.primary }]}>Unit {tenant.unitNumber}</Text>
                        <View style={[s.badge, { backgroundColor: tenantStatusBg(tenant, bal) }]}>
                          <Text style={[s.badgeText, { color: tenantStatusFg(tenant, bal) }]}>
                            {tenantStatusLabel(tenant, bal)}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[s.viewBtn, { borderColor: colors.border }]}
                        onPress={() => router.push(`/tenant-detail?id=${tenant.id}` as any)}
                      >
                        <Text style={[s.viewBtnText, { color: colors.primary }]}>View</Text>
                        <Feather name="chevron-right" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    </View>

                    {/* Row 2: name */}
                    <Text style={[s.tenantName, { color: colors.foreground }]}>{tenant.name}</Text>

                    {/* Row 3: rent + due */}
                    <View style={s.amountRow}>
                      <View style={s.amountBox}>
                        <Text style={[s.amtLbl, { color: colors.mutedForeground }]}>Monthly Rent</Text>
                        <Text style={[s.amtVal, { color: colors.foreground }]}>
                          {fmt(parseFloat(String(tenant.rentAmount)))}
                        </Text>
                      </View>
                      <View style={s.amountBox}>
                        <Text style={[s.amtLbl, { color: colors.mutedForeground }]}>Current Due</Text>
                        <Text style={[s.amtVal, { color: bal > 0 ? colors.destructive : colors.success }]}>
                          {bal > 0 ? fmt(bal) : "Nil"}
                        </Text>
                      </View>
                    </View>

                    {/* Agreement expiry row */}
                    {(() => {
                      const ta = tenant as any;
                      if (!ta.activeAgreementEndDate) return null;
                      const today = new Date().toISOString().split("T")[0];
                      const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                      const end = ta.activeAgreementEndDate as string;
                      const isExpired = end < today;
                      const isExpiringSoon = !isExpired && end <= in30d;
                      const agrColor = isExpired ? colors.destructive : isExpiringSoon ? colors.warning : colors.success;
                      const daysLeft = Math.ceil((new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      return (
                        <View style={[s.agrInfoRow, { borderTopColor: colors.border, backgroundColor: `${agrColor}07` }]}>
                          <Feather name="file-text" size={11} color={agrColor} />
                          <Text style={[s.agrInfoText, { color: agrColor }]}>
                            {isExpired ? "Agreement Expired" : isExpiringSoon ? `Agreement expiring in ${daysLeft}d` : `Agreement until ${new Date(end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                          </Text>
                        </View>
                      );
                    })()}

                    {/* Row 4: actions */}
                    <View style={[s.actionRow, { borderTopColor: colors.border }]}>
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: `${colors.primary}14` }]}
                        onPress={() => setPayTenant(tenant)}
                      >
                        <Feather name="credit-card" size={14} color={colors.primary} />
                        <Text style={[s.actionText, { color: colors.primary }]}>Payment</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: "#25D36618" }]}
                        onPress={() => handleWhatsAppRemind(tenant)}
                      >
                        <Feather name="message-circle" size={14} color="#25D366" />
                        <Text style={[s.actionText, { color: "#25D366" }]}>Remind</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: `${colors.destructive}12` }]}
                        onPress={() => handleDeleteTenant(tenant)}
                        disabled={deleteTenantMutation.isPending}
                      >
                        <Feather name="user-x" size={14} color={colors.destructive} />
                        <Text style={[s.actionText, { color: colors.destructive }]}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {/* Vacant unit slots */}
              {Array.from({ length: vacantCount }).map((_, i) => (
                <View
                  key={`vacant-${i}`}
                  style={[s.vacantCard, { borderColor: colors.border, backgroundColor: `${colors.mutedForeground}08` }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Feather name="home" size={16} color={colors.mutedForeground} />
                    <Text style={[s.vacantText, { color: colors.mutedForeground }]}>Vacant Unit</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.addSmallBtn, { borderColor: colors.primary }]}
                    onPress={() => router.push(`/tenant-add?propertyId=${propertyId}` as any)}
                  >
                    <Feather name="plus" size={13} color={colors.primary} />
                    <Text style={[s.addSmallText, { color: colors.primary }]}>Add Tenant</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {tenants.length === 0 && vacantCount === 0 && (
                <View style={s.emptyState}>
                  <Feather name="users" size={40} color={colors.mutedForeground} />
                  <Text style={[s.emptyText, { color: colors.mutedForeground }]}>No tenants added yet</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      ) : (
        /* ── INFO TAB ── */
        <ScrollView contentContainerStyle={s.content}>
          <View style={[s.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {([
              ["Name", property.name],
              ["Address", property.address],
              ["Type", property.type],
              ["Total Units", String(property.totalUnits)],
              ["Base Rent/mo", fmt(parseFloat(String(property.rentAmount)))],
              ["Status", property.status],
              ...(property.description ? [["Description", property.description]] : []),
            ] as [string, string][]).map(([label, value]) => (
              <View key={label} style={[s.infoRow, { borderBottomColor: colors.border }]}>
                <Text style={[s.infoLbl, { color: colors.mutedForeground }]}>{label}</Text>
                <Text
                  style={[
                    s.infoVal,
                    { color: colors.foreground },
                    (label === "Type" || label === "Status") && { textTransform: "capitalize" },
                  ]}
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[s.editInfoBtn, { backgroundColor: colors.primary }]}
            onPress={() => setEditOpen(true)}
          >
            <Feather name="edit-2" size={16} color={colors.primaryForeground} />
            <Text style={[s.editInfoBtnText, { color: colors.primaryForeground }]}>Edit Property</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* QuickPay Modal */}
      <QuickPayModal
        visible={payTenant !== null}
        tenant={payTenant}
        propertyId={propertyId}
        onClose={() => setPayTenant(null)}
        onSuccess={refreshPayments}
        colors={colors}
        insetBottom={insets.bottom}
      />

      {/* Edit Property Modal */}
      {property && (
        <EditPropertyModal
          visible={editOpen}
          propertyId={propertyId}
          initial={{
            name: property.name,
            address: property.address,
            type: property.type as PropertyUpdateType,
            totalUnits: String(property.totalUnits),
            rentAmount: String(parseFloat(String(property.rentAmount))),
            status: property.status as PropertyUpdateStatus,
            description: property.description || "",
          }}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {}}
          colors={colors}
        />
      )}
    </View>
  );
}

// ── StyleSheets ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 42, height: 42, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "bold", flex: 1, textAlign: "center" },

  // Tabs
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 14, fontWeight: "600" },

  content: { padding: 16, paddingBottom: 48 },

  // Stats card
  statsCard: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  cardTitle: { fontSize: 17, fontWeight: "bold", marginBottom: 2 },
  cardSub: { fontSize: 13, marginBottom: 14 },
  statsGrid: { flexDirection: "row", gap: 8, marginBottom: 14 },
  statBox: { flex: 1, padding: 12, borderRadius: 12, alignItems: "center" },
  statNum: { fontSize: 22, fontWeight: "bold" },
  statLbl: { fontSize: 11, marginTop: 2, textAlign: "center" },
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 14 },
  moneyRow: { flexDirection: "row" },
  moneyStat: { flex: 1, alignItems: "center", paddingVertical: 2 },
  moneyNum: { fontSize: 17, fontWeight: "bold" },

  // Section header
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  addBtnText: { fontSize: 13, fontWeight: "600" },

  // Tenant card
  tenantCard: { borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  tcRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  unitNum: { fontSize: 12, fontWeight: "700" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  viewBtn: { flexDirection: "row", alignItems: "center", gap: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  viewBtnText: { fontSize: 12, fontWeight: "600" },
  tenantName: { fontSize: 16, fontWeight: "600", paddingHorizontal: 14, paddingBottom: 10 },
  amountRow: { flexDirection: "row", paddingHorizontal: 14, paddingBottom: 10, gap: 28 },
  amountBox: {},
  amtLbl: { fontSize: 11, marginBottom: 2 },
  amtVal: { fontSize: 15, fontWeight: "700" },
  agrInfoRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },
  agrInfoText: { fontSize: 11, fontWeight: "600" },
  actionRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10 },
  actionText: { fontSize: 12, fontWeight: "600" },

  // Vacant card
  vacantCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", marginBottom: 12 },
  vacantText: { fontSize: 14, fontWeight: "500" },
  addSmallBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addSmallText: { fontSize: 12, fontWeight: "600" },

  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 40 },
  emptyText: { marginTop: 12, fontSize: 14 },

  // Info tab
  infoCard: { borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLbl: { fontSize: 14, fontWeight: "500" },
  infoVal: { fontSize: 14, fontWeight: "600", maxWidth: "55%", textAlign: "right" },
  editInfoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 12 },
  editInfoBtnText: { fontSize: 15, fontWeight: "bold" },
});

// QuickPay modal styles
const ms = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  sub: { fontSize: 13, marginBottom: 12 },
  lbl: { fontSize: 14, fontWeight: "600", marginBottom: 6, marginTop: 10 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16 },
  methodRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  methodBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 10, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  confirmBtn: { flex: 2, height: 48, borderRadius: 10, justifyContent: "center", alignItems: "center" },
});

// Edit property modal styles
const es = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "bold" },
  content: { padding: 16, paddingBottom: 48 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1 },
  lbl: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  textArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  segmented: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8, padding: 4 },
  seg: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
});
