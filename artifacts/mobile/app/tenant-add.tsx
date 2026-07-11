import React, { useState } from "react";
import { useDateInput } from "@/utils/useDateInput";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useCreateTenant,
  useListProperties,
  getListPropertiesQueryKey,
  getListTenantsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const today = new Date().toISOString().split("T")[0];
const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  .toISOString()
  .split("T")[0];

// Defined OUTSIDE TenantAddScreen so its reference is stable across renders.
// If defined inside, React sees a new component type on every state change,
// unmounts/remounts the TextInput children, and dismisses the keyboard.
function Field({
  label,
  errorKey,
  errors,
  colors,
  children,
}: {
  label: string;
  errorKey: string;
  errors: Record<string, string>;
  colors: { foreground: string; destructive: string };
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.inputLabel, { color: colors.foreground }]}>{label}</Text>
      {children}
      {errors[errorKey] ? (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{errors[errorKey]}</Text>
      ) : null}
    </View>
  );
}

export default function TenantAddScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [propertyId, setPropertyId] = useState<number | null>(
    params.propertyId ? Number(params.propertyId) : null
  );
  const [unitNumber, setUnitNumber] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const { displayValue: leaseStartDisplay, onChangeDisplay: onLeaseStartChange, isoValue: leaseStart } = useDateInput(today);
  const { displayValue: leaseEndDisplay, onChangeDisplay: onLeaseEndChange, isoValue: leaseEnd } = useDateInput(nextYear);
  const [depositAmount, setDepositAmount] = useState("");
  const { displayValue: depositDateDisplay, onChangeDisplay: onDepositDateChange, isoValue: depositDate } = useDateInput(today);
  const [billingCycle, setBillingCycle] = useState<"weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [rentCollectionType, setRentCollectionType] = useState<"advance" | "post_paid">("post_paid");
  const [gracePeriodDays, setGracePeriodDays] = useState(5);
  const [useBusinessDefault, setUseBusinessDefault] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: properties } = useListProperties(
    {},
    { query: { queryKey: getListPropertiesQueryKey({}) } }
  );
  const createMutation = useCreateTenant();

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Full name is required";
    if (!email.trim()) newErrors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      newErrors.email = "Enter a valid email";
    if (!phone.trim()) newErrors.phone = "Phone number is required";
    if (!propertyId) newErrors.propertyId = "Please select a property";
    if (!unitNumber.trim()) newErrors.unitNumber = "Unit number is required";
    if (!rentAmount.trim()) newErrors.rentAmount = "Rent amount is required";
    else if (isNaN(parseFloat(rentAmount)) || parseFloat(rentAmount) <= 0)
      newErrors.rentAmount = "Enter a valid amount";
    if (!leaseStart) newErrors.leaseStart = "Lease start date is required";
    if (!leaseEnd) newErrors.leaseEnd = "Lease end date is required";
    else if (leaseStart && leaseEnd <= leaseStart)
      newErrors.leaseEnd = "End date must be after start date";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    createMutation.mutate(
      {
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          propertyId: propertyId!,
          unitNumber: unitNumber.trim(),
          rentAmount: parseFloat(rentAmount),
          status: "active",
          leaseStart,
          leaseEnd,
          securityDeposit: depositAmount ? parseFloat(depositAmount) : undefined,
          depositDate: depositAmount ? depositDate : undefined,
          depositStatus: depositAmount ? "held" : undefined,
          billingCycle: useBusinessDefault ? undefined : billingCycle,
          rentCollectionType: useBusinessDefault ? undefined : rentCollectionType,
          gracePeriodDays: useBusinessDefault ? undefined : gracePeriodDays,
          useBusinessDefault,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTenantsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          Alert.alert("Success", "Tenant added successfully!", [
            { text: "OK", onPress: () => router.back() },
          ]);
        },
        onError: (err: any) => {
          const message =
            err?.response?.data?.error ||
            err?.message ||
            "Failed to add tenant. Please try again.";
          Alert.alert("Error", message);
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
          Add Tenant
        </Text>
        <View style={styles.iconButton} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Field label="Full Name *" errorKey="name" errors={errors} colors={colors}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                  borderColor: errors.name ? colors.destructive : colors.border,
                },
              ]}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setErrors((e) => ({ ...e, name: "" }));
              }}
              placeholder="John Doe"
              placeholderTextColor={colors.mutedForeground}
            />
          </Field>

          <Field label="Email *" errorKey="email" errors={errors} colors={colors}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                  borderColor: errors.email
                    ? colors.destructive
                    : colors.border,
                },
              ]}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setErrors((e) => ({ ...e, email: "" }));
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="john@example.com"
              placeholderTextColor={colors.mutedForeground}
            />
          </Field>

          <Field label="Phone *" errorKey="phone" errors={errors} colors={colors}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  color: colors.text,
                  borderColor: errors.phone
                    ? colors.destructive
                    : colors.border,
                },
              ]}
              value={phone}
              onChangeText={(v) => {
                setPhone(v);
                setErrors((e) => ({ ...e, phone: "" }));
              }}
              keyboardType="phone-pad"
              placeholder="+91 9876543210"
              placeholderTextColor={colors.mutedForeground}
            />
          </Field>

          <View style={styles.fieldWrapper}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>
              Property *
            </Text>
            {(!properties || properties.length === 0) ? (
              <View
                style={[
                  styles.emptyProperties,
                  { backgroundColor: colors.input, borderColor: colors.border },
                ]}
              >
                <Feather name="info" size={14} color={colors.mutedForeground} />
                <Text
                  style={[styles.emptyPropertiesText, { color: colors.mutedForeground }]}
                >
                  No properties found. Add a property first.
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.propertyPicker,
                  {
                    borderColor: errors.propertyId
                      ? colors.destructive
                      : colors.border,
                  },
                ]}
              >
                {properties.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.propertyOption,
                      propertyId === p.id && {
                        backgroundColor: `${colors.primary}15`,
                      },
                    ]}
                    onPress={() => {
                      setPropertyId(p.id);
                      setErrors((e) => ({ ...e, propertyId: "" }));
                    }}
                  >
                    <View>
                      <Text
                        style={{
                          color:
                            propertyId === p.id
                              ? colors.primary
                              : colors.foreground,
                          fontWeight: propertyId === p.id ? "600" : "400",
                        }}
                      >
                        {p.name}
                      </Text>
                      <Text
                        style={{ color: colors.mutedForeground, fontSize: 12 }}
                      >
                        {p.address}
                      </Text>
                    </View>
                    {propertyId === p.id && (
                      <Feather
                        name="check-circle"
                        size={18}
                        color={colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {errors.propertyId ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>
                {errors.propertyId}
              </Text>
            ) : null}
          </View>

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Field label="Unit Number *" errorKey="unitNumber" errors={errors} colors={colors}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.input,
                      color: colors.text,
                      borderColor: errors.unitNumber
                        ? colors.destructive
                        : colors.border,
                    },
                  ]}
                  value={unitNumber}
                  onChangeText={(v) => {
                    setUnitNumber(v);
                    setErrors((e) => ({ ...e, unitNumber: "" }));
                  }}
                  placeholder="A-101"
                  placeholderTextColor={colors.mutedForeground}
                />
              </Field>
            </View>
            <View style={styles.flex1}>
              <Field label="Rent (₹) *" errorKey="rentAmount" errors={errors} colors={colors}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.input,
                      color: colors.text,
                      borderColor: errors.rentAmount
                        ? colors.destructive
                        : colors.border,
                    },
                  ]}
                  value={rentAmount}
                  onChangeText={(v) => {
                    setRentAmount(v);
                    setErrors((e) => ({ ...e, rentAmount: "" }));
                  }}
                  keyboardType="numeric"
                  placeholder="15000"
                  placeholderTextColor={colors.mutedForeground}
                />
              </Field>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Field label="Lease Start *" errorKey="leaseStart" errors={errors} colors={colors}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.input,
                      color: colors.text,
                      borderColor: errors.leaseStart
                        ? colors.destructive
                        : colors.border,
                    },
                  ]}
                  value={leaseStartDisplay}
                  onChangeText={(v) => {
                    onLeaseStartChange(v);
                    setErrors((e) => ({ ...e, leaseStart: "" }));
                  }}
                  placeholder="DD/MM/YYYY"
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </Field>
            </View>
            <View style={styles.flex1}>
              <Field label="Lease End *" errorKey="leaseEnd" errors={errors} colors={colors}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.input,
                      color: colors.text,
                      borderColor: errors.leaseEnd
                        ? colors.destructive
                        : colors.border,
                    },
                  ]}
                  value={leaseEndDisplay}
                  onChangeText={(v) => {
                    onLeaseEndChange(v);
                    setErrors((e) => ({ ...e, leaseEnd: "" }));
                  }}
                  placeholder="DD/MM/YYYY"
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </Field>
            </View>
          </View>
          {/* Security Deposit — optional */}
          <View style={[styles.fieldWrapper, { marginTop: 8 }]}>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.1)", marginVertical: 16 }} />
            <Text style={[styles.inputLabel, { color: colors.foreground, marginTop: 0, marginBottom: 4 }]}>
              Security Deposit (Optional)
            </Text>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Amount (₹)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={depositAmount}
                  onChangeText={setDepositAmount}
                  keyboardType="numeric"
                  placeholder="50000"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Date (DD/MM/YYYY)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={depositDateDisplay}
                  onChangeText={onDepositDateChange}
                  placeholder="DD/MM/YYYY"
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>
          </View>
          {/* Billing Settings */}
          <View style={[styles.fieldWrapper, { marginTop: 8 }]}>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.1)", marginVertical: 16 }} />
            <Text style={[styles.inputLabel, { color: colors.foreground, marginTop: 0, marginBottom: 4 }]}>
              Billing Settings
            </Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 12 }}>
              Controls how rent entries are automatically generated
            </Text>

            {/* Use Business Default toggle */}
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
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>

      {/* Button is OUTSIDE the scroll — always receives taps */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: colors.primary },
            createMutation.isPending && { opacity: 0.7 },
          ]}
          onPress={handleSave}
          disabled={createMutation.isPending}
          activeOpacity={0.8}
        >
          {createMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text
                style={[styles.saveButtonText, { color: colors.primaryForeground }]}
              >
                Saving...
              </Text>
            </View>
          ) : (
            <Text
              style={[styles.saveButtonText, { color: colors.primaryForeground }]}
            >
              Add Tenant
            </Text>
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
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 8 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  fieldWrapper: { marginBottom: 4 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 6, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  errorText: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  propertyPicker: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  propertyOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  emptyProperties: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  emptyPropertiesText: { fontSize: 13, flex: 1 },
  footer: {
    padding: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveButton: {
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  saveButtonText: { fontSize: 16, fontWeight: "bold" },
});
