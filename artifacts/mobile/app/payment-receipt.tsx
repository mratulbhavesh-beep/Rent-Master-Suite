import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGetPayment, getGetPaymentQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function PaymentReceiptScreen() {
  const { id } = useLocalSearchParams();
  const paymentId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: payment, isLoading } = useGetPayment(paymentId, {
    query: { queryKey: getGetPaymentQueryKey(paymentId), enabled: !!paymentId }
  });

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!payment) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Payment not found.</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dateStr = new Date(payment.paymentDate).toLocaleDateString("en-IN", {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Receipt</Text>
        <TouchableOpacity style={styles.iconButton}>
          <Feather name="share" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.receiptHeader}>
            <View style={[styles.iconCircle, { backgroundColor: `${colors.success}20` }]}>
              <Feather name="check" size={32} color={colors.success} />
            </View>
            <Text style={[styles.successText, { color: colors.success }]}>Payment Successful</Text>
            <Text style={[styles.amountText, { color: colors.foreground }]}>₹{payment.amount.toLocaleString("en-IN")}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Receipt No</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>{payment.receiptNumber || `REC-${payment.id.toString().padStart(6, '0')}`}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Date</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>{dateStr}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Tenant</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>{payment.tenantName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Property</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>{payment.propertyName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>For Month</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>{new Date(payment.year, payment.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Payment Method</Text>
            <Text style={[styles.value, { color: colors.foreground, textTransform: "capitalize" }]}>{payment.method.replace('_', ' ')}</Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Gemini Rent Manager</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.doneButton, { backgroundColor: colors.primary }]} 
          onPress={() => router.back()}
        >
          <Text style={[styles.doneButtonText, { color: colors.primaryForeground }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 24, flex: 1, justifyContent: "center" },
  receiptCard: { borderRadius: 16, borderWidth: 1, padding: 24, paddingBottom: 16, marginBottom: 32, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5 },
  receiptHeader: { alignItems: "center", marginBottom: 24 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, justifyContent: "center", alignItems: "center", marginBottom: 16 },
  successText: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  amountText: { fontSize: 36, fontWeight: "bold" },
  divider: { height: 1, backgroundColor: "rgba(0,0,0,0.1)", marginVertical: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: "500", textAlign: "right", flex: 1, marginLeft: 16 },
  footer: { alignItems: "center", marginTop: 8 },
  footerText: { fontSize: 12, fontWeight: "bold", letterSpacing: 1 },
  doneButton: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  doneButtonText: { fontSize: 16, fontWeight: "bold" },
});