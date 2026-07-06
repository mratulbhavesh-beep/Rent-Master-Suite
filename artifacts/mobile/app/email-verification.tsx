import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, SafeAreaView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export default function EmailVerificationScreen() {
  const colors = useColors();
  const router = useRouter();
  const { email, mode } = useLocalSearchParams<{ email?: string; mode?: string }>();

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const isLoginBlocked = mode === "blocked";

  const handleResend = async () => {
    if (!email) {
      Alert.alert("Error", "No email address found. Please go back and try again.");
      return;
    }
    setResending(true);
    setResent(false);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (data.alreadyVerified) {
        Alert.alert(
          "Already Verified",
          "Your email is already verified. Please sign in.",
          [{ text: "Sign In", onPress: () => router.replace("/login") }]
        );
        return;
      }

      setResent(true);
    } catch {
      Alert.alert("Network Error", "Could not send the email. Please check your connection and try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: "#1e3a5f15" }]}>
          <Feather name="mail" size={40} color="#1e3a5f" />
        </View>

        {/* Title & body */}
        {isLoginBlocked ? (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Email Not Verified
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Your email address has not been verified.{"\n\n"}
              Please verify your email before signing in.
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Account Created Successfully
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              A verification email has been sent to{" "}
              {email ? (
                <Text style={{ fontWeight: "700", color: colors.foreground }}>{email}</Text>
              ) : (
                "your registered email address"
              )}
              .{"\n\n"}
              Please verify your email before signing in.
            </Text>
          </>
        )}

        {/* Email display */}
        {email ? (
          <View style={[styles.emailPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="mail" size={14} color={colors.mutedForeground} />
            <Text style={[styles.emailText, { color: colors.foreground }]} numberOfLines={1}>
              {email}
            </Text>
          </View>
        ) : null}

        {/* Resent confirmation */}
        {resent && (
          <View style={[styles.resentBanner, { backgroundColor: "#22c55e15", borderColor: "#22c55e40" }]}>
            <Feather name="check-circle" size={14} color="#22c55e" />
            <Text style={[styles.resentText, { color: "#16a34a" }]}>
              Verification email sent! Please check your inbox.
            </Text>
          </View>
        )}

        {/* Resend button */}
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: "#1e3a5f" }]}
          onPress={handleResend}
          disabled={resending}
        >
          {resending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Resend Verification Email</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Back to Login */}
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={() => router.replace("/login")}
        >
          <Feather name="arrow-left" size={16} color={colors.foreground} />
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Back to Login</Text>
        </TouchableOpacity>

        {/* Help text */}
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Check your spam or junk folder if you don't see the email.{"\n"}
          The verification link expires after 24 hours.
        </Text>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 32, justifyContent: "center", alignItems: "center" },
  iconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 28 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 16 },
  body: { fontSize: 15, lineHeight: 24, textAlign: "center", marginBottom: 20 },
  emailPill: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20, maxWidth: "100%" },
  emailText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  resentBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16, width: "100%" },
  resentText: { fontSize: 13, flex: 1 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", paddingVertical: 15, borderRadius: 12, marginBottom: 12 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", paddingVertical: 14, borderRadius: 12, borderWidth: 1, marginBottom: 28 },
  secondaryBtnText: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12, textAlign: "center", lineHeight: 18 },
});
