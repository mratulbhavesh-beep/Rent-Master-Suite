import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useGetBusinessBillingSettings,
  useUpsertBusinessBillingSettings,
  getGetBusinessBillingSettingsQueryKey,
  useTriggerRentGeneration,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type BillingCycle = "monthly" | "quarterly" | "yearly";
type CollectionType = "advance" | "post_paid";

const BILLING_CYCLES: { key: BillingCycle; label: string; desc: string }[] = [
  { key: "monthly", label: "Monthly", desc: "Rent due every month" },
  { key: "quarterly", label: "Quarterly", desc: "Rent due every 3 months" },
  { key: "yearly", label: "Yearly", desc: "Rent due once a year" },
];

const COLLECTION_TYPES: { key: CollectionType; label: string; desc: string }[] = [
  { key: "post_paid", label: "Post-paid", desc: "Charged at end of period" },
  { key: "advance", label: "Advance", desc: "Charged at start of period" },
];

const GRACE_OPTIONS = [0, 3, 5, 7, 10, 15];

export default function BusinessSettingsBillingScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetBusinessBillingSettings({
    query: { queryKey: getGetBusinessBillingSettingsQueryKey() },
  });

  const saveMutation = useUpsertBusinessBillingSettings();
  const triggerMutation = useTriggerRentGeneration();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [collectionType, setCollectionType] = useState<CollectionType>("post_paid");
  const [gracePeriodDays, setGracePeriodDays] = useState(5);

  useEffect(() => {
    if (settings) {
      setBillingCycle((settings.defaultBillingCycle as BillingCycle) ?? "monthly");
      setCollectionType((settings.defaultRentCollectionType as CollectionType) ?? "post_paid");
      setGracePeriodDays(settings.defaultGracePeriodDays ?? 5);
    }
  }, [settings]);

  const handleSave = () => {
    saveMutation.mutate(
      {
        data: {
          defaultBillingCycle: billingCycle,
          defaultRentCollectionType: collectionType,
          defaultGracePeriodDays: gracePeriodDays,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBusinessBillingSettingsQueryKey() });
          Alert.alert("Saved", "Billing settings updated successfully.");
        },
        onError: (err: any) =>
          Alert.alert("Error", err?.response?.data?.error || "Failed to save settings"),
      }
    );
  };

  const handleTrigger = () => {
    Alert.alert(
      "Generate Rents Now",
      "This will create rent entries for all active tenants for any missed billing periods. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Generate",
          onPress: () => {
            triggerMutation.mutate(undefined, {
              onSuccess: (data) => {
                Alert.alert("Done", `Generated ${(data as any).generated} new rent entries.`);
              },
              onError: (err: any) =>
                Alert.alert("Error", err?.response?.data?.error || "Failed to trigger generation"),
            });
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Billing Settings</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}>
          <Feather name="info" size={15} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            These defaults apply to all tenants who have "Use Business Default" enabled. You can override billing settings per tenant.
          </Text>
        </View>

        {/* Billing Cycle */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Default Billing Cycle</Text>
          <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
            How often rent is charged
          </Text>
          {BILLING_CYCLES.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.optionRow,
                { borderColor: billingCycle === opt.key ? colors.primary : colors.border },
                billingCycle === opt.key && { backgroundColor: `${colors.primary}10` },
              ]}
              onPress={() => setBillingCycle(opt.key)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionLabel, { color: billingCycle === opt.key ? colors.primary : colors.foreground }]}>
                  {opt.label}
                </Text>
                <Text style={[styles.optionDesc, { color: colors.mutedForeground }]}>{opt.desc}</Text>
              </View>
              {billingCycle === opt.key
                ? <View style={[styles.radio, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    <View style={styles.radioDot} />
                  </View>
                : <View style={[styles.radio, { borderColor: colors.border }]} />
              }
            </TouchableOpacity>
          ))}
        </View>

        {/* Collection Type */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Rent Collection Timing</Text>
          <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
            When rent is due relative to the billing period
          </Text>
          {COLLECTION_TYPES.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.optionRow,
                { borderColor: collectionType === opt.key ? colors.primary : colors.border },
                collectionType === opt.key && { backgroundColor: `${colors.primary}10` },
              ]}
              onPress={() => setCollectionType(opt.key)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionLabel, { color: collectionType === opt.key ? colors.primary : colors.foreground }]}>
                  {opt.label}
                </Text>
                <Text style={[styles.optionDesc, { color: colors.mutedForeground }]}>{opt.desc}</Text>
              </View>
              {collectionType === opt.key
                ? <View style={[styles.radio, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    <View style={styles.radioDot} />
                  </View>
                : <View style={[styles.radio, { borderColor: colors.border }]} />
              }
            </TouchableOpacity>
          ))}
        </View>

        {/* Grace Period */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Grace Period</Text>
          <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
            Extra days after due date before rent is marked overdue
          </Text>
          <View style={styles.graceRow}>
            {GRACE_OPTIONS.map((days) => (
              <TouchableOpacity
                key={days}
                style={[
                  styles.graceChip,
                  {
                    backgroundColor: gracePeriodDays === days ? colors.primary : colors.input,
                    borderColor: gracePeriodDays === days ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setGracePeriodDays(days)}
                activeOpacity={0.7}
              >
                <Text style={[styles.graceChipText, { color: gracePeriodDays === days ? colors.primaryForeground : colors.foreground }]}>
                  {days === 0 ? "None" : `${days}d`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Manual trigger */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Generate Rents Now</Text>
          <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
            Manually trigger rent entry creation for all active tenants. Normally this runs automatically every hour.
          </Text>
          <TouchableOpacity
            style={[styles.triggerBtn, { backgroundColor: `${colors.accent}15`, borderColor: `${colors.accent}40` }, triggerMutation.isPending && { opacity: 0.6 }]}
            onPress={handleTrigger}
            disabled={triggerMutation.isPending}
            activeOpacity={0.8}
          >
            {triggerMutation.isPending
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Feather name="zap" size={16} color={colors.accent} />
            }
            <Text style={[styles.triggerText, { color: colors.accent }]}>
              {triggerMutation.isPending ? "Generating..." : "Run Rent Generation"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Save button */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }, saveMutation.isPending && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saveMutation.isPending}
          activeOpacity={0.85}
        >
          {saveMutation.isPending
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>Save Settings</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 16, paddingBottom: 8, gap: 16 },
  infoBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  sectionLabel: { fontSize: 16, fontWeight: "700" },
  sectionDesc: { fontSize: 13, marginTop: -4 },
  optionRow: {
    flexDirection: "row", alignItems: "center", padding: 14,
    borderRadius: 12, borderWidth: 1.5, gap: 12,
  },
  optionLabel: { fontSize: 15, fontWeight: "600" },
  optionDesc: { fontSize: 12, marginTop: 2 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    justifyContent: "center", alignItems: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff" },
  graceRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  graceChip: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5,
  },
  graceChipText: { fontSize: 14, fontWeight: "600" },
  triggerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, padding: 14, borderRadius: 12, borderWidth: 1,
  },
  triggerText: { fontSize: 15, fontWeight: "700" },
  footer: { padding: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  saveButton: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  saveButtonText: { fontSize: 16, fontWeight: "bold" },
});
