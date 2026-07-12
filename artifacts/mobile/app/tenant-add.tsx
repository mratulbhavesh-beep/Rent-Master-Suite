import React, { useState } from "react";
import { useDateInput } from "@/utils/useDateInput";
import { fmtDate } from "@/utils/dateFormat";
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
  const [durationYears, setDurationYears] = useState(1);
  const [durationMonths, setDurationMonths] = useState(0);
  const computedLeaseEnd = leaseStart
    ? addDaysUTC(addMonthsUTC(leaseStart, durationYears * 12 + durationMonths), -1)
    : null;
  const [depositAmount, setDepositAmount] = useState("");
  const { displayValue: depositDateDisplay, onChangeDisplay: onDepositDateChange, isoValue: depositDate } = useDateInput(today);
  const [billingCycle, setBillingCycle] = useState<"weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [rentCollectionType, setRentCollectionType] = useState<"advance" | "post_paid">("post_paid");
  const [gracePeriodDays, setGracePeriodDays] = useState(5);
  const [useBusinessDefault, setUseBusinessDefault] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Advanced Lease Settings (collapsed by default)
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [renewalMethod, setRenewalMethod] = useState<"same" | "custom">("same");
  const [renewalYears, setRenewalYears] = useState(0);
  const [renewalMonths, setRenewalMonths] = useState(11);
  const [rentEscalation, setRentEscalation] = useState(false);
  const [escalationFrequencyYears, setEscalationFrequencyYears] = useState("1");
  const [escalationType, setEscalationType] = useState<"percentage" | "fixed">("percentage");
  const [escalationValue, setEscalationValue] = useState("0");
  const [escalationApply, setEscalationApply] = useState<"automatic" | "manual">("manual");

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
    if (leaseStartDisplay.replace(/\D/g, "").length === 0) {
      newErrors.leaseStart = "Lease start date is required";
    } else if (!leaseStart) {
      newErrors.leaseStart = "Invalid date. Please enter a valid date in DD/MM/YYYY format.";
    }
    if (durationYears * 12 + durationMonths === 0) {
      newErrors.duration = "Duration must be at least 1 month";
    }
    if (depositDateDisplay.replace(/\D/g, "").length > 0 && !depositDate) {
      newErrors.depositDate = "Invalid date. Please enter a valid date in DD/MM/YYYY format.";
    }
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
          leaseEnd: computedLeaseEnd!,
          securityDeposit: depositAmount ? parseFloat(depositAmount) : undefined,
          depositDate: depositAmount ? depositDate : undefined,
          depositStatus: depositAmount ? "held" : undefined,
          billingCycle: useBusinessDefault ? undefined : billingCycle,
          rentCollectionType: useBusinessDefault ? undefined : rentCollectionType,
          gracePeriodDays: useBusinessDefault ? undefined : gracePeriodDays,
          useBusinessDefault,
          autoRenewal,
          renewalDuration: autoRenewal ? renewalMethod : undefined,
          customRenewalValue: autoRenewal && renewalMethod === "custom" ? (renewalYears * 12 + renewalMonths || 11) : undefined,
          customRenewalUnit: autoRenewal && renewalMethod === "custom" ? ("months" as const) : undefined,
          rentEscalation,
          escalationFrequencyYears: rentEscalation ? (parseInt(escalationFrequencyYears, 10) || 1) : undefined,
          escalationType: rentEscalation ? escalationType : undefined,
          escalationValue: rentEscalation ? (parseFloat(escalationValue) || 0) : undefined,
          escalationApply: rentEscalation ? escalationApply : undefined,
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
          </View>

          {/* Lease Duration */}
          <View style={styles.fieldWrapper}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease Duration *</Text>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Years (0 – 99)</Text>
                <View style={{ flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1, borderRadius: 8, borderColor: errors.duration ? colors.destructive : colors.border, backgroundColor: colors.input, overflow: "hidden" }}>
                  <TouchableOpacity
                    style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
                    onPress={() => { setDurationYears(y => Math.max(0, y - 1)); setErrors(e => ({ ...e, duration: "" })); }}
                  >
                    <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>−</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{durationYears}</Text>
                  </View>
                  <TouchableOpacity
                    style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}
                    onPress={() => { setDurationYears(y => Math.min(99, y + 1)); setErrors(e => ({ ...e, duration: "" })); }}
                  >
                    <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 4 }]}>Months (0 – 11)</Text>
                <View style={{ flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1, borderRadius: 8, borderColor: errors.duration ? colors.destructive : colors.border, backgroundColor: colors.input, overflow: "hidden" }}>
                  <TouchableOpacity
                    style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}
                    onPress={() => { setDurationMonths(m => Math.max(0, m - 1)); setErrors(e => ({ ...e, duration: "" })); }}
                  >
                    <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>−</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{durationMonths}</Text>
                  </View>
                  <TouchableOpacity
                    style={{ width: 44, height: 48, justifyContent: "center", alignItems: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }}
                    onPress={() => { setDurationMonths(m => Math.min(11, m + 1)); setErrors(e => ({ ...e, duration: "" })); }}
                  >
                    <Text style={{ fontSize: 22, color: colors.foreground, lineHeight: 26 }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            {errors.duration ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.duration}</Text> : null}
          </View>

          {/* Lease End — auto-calculated, read-only */}
          <View style={[styles.fieldWrapper, { marginBottom: 8 }]}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease End (auto-calculated)</Text>
            <View style={[styles.input, { backgroundColor: colors.card, justifyContent: "center", borderColor: colors.border }]}>
              <Text style={{ fontSize: 16, color: computedLeaseEnd ? colors.foreground : colors.mutedForeground }}>
                {computedLeaseEnd ? fmtDate(computedLeaseEnd) : "— / — / ——"}
              </Text>
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

          {/* Advanced Lease Settings (collapsed) */}
          <View style={[styles.fieldWrapper, { marginTop: 8 }]}>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.1)", marginVertical: 16 }} />
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}
              onPress={() => setAdvancedExpanded(v => !v)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: colors.foreground, marginTop: 0, marginBottom: 0 }]}>Advanced Lease Settings</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>Optional: Auto Renewal, Rent Escalation</Text>
              </View>
              <Feather name={advancedExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
            </TouchableOpacity>

            {advancedExpanded && (
              <View style={{ marginTop: 12 }}>

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
                  <View style={{ width: 46, height: 26, borderRadius: 13, padding: 2, backgroundColor: autoRenewal ? colors.primary : colors.border, justifyContent: "center" }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: autoRenewal ? "flex-end" : "flex-start" }} />
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
                        {/* Quick presets */}
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
                  <View style={{ width: 46, height: 26, borderRadius: 13, padding: 2, backgroundColor: rentEscalation ? colors.primary : colors.border, justifyContent: "center" }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: rentEscalation ? "flex-end" : "flex-start" }} />
                  </View>
                </TouchableOpacity>

                {rentEscalation && (
                  <View style={{ marginTop: 10, gap: 12 }}>
                    <View>
                      <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 0 }]}>Escalation Frequency</Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 8 }}>Rent increases every N years, independent of lease renewal</Text>
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
