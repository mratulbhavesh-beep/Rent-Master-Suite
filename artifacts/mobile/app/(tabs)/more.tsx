import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const MenuItem = ({ title, icon, iconFamily = "Feather", onPress, color = colors.foreground, isDestructive = false }: any) => (
    <TouchableOpacity 
      style={[styles.menuItem, { borderBottomColor: colors.border }]} 
      onPress={onPress}
    >
      <View style={styles.menuItemLeft}>
        <View style={[styles.iconContainer, { backgroundColor: isDestructive ? `${colors.destructive}15` : colors.secondary }]}>
          {iconFamily === "MaterialIcons" ? (
            <MaterialIcons name={icon} size={20} color={isDestructive ? colors.destructive : color} />
          ) : (
            <Feather name={icon} size={20} color={isDestructive ? colors.destructive : color} />
          )}
        </View>
        <Text style={[styles.menuItemText, { color: isDestructive ? colors.destructive : color }]}>{title}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>More</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontSize: 24, fontWeight: "bold" }}>
              {user?.name?.charAt(0).toUpperCase() || "U"}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>{user?.name}</Text>
            <Text style={[styles.profileEmail, { color: colors.mutedForeground }]}>{user?.email}</Text>
            <View style={[styles.roleBadge, { backgroundColor: `${colors.accent}20` }]}>
              <Text style={[styles.roleText, { color: colors.accent }]}>{user?.role.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Finance</Text>
          <MenuItem 
            title="Payments" 
            icon="credit-card" 
            onPress={() => router.push("/payments")} 
          />
          <MenuItem 
            title="Expenses" 
            icon="receipt" 
            onPress={() => router.push("/expenses")} 
          />
          <MenuItem 
            title="Loans & EMIs" 
            icon="dollar-sign" 
            onPress={() => router.push("/loans")} 
          />
          <MenuItem 
            title="Reports" 
            icon="bar-chart-2" 
            onPress={() => router.push("/reports")} 
          />
        </View>

        <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Operations</Text>
          <MenuItem 
            title="Maintenance Requests" 
            icon="tool" 
            onPress={() => router.push("/maintenance")} 
          />
        </View>

        <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MenuItem 
            title="Logout" 
            icon="log-out" 
            onPress={handleLogout} 
            isDestructive={true}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: "bold" },
  scrollContent: { padding: 20, paddingBottom: 100, gap: 24 },
  profileCard: { flexDirection: "row", padding: 20, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32, justifyContent: "center", alignItems: "center" },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  profileEmail: { fontSize: 14, marginBottom: 8 },
  roleBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  roleText: { fontSize: 10, fontWeight: "bold" },
  menuSection: { borderRadius: 16, borderWidth: 1, overflow: "hidden", paddingVertical: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  menuItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  menuItemLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconContainer: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  menuItemText: { fontSize: 16, fontWeight: "500" },
});