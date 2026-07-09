import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { GoogleSignin, isSuccessResponse, isGoogleSignInAvailable } from "@/utils/googleSignin";
import { confirmAction } from "@/utils/confirm";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface SecurityInfo {
  hasPassword: boolean;
  hasGoogle: boolean;
  provider: string;
  email: string;
  name: string;
}

export default function AccountSecurityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Change password fields
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  // Add password fields
  const [addPwd, setAddPwd] = useState("");
  const [confirmAddPwd, setConfirmAddPwd] = useState("");
  const [addingPwd, setAddingPwd] = useState(false);

  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const fetchInfo = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setInfo(data);
    } catch {
      Alert.alert("Error", "Failed to load security information");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { fetchInfo(); }, [fetchInfo]));

  // ─── Change password ──────────────────────────────────────────────────────

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd || !confirmPwd) { Alert.alert("Error", "Please fill in all fields"); return; }
    if (newPwd.length < 6) { Alert.alert("Error", "New password must be at least 6 characters"); return; }
    if (newPwd !== confirmPwd) { Alert.alert("Error", "New passwords do not match"); return; }
    setChangingPwd(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/change-password`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to change password"); return; }
      Alert.alert("Success", "Password changed successfully.");
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch {
      Alert.alert("Error", "Could not change password. Please try again.");
    } finally {
      setChangingPwd(false);
    }
  };

  // ─── Add password (Google-only accounts) ─────────────────────────────────

  const handleAddPassword = async () => {
    if (!addPwd || !confirmAddPwd) { Alert.alert("Error", "Please fill in all fields"); return; }
    if (addPwd.length < 6) { Alert.alert("Error", "Password must be at least 6 characters"); return; }
    if (addPwd !== confirmAddPwd) { Alert.alert("Error", "Passwords do not match"); return; }
    setAddingPwd(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/add-password`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ password: addPwd }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to add password"); return; }
      Alert.alert("Success", "Password added. You can now sign in with email and password.");
      setAddPwd(""); setConfirmAddPwd("");
      await fetchInfo();
    } catch {
      Alert.alert("Error", "Could not add password. Please try again.");
    } finally {
      setAddingPwd(false);
    }
  };

  // ─── Link Google ──────────────────────────────────────────────────────────

  const handleLinkGoogle = async () => {
    if (!isGoogleSignInAvailable) {
      Alert.alert("Not Available", "Google Sign-In requires a development build or production app.");
      return;
    }
    setLinkingGoogle(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return;

      const idToken = response.data.idToken;
      if (!idToken) { Alert.alert("Error", "Could not get Google ID token. Please try again."); return; }

      const res = await fetch(`${BASE_URL}/api/auth/link-google`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to link Google account"); return; }
      Alert.alert("Success", "Google account linked successfully.");
      await fetchInfo();
    } catch (err: unknown) {
      const e = err as { code?: number };
      if (e.code !== -5) Alert.alert("Error", "Google Sign-In failed. Please try again.");
    } finally {
      setLinkingGoogle(false);
    }
  };

  // ─── Unlink Google ────────────────────────────────────────────────────────

  const handleUnlinkGoogle = () => {
    confirmAction(
      "Unlink Google Account",
      "Are you sure? You will only be able to sign in with your email and password after this.",
      async () => {
        setUnlinkingGoogle(true);
        try {
          const res = await fetch(`${BASE_URL}/api/auth/unlink-google`, {
            method: "POST", headers: authHeaders,
          });
          const data = await res.json();
          if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to unlink Google account"); return; }
          Alert.alert("Success", "Google account unlinked.");
          await fetchInfo();
        } catch {
          Alert.alert("Error", "Could not unlink Google account. Please try again.");
        } finally {
          setUnlinkingGoogle(false);
        }
      },
      { confirmText: "Unlink" }
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading || !info) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Security</Text>
        </View>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Security</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>

        {/* ── Linked accounts ──────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LINKED ACCOUNTS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Email/Password row */}
          <View style={[styles.providerRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
            <View style={[styles.providerIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="mail" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.providerLabel, { color: colors.foreground }]}>Email / Password</Text>
              <Text style={[styles.providerSub, { color: colors.mutedForeground }]}>{info.email}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: info.hasPassword ? "#22c55e20" : "#f59e0b20" }]}>
              <Text style={[styles.badgeText, { color: info.hasPassword ? "#22c55e" : "#f59e0b" }]}>
                {info.hasPassword ? "Active" : "Not set"}
              </Text>
            </View>
          </View>

          {/* Google row */}
          <View style={styles.providerRow}>
            <View style={[styles.providerIcon, { backgroundColor: "#4285F420" }]}>
              <Text style={styles.googleG}>G</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.providerLabel, { color: colors.foreground }]}>Google Account</Text>
              <Text style={[styles.providerSub, { color: colors.mutedForeground }]}>
                {info.hasGoogle ? "Linked" : "Not linked"}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: info.hasGoogle ? "#22c55e20" : colors.border + "60" }]}>
              <Text style={[styles.badgeText, { color: info.hasGoogle ? "#22c55e" : colors.mutedForeground }]}>
                {info.hasGoogle ? "Active" : "Not linked"}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Link Google (only if not already linked) ─────────────────── */}
        {!info.hasGoogle && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>LINK GOOGLE ACCOUNT</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Link your Google account so you can sign in with either Google or your email and password.
              </Text>
              <TouchableOpacity
                style={[styles.googleBtn, { borderColor: colors.border, opacity: isGoogleSignInAvailable ? 1 : 0.5 }]}
                onPress={handleLinkGoogle}
                disabled={linkingGoogle || !isGoogleSignInAvailable}
              >
                {linkingGoogle ? (
                  <ActivityIndicator color={colors.foreground} />
                ) : (
                  <>
                    <Text style={styles.googleG}>G</Text>
                    <Text style={[styles.googleBtnText, { color: colors.foreground }]}>
                      {isGoogleSignInAvailable ? "Link Google Account" : "Requires a production build"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Add Password (Google-only accounts) ──────────────────────── */}
        {!info.hasPassword && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>ADD PASSWORD</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Add a password so you can also sign in with your email address.
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="New password (min. 6 characters)"
                placeholderTextColor={colors.mutedForeground}
                value={addPwd}
                onChangeText={setAddPwd}
                secureTextEntry
              />
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Confirm password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmAddPwd}
                onChangeText={setConfirmAddPwd}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={handleAddPassword}
                disabled={addingPwd}
              >
                {addingPwd ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Add Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Change Password (accounts with a password) ────────────────── */}
        {info.hasPassword && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>CHANGE PASSWORD</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Current password"
                placeholderTextColor={colors.mutedForeground}
                value={currentPwd}
                onChangeText={setCurrentPwd}
                secureTextEntry
              />
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="New password (min. 6 characters)"
                placeholderTextColor={colors.mutedForeground}
                value={newPwd}
                onChangeText={setNewPwd}
                secureTextEntry
              />
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={handleChangePassword}
                disabled={changingPwd}
              >
                {changingPwd ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Change Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Unlink Google (only when both methods are active) ─────────── */}
        {info.hasGoogle && info.hasPassword && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>DANGER ZONE</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#ef444430" }]}>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Unlinking Google means you can only sign in with your email and password.
              </Text>
              <TouchableOpacity
                style={[styles.destructiveBtn, { borderColor: "#ef4444" }]}
                onPress={handleUnlinkGoogle}
                disabled={unlinkingGoogle}
              >
                {unlinkingGoogle ? (
                  <ActivityIndicator color="#ef4444" />
                ) : (
                  <>
                    <Text style={styles.googleG}>G</Text>
                    <Text style={[styles.destructiveBtnText]}>Unlink Google Account</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700", flex: 1 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 8, marginTop: 4, paddingHorizontal: 4 },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 4 },
  providerRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  providerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  providerLabel: { fontSize: 14, fontWeight: "600" },
  providerSub: { fontSize: 12, marginTop: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  googleG: { fontSize: 16, fontWeight: "800", color: "#4285F4" },
  hint: { fontSize: 13, lineHeight: 18, padding: 14, paddingBottom: 10 },
  input: { marginHorizontal: 14, marginBottom: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  primaryBtn: { marginHorizontal: 14, marginBottom: 14, paddingVertical: 13, borderRadius: 10, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginHorizontal: 14, marginBottom: 14, paddingVertical: 13, borderRadius: 10, borderWidth: 1 },
  googleBtnText: { fontSize: 15, fontWeight: "600" },
  destructiveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginHorizontal: 14, marginBottom: 14, paddingVertical: 13, borderRadius: 10, borderWidth: 1 },
  destructiveBtnText: { fontSize: 15, fontWeight: "600", color: "#ef4444" },
});
