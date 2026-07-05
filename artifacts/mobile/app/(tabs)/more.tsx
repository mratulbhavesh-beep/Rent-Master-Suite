import React, { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
  Animated,
  Pressable,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useTheme, type ThemePreference } from "@/context/ThemeContext";

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { themePreference, setThemePreference } = useTheme();
  const [themeSheetVisible, setThemeSheetVisible] = useState(false);

  const slideAnim = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const openThemeSheet = () => {
    setThemeSheetVisible(true);
  };

  useEffect(() => {
    if (themeSheetVisible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 20,
          stiffness: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideAnim.setValue(300);
      backdropAnim.setValue(0);
    }
  }, [themeSheetVisible]);

  const closeThemeSheet = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setThemeSheetVisible(false));
  };

  const handleThemeSelect = async (preference: ThemePreference) => {
    await setThemePreference(preference);
    closeThemeSheet();
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const themeLabel = (pref: ThemePreference) => {
    if (pref === "light") return "Light";
    if (pref === "dark") return "Dark";
    return "System Default";
  };

  const MenuItem = ({
    title,
    icon,
    iconFamily = "Feather",
    onPress,
    color = colors.foreground,
    isDestructive = false,
    rightElement,
  }: {
    title: string;
    icon: string;
    iconFamily?: string;
    onPress: () => void;
    color?: string;
    isDestructive?: boolean;
    rightElement?: React.ReactNode;
  }) => (
    <TouchableOpacity
      style={[styles.menuItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
    >
      <View style={styles.menuItemLeft}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: isDestructive ? `${colors.destructive}15` : colors.secondary },
          ]}
        >
          {iconFamily === "MaterialIcons" ? (
            <MaterialIcons
              name={icon as any}
              size={20}
              color={isDestructive ? colors.destructive : color}
            />
          ) : (
            <Feather
              name={icon as any}
              size={20}
              color={isDestructive ? colors.destructive : color}
            />
          )}
        </View>
        <Text
          style={[
            styles.menuItemText,
            { color: isDestructive ? colors.destructive : color },
          ]}
        >
          {title}
        </Text>
      </View>
      {rightElement ?? (
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      )}
    </TouchableOpacity>
  );

  const themeOptions: { label: string; icon: string; value: ThemePreference; emoji: string }[] = [
    { label: "Light", icon: "sun", value: "light", emoji: "☀️" },
    { label: "Dark", icon: "moon", value: "dark", emoji: "🌙" },
    { label: "System Default", icon: "smartphone", value: "system", emoji: "📱" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>More</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/profile")}
          activeOpacity={0.75}
        >
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
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>

        <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Account</Text>
          <MenuItem
            title="My Profile"
            icon="user"
            onPress={() => router.push("/profile")}
          />
          <MenuItem
            title="Theme"
            icon="sun"
            onPress={openThemeSheet}
            rightElement={
              <View style={styles.themeRightElement}>
                <Text style={[styles.themeCurrentLabel, { color: colors.mutedForeground }]}>
                  {themeLabel(themePreference)}
                </Text>
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
              </View>
            }
          />
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
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Business Settings</Text>
          <MenuItem
            title="Billing Settings"
            icon="calendar"
            onPress={() => router.push("/business-settings-billing" as any)}
          />
          <MenuItem
            title="WhatsApp Reminders"
            icon="message-circle"
            onPress={() => router.push("/reminders" as any)}
          />
          <MenuItem
            title="Activity Log"
            icon="activity"
            onPress={() => router.push("/activity-log" as any)}
          />
          <MenuItem
            title="Backup & Restore"
            icon="database"
            onPress={() => router.push("/backup")}
          />
        </View>

        <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>App & Support</Text>
          <MenuItem
            title="About App"
            icon="info"
            onPress={() =>
              Alert.alert(
                "Gemini Rent Manager",
                "Version 1.0.0\n\nA complete property management solution for landlords and property managers."
              )
            }
          />
          <MenuItem title="App Version" icon="tag" onPress={() => {}} />
          <MenuItem
            title="Privacy Policy"
            icon="shield"
            onPress={() => Alert.alert("Privacy Policy", "Privacy policy will be available soon.")}
          />
          <MenuItem
            title="Terms & Conditions"
            icon="file-text"
            onPress={() =>
              Alert.alert("Terms & Conditions", "Terms & Conditions will be available soon.")
            }
          />
          <MenuItem
            title="Help & Support"
            icon="help-circle"
            onPress={() =>
              Linking.openURL("mailto:support@geminirm.app").catch(() =>
                Alert.alert("Support", "Contact support at support@geminirm.app")
              )
            }
          />
        </View>

        <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MenuItem title="Logout" icon="log-out" onPress={handleLogout} isDestructive={true} />
        </View>
      </ScrollView>

      {/* Theme Picker Bottom Sheet */}
      <Modal
        visible={themeSheetVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeThemeSheet}
      >
        <View style={styles.modalRoot}>
          <Animated.View
            style={[styles.backdrop, { opacity: backdropAnim }]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeThemeSheet} />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 24),
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            {/* Handle bar */}
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Choose Theme</Text>
            <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
              Select how the app looks on your device
            </Text>

            <View style={styles.optionList}>
              {themeOptions.map((opt) => {
                const isSelected = themePreference === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: isSelected
                          ? `${colors.primary}15`
                          : colors.muted,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => handleThemeSelect(opt.value)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.optionLeft}>
                      <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                      <View>
                        <Text
                          style={[
                            styles.optionLabel,
                            { color: isSelected ? colors.primary : colors.foreground },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        {opt.value === "system" && (
                          <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>
                            Follows your device setting
                          </Text>
                        )}
                        {opt.value === "light" && (
                          <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>
                            Always use light theme
                          </Text>
                        )}
                        {opt.value === "dark" && (
                          <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>
                            Always use dark theme
                          </Text>
                        )}
                      </View>
                    </View>
                    {isSelected ? (
                      <View
                        style={[styles.checkCircle, { backgroundColor: colors.primary }]}
                      >
                        <Feather name="check" size={14} color="#FFFFFF" />
                      </View>
                    ) : (
                      <View
                        style={[styles.emptyCircle, { borderColor: colors.border }]}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: "bold" },
  scrollContent: { padding: 20, paddingBottom: 100, gap: 24 },
  profileCard: {
    flexDirection: "row",
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  profileEmail: { fontSize: 14, marginBottom: 8 },
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roleText: { fontSize: 10, fontWeight: "bold" },
  menuSection: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuItemLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  menuItemText: { fontSize: 16, fontWeight: "500" },
  themeRightElement: { flexDirection: "row", alignItems: "center", gap: 6 },
  themeCurrentLabel: { fontSize: 14 },

  // Modal / Bottom Sheet
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    ...Platform.select({
      android: { elevation: 24 },
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
    }),
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  optionList: { gap: 12, paddingBottom: 8 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  optionLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  optionEmoji: { fontSize: 28 },
  optionLabel: { fontSize: 16, fontWeight: "600" },
  optionDescription: { fontSize: 13, marginTop: 2 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
  },
});
