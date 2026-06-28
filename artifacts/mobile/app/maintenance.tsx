import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, ScrollView } from "react-native";
import { useListMaintenanceRequests, getListMaintenanceRequestsQueryKey, MaintenanceRequest, useCreateMaintenanceRequest, MaintenanceRequestInputPriority, useListProperties, getListPropertiesQueryKey, useListTenants, getListTenantsQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

export default function MaintenanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<MaintenanceRequestInputPriority>("medium");
  const [propertyId, setPropertyId] = useState<number | null>(null);

  const { data: requests, isLoading, isFetching, refetch } = useListMaintenanceRequests({}, { query: { queryKey: getListMaintenanceRequestsQueryKey({}) } });
  const { data: properties } = useListProperties({}, { query: { queryKey: getListPropertiesQueryKey({}) } });

  const createMutation = useCreateMaintenanceRequest();

  useFocusEffect(useCallback(() => { refetch(); }, []));

  const handleSave = () => {
    if (!title.trim() || !description.trim() || !propertyId) {
      Alert.alert("Error", "Please fill in all required fields (Property is required)");
      return;
    }
    createMutation.mutate(
      {
        data: {
          title: title.trim(),
          description: description.trim(),
          priority,
          propertyId,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
          setIsAddModalVisible(false);
          setTitle("");
          setDescription("");
          setPropertyId(null);
          setPriority("medium");
        },
        onError: (err: any) => Alert.alert("Error", err?.response?.data?.error || "Failed to add request")
      }
    );
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case "low": return colors.success;
      case "medium": return colors.primary;
      case "high": return colors.warning;
      case "urgent": return colors.destructive;
      default: return colors.mutedForeground;
    }
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case "open": return colors.destructive;
      case "in_progress": return colors.warning;
      case "resolved": return colors.primary;
      case "closed": return colors.success;
      default: return colors.mutedForeground;
    }
  };

  const renderItem = ({ item }: { item: MaintenanceRequest }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.cardForeground }]}>{item.title}</Text>
          <Text style={[styles.propertyName, { color: colors.mutedForeground }]}>{item.propertyName}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
          <Text style={[styles.badgeText, { color: getStatusColor(item.status) }]}>{item.status.replace('_', ' ').toUpperCase()}</Text>
        </View>
      </View>
      
      <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={2}>
        {item.description}
      </Text>

      <View style={styles.cardFooter}>
        <View style={styles.footerRow}>
          <Feather name="alert-circle" size={14} color={getPriorityColor(item.priority)} />
          <Text style={[styles.priorityText, { color: getPriorityColor(item.priority) }]}>
            {item.priority.toUpperCase()} PRIORITY
          </Text>
        </View>
        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
          {new Date(item.createdAt).toLocaleDateString("en-IN", { day: 'numeric', month: 'short' })}
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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Maintenance</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setIsAddModalVisible(true)}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={requests || []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Feather name="tool" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No maintenance requests</Text>
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
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Request</Text>
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
              placeholder="e.g. Broken AC"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Description*</Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              placeholder="Details of the issue..."
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Priority*</Text>
            <View style={styles.priorityGrid}>
              {(["low", "medium", "high", "urgent"] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.priorityOption, priority === p && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={{ fontSize: 12, color: priority === p ? colors.primaryForeground : colors.mutedForeground, textTransform: "capitalize" }}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property*</Text>
            <View style={[styles.picker, { borderColor: colors.border }]}>
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  title: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  propertyName: { fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "bold" },
  description: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.1)" },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  priorityText: { fontSize: 11, fontWeight: "bold" },
  dateText: { fontSize: 12 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyText: { marginTop: 12, fontSize: 16 },
  
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  modalTitle: { fontSize: 18, fontWeight: "bold" },
  modalContent: { padding: 16, paddingBottom: 40 },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 16 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  textArea: { height: 100, paddingTop: 12, textAlignVertical: "top" },
  priorityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  priorityOption: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.1)" },
  picker: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  pickerOption: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)" },
});