import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useChangePassword } from "@workspace/api-client-react";

function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  isLast = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  isLast?: boolean;
}) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);

  return (
    <View
      style={[
        styles.fieldRow,
        { borderBottomColor: colors.border },
        isLast && { borderBottomWidth: 0 },
      ]}
    >
      <View style={[styles.fieldIcon, { backgroundColor: `${colors.primary}15` }]}>
        <Feather name="lock" size={16} color={colors.primary} />
      </View>
      <View style={styles.fieldContent}>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <TextInput
          style={[styles.fieldInput, { color: colors.foreground }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <TouchableOpacity onPress={() => setVisible(v => !v)} style={styles.eyeBtn}>
        <Feather name={visible ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

export default function ChangePasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const changePassword = useChangePassword();

  const handleSave = async () => {
    if (!current) {
      Alert.alert("Validation", "Please enter your current password.");
      return;
    }
    if (next.length < 6) {
      Alert.alert("Validation", "New password must be at least 6 characters.");
      return;
    }
    if (next !== confirm) {
      Alert.alert("Validation", "New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await changePassword.mutateAsync({
        data: { currentPassword: current, newPassword: next },
      });
      Alert.alert("Success", res.message ?? "Password changed successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Failed to change password.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Change Password</Text>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? colors.muted : colors.primary }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.saveBtnText}>Update</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}25` }]}>
          <Feather name="info" size={16} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            Your new password must be at least 6 characters long.
          </Text>
        </View>

        {/* Fields */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <PasswordField
            label="Current Password"
            value={current}
            onChangeText={setCurrent}
            placeholder="Enter current password"
          />
          <PasswordField
            label="New Password"
            value={next}
            onChangeText={setNext}
            placeholder="Enter new password"
          />
          <PasswordField
            label="Confirm New Password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter new password"
            isLast
          />
        </View>

        {/* Strength hint */}
        {next.length > 0 && (
          <View style={styles.strengthRow}>
            <Text style={[styles.strengthLabel, { color: colors.mutedForeground }]}>Strength:</Text>
            <View style={styles.strengthBars}>
              {[1, 2, 3, 4].map(i => {
                const score =
                  (next.length >= 6 ? 1 : 0) +
                  (/[A-Z]/.test(next) ? 1 : 0) +
                  (/[0-9]/.test(next) ? 1 : 0) +
                  (/[^A-Za-z0-9]/.test(next) ? 1 : 0);
                const filled = i <= score;
                const barColor =
                  score <= 1
                    ? colors.destructive
                    : score === 2
                    ? colors.warning
                    : score === 3
                    ? colors.accent
                    : colors.success;
                return (
                  <View
                    key={i}
                    style={[
                      styles.strengthBar,
                      { backgroundColor: filled ? barColor : colors.border },
                    ]}
                  />
                );
              })}
            </View>
            <Text style={[styles.strengthHint, { color: colors.mutedForeground }]}>
              {next.length < 6
                ? "Too short"
                : (/[A-Z]/.test(next) ? 1 : 0) + (/[0-9]/.test(next) ? 1 : 0) + (/[^A-Za-z0-9]/.test(next) ? 1 : 0) >= 2
                ? "Strong"
                : "Add uppercase, numbers, or symbols"}
            </Text>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>
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
    minWidth: 80,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  scroll: { padding: 20, gap: 16 },

  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },

  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },

  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  fieldContent: { flex: 1 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldInput: { fontSize: 15, fontWeight: "500", padding: 0 },
  eyeBtn: { padding: 4 },

  strengthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  strengthLabel: { fontSize: 12, fontWeight: "600" },
  strengthBars: { flexDirection: "row", gap: 4 },
  strengthBar: { width: 28, height: 5, borderRadius: 3 },
  strengthHint: { flex: 1, fontSize: 12 },
});
