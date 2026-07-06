import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView,
} from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const colors = useColors();

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setEmailError("Email is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setEmailError("Enter a valid email address"); return; }
    setEmailError("");
    setIsLoading(true);
    try {
      await fetch(`${BASE_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      // Always show success — prevents email enumeration
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        {!sent ? (
          <>
            <View style={styles.headerContainer}>
              <View style={[styles.iconBg, { backgroundColor: `${colors.accent}20` }]}>
                <Feather name="lock" size={36} color={colors.accent} />
              </View>
              <Text style={[styles.title, { color: colors.foreground }]}>Forgot Password?</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Enter your registered email and we'll send you a link to reset your password.
              </Text>
            </View>

            <View style={styles.formContainer}>
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Email Address</Text>
                <View style={[styles.inputWrapper, {
                  backgroundColor: colors.input,
                  borderColor: emailError ? colors.destructive : colors.border,
                }]}>
                  <Feather name="mail" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.mutedForeground}
                    value={email}
                    onChangeText={(v) => { setEmail(v); setEmailError(""); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoFocus
                  />
                </View>
                {emailError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{emailError}</Text> : null}
              </View>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }, isLoading && { opacity: 0.7 }]}
                onPress={handleSend}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Send Reset Link</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.backToLogin} onPress={() => router.replace("/login")}>
                <Feather name="arrow-left" size={14} color={colors.primary} />
                <Text style={[styles.backToLoginText, { color: colors.primary }]}>Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.sentContainer}>
            <View style={[styles.iconBg, { backgroundColor: "#22c55e20" }]}>
              <Feather name="mail" size={36} color="#22c55e" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Check Your Email</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              If an account exists for{" "}
              <Text style={{ fontWeight: "700", color: colors.foreground }}>{email.trim().toLowerCase()}</Text>
              {", "}a password reset link has been sent.{"\n\n"}
              Click the link in the email to choose a new password, then return here to sign in.
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Check your spam or junk folder if you don't see it.{"\n"}
              The link expires in 1 hour.
            </Text>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary, marginTop: 8 }]}
              onPress={() => router.replace("/login")}
            >
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Back to Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.resendBtn, { borderColor: colors.border }]}
              onPress={() => setSent(false)}
            >
              <Text style={[styles.resendText, { color: colors.mutedForeground }]}>Didn't get it? Try again</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24 },
  backButton: { width: 40, height: 40, justifyContent: "center", marginBottom: 24 },
  headerContainer: { alignItems: "center", marginBottom: 40 },
  sentContainer: { flex: 1, alignItems: "center", paddingTop: 20 },
  iconBg: { width: 80, height: 80, borderRadius: 40, justifyContent: "center", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 10, textAlign: "center" },
  subtitle: { fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 20 },
  hint: { fontSize: 12, textAlign: "center", lineHeight: 18, marginBottom: 32 },
  formContainer: { gap: 20 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  inputWrapper: { flexDirection: "row", alignItems: "center", height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16 },
  errorText: { fontSize: 12, marginTop: 4 },
  button: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", width: "100%" },
  buttonText: { fontSize: 16, fontWeight: "bold" },
  resendBtn: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, borderWidth: 1 },
  resendText: { fontSize: 14 },
  backToLogin: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  backToLoginText: { fontSize: 14, fontWeight: "600" },
});
