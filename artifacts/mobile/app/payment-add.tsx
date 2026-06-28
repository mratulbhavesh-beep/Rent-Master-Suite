import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useCreatePayment, useListTenants, getListTenantsQueryKey, PaymentInputMethod, PaymentInputStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function PaymentAddScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [tenantId, setTenantId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState<PaymentInputMethod>("bank_transfer");
  const [status, setStatus] = useState<PaymentInputStatus>("paid");
  const [notes, setNotes] = useState("");

  const { data: tenants } = useListTenants({}, { query: { queryKey: getListTenantsQueryKey({}) } });
  const createMutation = useCreatePayment();

  const handleSave = () => {
    if (!tenantId || !amount || !paymentDate) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    
    const selectedTenant = tenants?.find(t => t.id === tenantId);
    if (!selectedTenant) return;

    const date = new Date(paymentDate);

    createMutation.mutate(
      {
        data: {
          tenantId,
          propertyId: selectedTenant.propertyId,
          amount: parseFloat(amount),
          paymentDate: date.toISOString(),
          month: date.getMonth() + 1,
          year: date.getFullYear(),
          method,
          status,
          notes
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
          router.back();
        },
        onError: () => Alert.alert("Error", "Failed to record payment")
      }
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Record Payment</Text>
        <View style={styles.iconButton} />
      </View>

      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Select Tenant*</Text>
          <View style={[styles.picker, { borderColor: colors.border }]}>
            {tenants?.map(t => (
              <TouchableOpacity 
                key={t.id} 
                style={[styles.pickerOption, tenantId === t.id && { backgroundColor: `${colors.primary}20` }]}
                onPress={() => {
                  setTenantId(t.id);
                  setAmount(t.rentAmount.toString());
                }}
              >
                <View>
                  <Text style={{ color: tenantId === t.id ? colors.primary : colors.foreground, fontWeight: "500" }}>{t.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t.propertyName} • Unit {t.unitNumber}</Text>
                </View>
                {tenantId === t.id && <Feather name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Amount (₹)*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholder="15000"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Date*</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                value={paymentDate}
                onChangeText={setPaymentDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Payment Method*</Text>
          <View style={styles.methodGrid}>
            {(["cash", "bank_transfer", "upi", "cheque", "online"] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.methodOption, method === m && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setMethod(m)}
              >
                <Text style={{ fontSize: 12, color: method === m ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>
                  {m.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Status*</Text>
          <View style={styles.segmentedControl}>
            {(["paid", "pending", "partial"] as const).map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.segmentOption, status === s && { backgroundColor: colors.primary }]}
                onPress={() => setStatus(s)}
              >
                <Text style={{ fontSize: 12, color: status === s ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Notes (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={2}
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        <TouchableOpacity 
          style={[styles.saveButton, { backgroundColor: colors.primary }]} 
          onPress={handleSave}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>Record Payment</Text>
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
  textArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  picker: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  pickerOption: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)" },
  segmentedControl: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8, padding: 4 },
  segmentOption: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodOption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.1)" },
  saveButton: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  saveButtonText: { fontSize: 16, fontWeight: "bold" },
});