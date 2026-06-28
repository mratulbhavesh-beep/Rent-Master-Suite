import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useCreateProperty, PropertyInputStatus, PropertyInputType, getListPropertiesQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function PropertyAddScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<PropertyInputType>("apartment");
  const [totalUnits, setTotalUnits] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [status, setStatus] = useState<PropertyInputStatus>("available");
  const [description, setDescription] = useState("");

  const createMutation = useCreateProperty();

  const handleSave = () => {
    if (!name || !address || !totalUnits || !rentAmount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    createMutation.mutate(
      {
        data: {
          name,
          address,
          type,
          totalUnits: parseInt(totalUnits, 10),
          rentAmount: parseFloat(rentAmount),
          status,
          description
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          router.back();
        },
        onError: () => Alert.alert("Error", "Failed to add property")
      }
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Add Property</Text>
        <View style={styles.iconButton} />
      </View>

      <KeyboardAwareScrollViewCompat style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property Name*</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sunset Apartments"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Address*</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={address}
            onChangeText={setAddress}
            placeholder="Full Address"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property Type*</Text>
          <View style={styles.segmentedControl}>
            {(["apartment", "house", "commercial", "land"] as const).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.segmentOption, type === t && { backgroundColor: colors.primary }]}
                onPress={() => setType(t)}
              >
                <Text style={{ fontSize: 12, color: type === t ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Total Units*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={totalUnits}
                onChangeText={setTotalUnits}
                keyboardType="numeric"
                placeholder="e.g. 10"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Rent Amount (₹)*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={rentAmount}
                onChangeText={setRentAmount}
                keyboardType="numeric"
                placeholder="e.g. 15000"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Status*</Text>
          <View style={[styles.segmentedControl, { marginBottom: 16 }]}>
            {(["available", "occupied", "maintenance"] as const).map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.segmentOption, status === s && { backgroundColor: colors.primary }]}
                onPress={() => setStatus(s)}
              >
                <Text style={{ fontSize: 12, color: status === s ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Description (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            placeholder="Additional details..."
            placeholderTextColor={colors.mutedForeground}
          />
        </View>
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity 
          style={[styles.saveButton, { backgroundColor: colors.primary }, createMutation.isPending && { opacity: 0.7 }]} 
          onPress={handleSave}
          disabled={createMutation.isPending}
          activeOpacity={0.85}
        >
          {createMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>Saving...</Text>
            </View>
          ) : (
            <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>Add Property</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 8 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  textArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  segmentedControl: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8, padding: 4 },
  segmentOption: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  footer: { padding: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  saveButton: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  saveButtonText: { fontSize: 16, fontWeight: "bold" },
});