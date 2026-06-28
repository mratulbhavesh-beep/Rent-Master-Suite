import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGetTenant, getGetTenantQueryKey, useUpdateTenant, useDeleteTenant, useDeletePayment, useListPayments, getListPaymentsQueryKey, getListTenantsQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TenantDetailScreen() {
  const { id } = useLocalSearchParams();
  const tenantId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "evicted">("active");
  const [leaseStart, setLeaseStart] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDate, setDepositDate] = useState("");
  const [depositStatus, setDepositStatus] = useState<"held" | "refunded">("held");

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

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setEmail(tenant.email);
      setPhone(tenant.phone);
      setUnitNumber(tenant.unitNumber);
      setRentAmount(tenant.rentAmount.toString());
      setStatus(tenant.status as "active" | "inactive" | "evicted");
      setLeaseStart(tenant.leaseStart.split('T')[0]);
      setLeaseEnd(tenant.leaseEnd.split('T')[0]);
      const t = tenant as any;
      setDepositAmount(t.securityDeposit != null ? String(t.securityDeposit) : "");
      setDepositDate(t.depositDate ? String(t.depositDate).split('T')[0] : "");
      setDepositStatus((t.depositStatus as "held" | "refunded") ?? "held");
    }
  }, [tenant]);

  const handleSave = () => {
    if (!name || !email || !phone || !unitNumber || !rentAmount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    updateMutation.mutate(
      {
        id: tenantId,
        data: {
          name,
          email,
          phone,
          unitNumber,
          rentAmount: parseFloat(rentAmount),
          status,
          leaseStart,
          leaseEnd,
          securityDeposit: depositAmount ? parseFloat(depositAmount) : undefined,
          depositDate: depositDate || undefined,
          depositStatus,
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
        onError: (err: any) =>
          Alert.alert("Error", err?.response?.data?.error || "Failed to delete tenant"),
      }
    );
  };

  const handleDelete = () => {
    const msg = `Delete "${tenant?.name}"?\n\nAll payment and maintenance records will also be deleted. This cannot be undone.`;
    if (Platform.OS === "web") {
      // Alert.alert callbacks are unreliable on Expo web — use browser confirm instead
      if (window.confirm(msg)) performDelete();
    } else {
      Alert.alert("Delete Tenant", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ]);
    }
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
    if (Platform.OS === "web") {
      if (window.confirm(msg)) doDelete();
    } else {
      Alert.alert("Delete Payment", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

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

  // Balance data from API (server-computed)
  const anyTenant = tenant as any;
  const monthsElapsed: number = anyTenant.monthsElapsed ?? 1;
  const totalExpected: number = anyTenant.totalExpected ?? 0;
  const totalPaid: number = anyTenant.totalPaid ?? 0;
  const balanceDue: number = anyTenant.balanceDue ?? 0;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Tenant Details</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!isEditing ? (
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
          ) : (
            <TouchableOpacity style={styles.iconButton} onPress={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Feather name="check" size={24} color={colors.primary} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!isEditing ? (
          <>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.avatarSection}>
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={{ color: colors.primaryForeground, fontSize: 32, fontWeight: "bold" }}>
                  {tenant.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.name, { color: colors.foreground }]}>{tenant.name}</Text>
              <Text style={[styles.propertyText, { color: colors.mutedForeground }]}>{tenant.propertyName} • Unit {tenant.unitNumber}</Text>
              <View style={[styles.badge, { backgroundColor: `${tenant.status === 'active' ? colors.success : colors.destructive}20`, marginTop: 8 }]}>
                <Text style={{ color: tenant.status === 'active' ? colors.success : colors.destructive, fontWeight: "bold", fontSize: 12, textTransform: "uppercase" }}>
                  {tenant.status}
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{tenant.email}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Phone</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{tenant.phone}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Rent Amount</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>₹{tenant.rentAmount.toLocaleString("en-IN")}/mo</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Lease Start</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{new Date(tenant.leaseStart).toLocaleDateString()}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Lease End</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{new Date(tenant.leaseEnd).toLocaleDateString()}</Text>
            </View>
          </View>

          {/* Balance / Due Summary */}
          <View style={[styles.balanceCard, {
            backgroundColor: balanceDue > 0 ? `${colors.destructive}08` : `${colors.success}08`,
            borderColor: balanceDue > 0 ? `${colors.destructive}30` : `${colors.success}30`,
            marginTop: 16,
          }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Feather
                name={balanceDue > 0 ? "alert-circle" : "check-circle"}
                size={16}
                color={balanceDue > 0 ? colors.destructive : colors.success}
              />
              <Text style={{ fontSize: 15, fontWeight: "700", color: balanceDue > 0 ? colors.destructive : colors.success }}>
                {balanceDue > 0 ? "Outstanding Balance" : "All Paid Up"}
              </Text>
            </View>
            {[
              { label: "Monthly Rent", value: fmt(tenant.rentAmount), color: colors.foreground },
              { label: "Months Active", value: `${monthsElapsed} months`, color: colors.foreground },
              { label: "Total Expected", value: fmt(totalExpected), color: colors.primary },
              { label: "Total Paid", value: fmt(totalPaid), color: colors.success },
              { label: "Balance Due", value: fmt(balanceDue), color: balanceDue > 0 ? colors.destructive : colors.success },
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
              onPress={() => {
                if (!tenant.phone) {
                  Alert.alert("No Phone Number", "This tenant has no phone number on file.");
                  return;
                }
                let digits = tenant.phone.replace(/\D/g, "");
                if (digits.length === 10) digits = "91" + digits;
                else if (digits.startsWith("0")) digits = "91" + digits.slice(1);
                const leaseEndStr = new Date(tenant.leaseEnd).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
                const message = [
                  `Hello ${tenant.name},`,
                  ``,
                  `This is a friendly reminder for your rent payment.`,
                  ``,
                  `🏠 Property: ${tenant.propertyName}`,
                  `📦 Unit: ${tenant.unitNumber}`,
                  `💰 Monthly Rent: ₹${Math.round(tenant.rentAmount).toLocaleString("en-IN")}`,
                  `⚠️ Balance Due: ₹${Math.round(balanceDue).toLocaleString("en-IN")}`,
                  `📅 Lease End: ${leaseEndStr}`,
                  ``,
                  `Please make the payment at your earliest convenience.`,
                  ``,
                  `Thank you,`,
                  `Gemini Rent Manager`,
                ].join("\n");
                const url = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`;
                Linking.openURL(url).catch(() =>
                  Alert.alert("WhatsApp Not Available", "Please check if WhatsApp is installed and the phone number is valid.")
                );
              }}
              activeOpacity={0.85}
            >
              <Feather name="message-circle" size={16} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Send Reminder</Text>
            </TouchableOpacity>
          </View>

          {/* Security Deposit card */}
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
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}
                    onPress={() => setIsEditing(true)}
                  >
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
                        <Text style={[styles.value, { color: colors.foreground }]}>{new Date(t.depositDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Text>
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
                          if (Platform.OS === "web") {
                            if (window.confirm(msg)) doRefund();
                          } else {
                            Alert.alert("Refund Deposit", msg, [
                              { text: "Cancel", style: "cancel" },
                              { text: "Mark Refunded", style: "default", onPress: doRefund },
                            ]);
                          }
                        }}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? (
                          <ActivityIndicator size="small" color={colors.success} />
                        ) : (
                          <Feather name="check-circle" size={15} color={colors.success} />
                        )}
                        <Text style={{ color: colors.success, fontWeight: "700", fontSize: 14 }}>Mark as Refunded</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            );
          })()}

          {/* Rent Ledger */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Rent Ledger</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{payments?.length ?? 0} records</Text>
            </View>
            {paymentsLoading ? (
              <View style={{ padding: 20, alignItems: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
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
                  <View
                    key={p.id}
                    style={[
                      styles.ledgerRow,
                      { borderBottomColor: colors.border },
                      idx === payments.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{monthLabel}</Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                        {p.method.replace(/_/g, " ")} • {new Date(p.paymentDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginRight: 8 }}>
                      ₹{Number(p.amount).toLocaleString("en-IN")}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: `${statusColor}20` }]}>
                      <Text style={{ fontSize: 9, fontWeight: "800", color: statusColor }}>{p.status.toUpperCase()}</Text>
                    </View>
                    <TouchableOpacity
                      style={{ padding: 8 }}
                      onPress={() => router.push(`/payment-edit?id=${p.id}` as any)}
                    >
                      <Feather name="edit-2" size={14} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ padding: 8 }}
                      onPress={() => router.push(`/payment-receipt?id=${p.id}` as any)}
                    >
                      <Feather name="external-link" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ padding: 8 }}
                      onPress={() => handleDeletePayment(p.id)}
                      disabled={deletePmtMutation.isPending}
                    >
                      <Feather name="trash-2" size={14} color={colors.destructive} />
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
          </>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Full Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={setName}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Phone</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Unit Number</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={unitNumber}
                  onChangeText={setUnitNumber}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Rent Amount</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={rentAmount}
                  onChangeText={setRentAmount}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Status</Text>
            <View style={[styles.segmentedControl, { marginBottom: 16 }]}>
              {(["active", "inactive", "evicted"] as const).map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.segmentOption, status === s && { backgroundColor: colors.primary }]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={{ fontSize: 12, color: status === s ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease Start (YYYY-MM-DD)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={leaseStart}
                  onChangeText={setLeaseStart}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease End (YYYY-MM-DD)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={leaseEnd}
                  onChangeText={setLeaseEnd}
                />
              </View>
            </View>

            <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground, marginBottom: 4 }]}>Security Deposit (Optional)</Text>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Amount (₹)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={depositAmount}
                  onChangeText={setDepositAmount}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={depositDate}
                  onChangeText={setDepositDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>

            <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 8 }]}>Status</Text>
            <View style={[styles.segmentedControl, { marginBottom: 8 }]}>
              {(["held", "refunded"] as const).map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.segmentOption, depositStatus === s && { backgroundColor: s === "refunded" ? colors.success : colors.warning }]}
                  onPress={() => setDepositStatus(s)}
                >
                  <Text style={{ fontSize: 12, color: depositStatus === s ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 16, paddingBottom: 60 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatar: { width: 80, height: 80, borderRadius: 40, justifyContent: "center", alignItems: "center", marginBottom: 12 },
  name: { fontSize: 24, fontWeight: "bold", marginBottom: 4 },
  propertyText: { fontSize: 16 },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.1)", marginBottom: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  label: { fontSize: 14, fontWeight: "500" },
  value: { fontSize: 14, fontWeight: "700" },
  balanceCard: { padding: 16, borderRadius: 16, borderWidth: 1 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52, borderRadius: 12 },
  ledgerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  sectionDivider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  segmentedControl: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8, padding: 4, marginBottom: 8 },
  segmentOption: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
});