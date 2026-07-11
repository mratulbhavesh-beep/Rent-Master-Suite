import React, { useState } from "react";
import { useDateInput } from "@/utils/useDateInput";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getListLoansQueryKey, useCreateLoanPayment, useListLoans } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fmtDate } from "@/utils/dateFormat";

export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams();
  const loanId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false);
  const [amount, setAmount] = useState("");
  const { displayValue: paymentDateDisplay, onChangeDisplay: onPaymentDateChange, isoValue: paymentDate } = useDateInput(new Date().toISOString().split('T')[0]);

  // Use useListLoans and find the specific loan by ID
  const { data: loans, isLoading, refetch } = useListLoans({
    query: { queryKey: getListLoansQueryKey() }
  });
  const loanDetail = loans?.find((l: any) => l.id === loanId);

  const createPaymentMutation = useCreateLoanPayment();

  const handleRecordPayment = () => {
    if (!amount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    if (paymentDateDisplay.replace(/\D/g, "").length === 0) {
      Alert.alert("Error", "Payment date is required");
      return;
    }
    if (!paymentDate) {
      Alert.alert("Invalid Date", "Invalid date. Please enter a valid date in DD/MM/YYYY format.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Error", "Enter a valid payment amount");
      return;
    }
    createPaymentMutation.mutate(
      {
        id: loanId,
        data: {
          amount: parsedAmount,
          paymentDate: new Date(paymentDate).toISOString(),
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
          setIsPaymentModalVisible(false);
          setAmount("");
        },
        onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to record payment")
      }
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const anyDetail = loanDetail as any;
  const loan = anyDetail?.loan ?? loanDetail;
  const payments: any[] = anyDetail?.payments ?? [];

  if (!loan) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Loan not found.</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const progress = loan.paidMonths / loan.totalMonths;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Loan Detail</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.lenderName, { color: colors.foreground }]}>{loan.lenderName}</Text>
          <Text style={[styles.propertyName, { color: colors.mutedForeground }]}>{loan.propertyName || 'Personal Loan'}</Text>
          
          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Principal Amount</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>₹{loan.principalAmount.toLocaleString("en-IN")}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Interest Rate</Text>
            <Text style={[styles.value, { color: colors.foreground }]}>{loan.interestRate}% p.a.</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>EMI Amount</Text>
            <Text style={[styles.value, { color: colors.accent, fontWeight: "bold" }]}>₹{loan.emiAmount.toLocaleString("en-IN")}/mo</Text>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressTextRow}>
              <Text style={[styles.progressText, { color: colors.mutedForeground }]}>{loan.paidMonths} of {loan.totalMonths} Months Paid</Text>
              <Text style={[styles.progressText, { color: colors.primary }]}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={[styles.progressBarBg, { backgroundColor: colors.secondary }]}>
              <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment History</Text>
          <TouchableOpacity 
            style={[styles.smallBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              setAmount(loan.emiAmount.toString());
              setIsPaymentModalVisible(true);
            }}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text style={[styles.smallBtnText, { color: colors.primaryForeground }]}>Record EMI</Text>
          </TouchableOpacity>
        </View>

        {payments.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ color: colors.mutedForeground }}>No payments recorded yet</Text>
          </View>
        ) : (
          payments.map((payment: any, index: number) => (
            <View key={payment.id || index} style={[styles.paymentItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View>
                <Text style={[styles.paymentDate, { color: colors.foreground }]}>
                  {fmtDate(payment.paymentDate)}
                </Text>
              </View>
              <Text style={[styles.paymentAmount, { color: colors.success }]}>₹{payment.amount.toLocaleString("en-IN")}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={isPaymentModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Record EMI Payment</Text>
            
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Amount (₹)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Payment Date</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={paymentDateDisplay}
              onChangeText={onPaymentDateChange}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: colors.secondary }]}
                onPress={() => setIsPaymentModalVisible(false)}
              >
                <Text style={{ color: colors.secondaryForeground, fontWeight: "bold" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleRecordPayment}
                disabled={createPaymentMutation.isPending}
              >
                {createPaymentMutation.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontWeight: "bold" }}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 16, paddingBottom: 40 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 24 },
  lenderName: { fontSize: 24, fontWeight: "bold", marginBottom: 4 },
  propertyName: { fontSize: 14, marginBottom: 16 },
  divider: { height: 1, backgroundColor: "rgba(0,0,0,0.1)", marginBottom: 16 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "500" },
  value: { fontSize: 16, fontWeight: "600" },
  progressContainer: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.1)" },
  progressTextRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  progressText: { fontSize: 13, fontWeight: "bold" },
  progressBarBg: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressBarFill: { height: "100%", borderRadius: 4 },
  
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "bold" },
  smallBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, gap: 4 },
  smallBtnText: { fontSize: 12, fontWeight: "bold" },
  
  paymentItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  paymentDate: { fontSize: 14, fontWeight: "500" },
  paymentAmount: { fontSize: 16, fontWeight: "bold" },
  emptyState: { padding: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.02)", borderRadius: 12 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { padding: 24, borderRadius: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 16 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 24 },
  modalBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, minWidth: 100, alignItems: "center" },
});