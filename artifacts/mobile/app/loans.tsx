import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, ScrollView } from "react-native";
import { useListLoans, getListLoansQueryKey, Loan, useCreateLoan, useListProperties, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

export default function LoansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [lenderName, setLenderName] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [emiAmount, setEmiAmount] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [totalMonths, setTotalMonths] = useState("");
  const [propertyId, setPropertyId] = useState<number | null>(null);

  const { data: loans, isLoading, isFetching, refetch } = useListLoans({ query: { queryKey: getListLoansQueryKey() } });
  const { data: properties } = useListProperties({}, { query: { queryKey: getListPropertiesQueryKey({}) } });

  const createMutation = useCreateLoan();

  const handleSave = () => {
    if (!lenderName || !principalAmount || !interestRate || !emiAmount || !startDate || !totalMonths) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    
    createMutation.mutate(
      {
        data: {
          lenderName,
          principalAmount: parseFloat(principalAmount),
          interestRate: parseFloat(interestRate),
          emiAmount: parseFloat(emiAmount),
          startDate: new Date(startDate).toISOString(),
          totalMonths: parseInt(totalMonths, 10),
          propertyId: propertyId || undefined,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
          setIsAddModalVisible(false);
        },
        onError: () => Alert.alert("Error", "Failed to add loan")
      }
    );
  };

  const renderItem = ({ item }: { item: Loan }) => {
    const progress = item.paidMonths / item.totalMonths;
    return (
      <TouchableOpacity 
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/loan-detail?id=${item.id}` as any)}
      >
        <View style={styles.cardHeader}>
          <View>
            <Text style={[styles.title, { color: colors.cardForeground }]}>{item.lenderName}</Text>
            <Text style={[styles.propertyName, { color: colors.mutedForeground }]}>{item.propertyName || 'Personal Loan'}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: `${colors.primary}20` }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{item.status.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.amountsRow}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Principal</Text>
            <Text style={[styles.amountValue, { color: colors.foreground }]}>₹{item.principalAmount.toLocaleString("en-IN")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>EMI Amount</Text>
            <Text style={[styles.emiValue, { color: colors.accent }]}>₹{item.emiAmount.toLocaleString("en-IN")}/mo</Text>
          </View>
        </View>

        <View style={styles.progressContainer}>
          <View style={styles.progressTextRow}>
            <Text style={[styles.progressText, { color: colors.mutedForeground }]}>{item.paidMonths} / {item.totalMonths} Months</Text>
            <Text style={[styles.progressText, { color: colors.mutedForeground }]}>{Math.round(progress * 100)}%</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: colors.secondary }]}>
            <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Loans & EMIs</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setIsAddModalVisible(true)}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={loans || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Feather name="credit-card" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active loans</Text>
            </View>
          ) : null
        }
      />

      <Modal visible={isAddModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setIsAddModalVisible(false)}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsAddModalVisible(false)}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Loan</Text>
            <TouchableOpacity onPress={handleSave} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "bold" }}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
          
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Lender Name*</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={lenderName}
              onChangeText={setLenderName}
              placeholder="e.g. HDFC Bank"
              placeholderTextColor={colors.mutedForeground}
            />

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Principal (₹)*</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={principalAmount}
                  onChangeText={setPrincipalAmount}
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Interest Rate (%)*</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={interestRate}
                  onChangeText={setInterestRate}
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>EMI Amount (₹)*</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={emiAmount}
                  onChangeText={setEmiAmount}
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Total Months*</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
                  value={totalMonths}
                  onChangeText={setTotalMonths}
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Start Date*</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property (Optional)</Text>
            <View style={[styles.picker, { borderColor: colors.border }]}>
              <TouchableOpacity 
                style={[styles.pickerOption, propertyId === null && { backgroundColor: `${colors.primary}20` }]}
                onPress={() => setPropertyId(null)}
              >
                <Text style={{ color: propertyId === null ? colors.primary : colors.foreground }}>None (Personal)</Text>
                {propertyId === null && <Feather name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
              {properties?.map(p => (
                <TouchableOpacity 
                  key={p.id} 
                  style={[styles.pickerOption, propertyId === p.id && { backgroundColor: `${colors.primary}20` }]}
                  onPress={() => setPropertyId(p.id)}
                >
                  <Text style={{ color: propertyId === p.id ? colors.primary : colors.foreground }}>{p.name}</Text>
                  {propertyId === p.id && <Feather name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "flex-start" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  addButton: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  listContent: { padding: 16, paddingBottom: 100 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  propertyName: { fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  amountsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  label: { fontSize: 12, marginBottom: 4 },
  amountValue: { fontSize: 18, fontWeight: "bold" },
  emiValue: { fontSize: 18, fontWeight: "bold" },
  progressContainer: { marginTop: 8 },
  progressTextRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressText: { fontSize: 12, fontWeight: "500" },
  progressBarBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressBarFill: { height: "100%", borderRadius: 3 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 16 },
  
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  modalTitle: { fontSize: 18, fontWeight: "bold" },
  modalContent: { padding: 16, paddingBottom: 40 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 16 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  picker: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  pickerOption: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)" },
});