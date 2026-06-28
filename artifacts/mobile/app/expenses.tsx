import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, ScrollView } from "react-native";
import { useListExpenses, getListExpensesQueryKey, Expense, useCreateExpense, ExpenseInputCategory, useListProperties, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

export default function ExpensesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseInputCategory>("maintenance");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [propertyId, setPropertyId] = useState<number | null>(null);

  const { data: expenses, isLoading, isFetching, refetch } = useListExpenses(
    {},
    { query: { queryKey: getListExpensesQueryKey({}) } }
  );

  const { data: properties } = useListProperties({}, { query: { queryKey: getListPropertiesQueryKey({}) } });

  const createMutation = useCreateExpense();

  const handleSave = () => {
    if (!title || !amount || !date) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    
    createMutation.mutate(
      {
        data: {
          title,
          amount: parseFloat(amount),
          category,
          date: new Date(date).toISOString(),
          propertyId: propertyId || undefined,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
          setIsAddModalVisible(false);
          // reset
          setTitle("");
          setAmount("");
          setPropertyId(null);
        },
        onError: () => Alert.alert("Error", "Failed to add expense")
      }
    );
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case "repair": return "tool";
      case "utility": return "zap";
      case "tax": return "file-text";
      case "insurance": return "shield";
      case "salary": return "users";
      case "maintenance": return "settings";
      default: return "tag";
    }
  };

  const renderItem = ({ item }: { item: Expense }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.iconContainer, { backgroundColor: `${colors.primary}15` }]}>
            <Feather name={getCategoryIcon(item.category) as any} size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.cardForeground }]}>{item.title}</Text>
            <Text style={[styles.propertyName, { color: colors.mutedForeground }]}>{item.propertyName || 'General'}</Text>
          </View>
        </View>
        <Text style={[styles.amount, { color: colors.foreground }]}>₹{item.amount.toLocaleString("en-IN")}</Text>
      </View>
      <View style={styles.cardFooter}>
        <Text style={[styles.category, { color: colors.primary }]}>{item.category.toUpperCase()}</Text>
        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
          {new Date(item.date).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Expenses</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setIsAddModalVisible(true)}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={expenses || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Feather name="file-text" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No expenses recorded</Text>
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
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Expense</Text>
            <TouchableOpacity onPress={handleSave} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "bold" }}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
          
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Title*</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Plumbing Repair"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Amount (₹)*</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="5000"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Date*</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Category*</Text>
            <View style={styles.categoryGrid}>
              {(["repair", "utility", "tax", "insurance", "maintenance", "salary", "other"] as const).map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryOption, category === c && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={{ fontSize: 12, color: category === c ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property (Optional)</Text>
            <View style={[styles.picker, { borderColor: colors.border }]}>
              <TouchableOpacity 
                style={[styles.pickerOption, propertyId === null && { backgroundColor: `${colors.primary}20` }]}
                onPress={() => setPropertyId(null)}
              >
                <Text style={{ color: propertyId === null ? colors.primary : colors.foreground }}>General (No Property)</Text>
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 16, fontWeight: "600" },
  propertyName: { fontSize: 13 },
  amount: { fontSize: 18, fontWeight: "bold" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.1)" },
  category: { fontSize: 12, fontWeight: "bold" },
  dateText: { fontSize: 13 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 16 },
  
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  modalTitle: { fontSize: 18, fontWeight: "bold" },
  modalContent: { padding: 16, paddingBottom: 40 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 16 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryOption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.1)" },
  picker: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  pickerOption: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)" },
});