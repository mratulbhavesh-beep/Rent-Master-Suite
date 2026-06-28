import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGetProperty, getGetPropertyQueryKey, useUpdateProperty, useDeleteProperty, PropertyInputStatus, PropertyInputType, PropertyUpdateStatus, PropertyUpdateType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams();
  const propertyId = Number(id);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<PropertyUpdateType>("apartment");
  const [totalUnits, setTotalUnits] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [status, setStatus] = useState<PropertyUpdateStatus>("available");
  const [description, setDescription] = useState("");

  const { data: property, isLoading } = useGetProperty(propertyId, {
    query: { queryKey: getGetPropertyQueryKey(propertyId), enabled: !!propertyId }
  });

  const updateMutation = useUpdateProperty();
  const deleteMutation = useDeleteProperty();

  useEffect(() => {
    if (property) {
      setName(property.name);
      setAddress(property.address);
      setType(property.type as PropertyUpdateType);
      setTotalUnits(property.totalUnits.toString());
      setRentAmount(property.rentAmount.toString());
      setStatus(property.status as PropertyUpdateStatus);
      setDescription(property.description || "");
    }
  }, [property]);

  const handleSave = () => {
    if (!name || !address || !totalUnits || !rentAmount) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    updateMutation.mutate(
      {
        id: propertyId,
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
        onSuccess: (data) => {
          queryClient.setQueryData(getGetPropertyQueryKey(propertyId), data);
          queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
          setIsEditing(false);
        },
        onError: () => Alert.alert("Error", "Failed to update property")
      }
    );
  };

  const handleDelete = () => {
    Alert.alert("Delete Property", "Are you sure you want to delete this property? This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteMutation.mutate(
            { id: propertyId },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
                router.back();
              },
              onError: () => Alert.alert("Error", "Failed to delete property")
            }
          );
        }
      }
    ]);
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Property not found.</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Property Details</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!isEditing ? (
            <>
              <TouchableOpacity style={styles.iconButton} onPress={() => setIsEditing(true)}>
                <Feather name="edit-2" size={20} color={colors.foreground} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={handleDelete}>
                <Feather name="trash-2" size={20} color={colors.destructive} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.iconButton} onPress={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Feather name="check" size={24} color={colors.primary} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!isEditing ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Name</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{property.name}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Address</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{property.address}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Type</Text>
              <Text style={[styles.value, { color: colors.cardForeground, textTransform: "capitalize" }]}>{property.type}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Total Units</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>{property.totalUnits}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Rent/mo</Text>
              <Text style={[styles.value, { color: colors.cardForeground }]}>₹{property.rentAmount.toLocaleString("en-IN")}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Status</Text>
              <Text style={[styles.value, { color: colors.cardForeground, textTransform: "capitalize" }]}>{property.status}</Text>
            </View>
            {property.description ? (
              <View style={styles.infoRowColumn}>
                <Text style={[styles.label, { color: colors.mutedForeground, marginBottom: 4 }]}>Description</Text>
                <Text style={[styles.value, { color: colors.cardForeground }]}>{property.description}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Property Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Sunset Apartments"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Address</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Full Address"
              placeholderTextColor={colors.mutedForeground}
            />

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Type</Text>
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
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Total Units</Text>
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
                <Text style={[styles.inputLabel, { color: colors.foreground }]}>Rent Amount (₹)</Text>
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

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Status</Text>
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
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.05)" },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  content: { padding: 16 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)" },
  infoRowColumn: { paddingVertical: 12 },
  label: { fontSize: 14, fontWeight: "500" },
  value: { fontSize: 16, fontWeight: "600" },
  inputLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: { height: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  textArea: { height: 80, paddingTop: 12, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 12 },
  flex1: { flex: 1 },
  segmentedControl: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 8, padding: 4 },
  segmentOption: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
});