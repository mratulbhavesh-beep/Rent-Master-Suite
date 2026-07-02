import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useUpdateProfile } from "@workspace/api-client-react";

const AVATAR_STORAGE_KEY = "profile_photo_uri";

function SectionLabel({ label }: { label: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
  );
}

function FieldRow({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  editable = true,
  isLast = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  editable?: boolean;
  isLast?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.fieldRow,
        { borderBottomColor: colors.border },
        isLast && styles.fieldRowLast,
      ]}
    >
      <View style={[styles.fieldIcon, { backgroundColor: `${colors.primary}15` }]}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <View style={styles.fieldContent}>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
        {editable ? (
          <TextInput
            style={[styles.fieldInput, { color: colors.foreground }]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder ?? label}
            placeholderTextColor={colors.mutedForeground}
            keyboardType={keyboardType ?? "default"}
            autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
          />
        ) : (
          <Text style={[styles.fieldValue, { color: colors.foreground }]}>{value || "—"}</Text>
        )}
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  isDestructive = false,
  rightLabel,
  isLast = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress?: () => void;
  isDestructive?: boolean;
  rightLabel?: string;
  isLast?: boolean;
}) {
  const colors = useColors();
  const color = isDestructive ? colors.destructive : colors.foreground;
  const bgColor = isDestructive ? `${colors.destructive}15` : `${colors.primary}15`;
  const iconColor = isDestructive ? colors.destructive : colors.primary;

  return (
    <TouchableOpacity
      style={[
        styles.menuRow,
        { borderBottomColor: colors.border },
        isLast && styles.menuRowLast,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.menuRowLeft}>
        <View style={[styles.menuIcon, { backgroundColor: bgColor }]}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <Text style={[styles.menuLabel, { color }]}>{label}</Text>
      </View>
      {rightLabel ? (
        <Text style={[styles.menuRight, { color: colors.mutedForeground }]}>{rightLabel}</Text>
      ) : (
        !isDestructive && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, updateUser } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState((user as any)?.phone ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [company, setCompany] = useState((user as any)?.company ?? "");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateProfile = useUpdateProfile();

  useEffect(() => {
    AsyncStorage.getItem(AVATAR_STORAGE_KEY).then(uri => {
      if (uri) setAvatarUri(uri);
    });
  }, []);

  const isDirty =
    name !== (user?.name ?? "") ||
    phone !== ((user as any)?.phone ?? "") ||
    email !== (user?.email ?? "") ||
    company !== ((user as any)?.company ?? "");

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to change your profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setAvatarUri(uri);
      await AsyncStorage.setItem(AVATAR_STORAGE_KEY, uri);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Name cannot be empty.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      Alert.alert("Validation", "Please enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile.mutateAsync({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
        },
      });
      await updateUser({
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        company: updated.company,
      } as any);
      Alert.alert("Saved", "Your profile has been updated.");
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Failed to save profile.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  };

  const initials = (name || user?.name || "U")
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const roleLabel = user?.role === "admin" ? "Owner / Admin" : "Employee";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 12,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Profile</Text>
        {isDirty ? (
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.saveBtn} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar Hero */}
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.avatarWrapper} onPress={handlePickAvatar} activeOpacity={0.8}>
            {avatarUri ? (
              <ExpoImage
                source={{ uri: avatarUri }}
                style={styles.avatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                <Text style={[styles.avatarInitials, { color: colors.primaryForeground }]}>
                  {initials}
                </Text>
              </View>
            )}
            <View style={[styles.cameraOverlay, { backgroundColor: colors.primary }]}>
              <Feather name="camera" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.heroName, { color: colors.foreground }]}>{user?.name}</Text>
          <Text style={[styles.heroEmail, { color: colors.mutedForeground }]}>{user?.email}</Text>
          <View style={[styles.rolePill, { backgroundColor: `${colors.accent}20`, borderColor: `${colors.accent}40` }]}>
            <Feather name="shield" size={11} color={colors.accent} />
            <Text style={[styles.rolePillText, { color: colors.accent }]}>{roleLabel}</Text>
          </View>
        </View>

        {/* Personal Info */}
        <SectionLabel label="Personal Information" />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <FieldRow
            icon="user"
            label="Full Name"
            value={name}
            onChangeText={setName}
            placeholder="Enter your full name"
          />
          <FieldRow
            icon="phone"
            label="Mobile Number"
            value={phone}
            onChangeText={setPhone}
            placeholder="Enter mobile number"
            keyboardType="phone-pad"
          />
          <FieldRow
            icon="mail"
            label="Email Address"
            value={email}
            onChangeText={setEmail}
            placeholder="Enter email address"
            keyboardType="email-address"
          />
          <FieldRow
            icon="briefcase"
            label="Company / Business"
            value={company}
            onChangeText={setCompany}
            placeholder="Enter company or business name"
            isLast
          />
        </View>

        {/* Role — read only */}
        <SectionLabel label="Account Role" />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <FieldRow
            icon="shield"
            label="Role"
            value={roleLabel}
            editable={false}
            isLast
          />
        </View>

        {/* Account Section */}
        <SectionLabel label="Account" />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MenuRow
            icon="lock"
            label="Change Password"
            onPress={() => router.push("/change-password")}
            isLast
          />
        </View>

        {/* Logout */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 8 }]}>
          <MenuRow
            icon="log-out"
            label="Logout"
            onPress={handleLogout}
            isDestructive
            isLast
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn: { width: 38, height: 38, justifyContent: "center", alignItems: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700" },
  saveBtn: {
    height: 36,
    minWidth: 72,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  scroll: { padding: 20, gap: 8 },

  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    marginBottom: 8,
    gap: 6,
  },
  avatarWrapper: { marginBottom: 4, position: "relative" },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImage: { width: 88, height: 88, borderRadius: 44 },
  avatarInitials: { fontSize: 34, fontWeight: "800" },
  cameraOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  heroName: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  heroEmail: { fontSize: 14 },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  rolePillText: { fontSize: 12, fontWeight: "700" },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },

  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldRowLast: { borderBottomWidth: 0 },
  fieldIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  fieldContent: { flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  fieldInput: { fontSize: 15, fontWeight: "500", padding: 0 },
  fieldValue: { fontSize: 15, fontWeight: "500" },

  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuRowLast: { borderBottomWidth: 0 },
  menuRowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  menuLabel: { fontSize: 15, fontWeight: "500" },
  menuRight: { fontSize: 14 },
});
