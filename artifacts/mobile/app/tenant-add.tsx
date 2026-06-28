import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useCreateTenant, useListProperties, getListPropertiesQueryKey, TenantInputStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function TenantAddScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [leaseStart, setLeaseStart] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");

  const { data: properties } = useListProperties({}, { query: { queryKey: getListPropertiesQueryKey({}) } });
  const createMutation = useCreateTenant();

  const handleSave = () => {
    if (!name || !email || !phone || !propertyId || !unitNumber || !rentAmount || !leaseStart || !leaseEnd) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    createMutation.mutate(
      {
        data: {
          name,
          email,
          phone,
          propertyId,
          unitNumber,
          rentAmount: parseFloat(rentAmount),
          status: "active",
          leaseStart: new Date(leaseStart).toISOString(),
          leaseEnd: new Date(leaseEnd).toISOString(),
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
          router.back();
        },
        onError: () => Alert.alert("Error", "Failed to add tenant")
      }
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Add Tenant</Text>
        <View style={styles.iconButton} />
      </View>

      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Full Name*</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={name}
            onChangeText={setName}
            placeholder="John Doe"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Email*</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="john@example.com"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Phone*</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+91 9876543210"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property*</Text>
          <View style={[styles.propertyPicker, { borderColor: colors.border }]}>
            {properties?.map(p => (
              <TouchableOpacity 
                key={p.id} 
                style={[styles.propertyOption, propertyId === p.id && { backgroundColor: `${colors.primary}20` }]}
                onPress={() => setPropertyId(p.id)}
              >
                <Text style={{ color: propertyId === p.id ? colors.primary : colors.foreground }}>{p.name}</Text>
                {propertyId === p.id && <Feather name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Unit Number*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={unitNumber}
                onChangeText={setUnitNumber}
                placeholder="A-101"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Rent (₹)*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={rentAmount}
                onChangeText={setRentAmount}
                keyboardType="numeric"
                placeholder="15000"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease Start*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={leaseStart}
                onChangeText={setLeaseStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lease End*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={leaseEnd}
                onChangeText={setLeaseEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.saveButton, { backgroundColor: colors.primary }]} 
          onPress={handleSave}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>Add Tenant</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 16, paddingBottom: 40 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 24 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  propertyPicker: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  propertyOption: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)" },
  saveButton: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  saveButtonText: { fontSize: 16, fontWeight: "bold" },
});