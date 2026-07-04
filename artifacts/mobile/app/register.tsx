import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, SafeAreaView } from "react-native";
import { useRouter, Link } from "expo-router";
import { useRegister, RegisterInputRole } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RegisterInputRole>("admin");
  const { login: setAuthData } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const registerMutation = useRegister();

  const handleRegister = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    registerMutation.mutate(
      { data: { name: trimmedName, email: trimmedEmail, password, role } },
      {
        onSuccess: async (data) => {
          await setAuthData(data.token, data.user);
          router.replace("/(tabs)");
        },
        onError: (err: unknown) => {
          const data = (err as { data?: { error?: string } })?.data;
          const message = data?.error ?? "Could not create account. Please try again.";
          Alert.alert("Registration Failed", message);
        },
      }
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerContainer}>
          <Feather name="user-plus" size={48} color={colors.accent} />
          <Text style={[styles.title, { color: colors.foreground }]}>Create Account</Text>
        </View>

        <View style={styles.formContainer}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            placeholder="Full Name"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            placeholder="Email Address"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
            placeholder="Password (min. 6 characters)"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <View style={styles.roleContainer}>
            <TouchableOpacity
              style={[styles.roleOption, { borderColor: colors.border }, role === "admin" && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => setRole("admin")}
            >
              <Text style={{ color: role === "admin" ? colors.primaryForeground : colors.mutedForeground }}>Admin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleOption, { borderColor: colors.border }, role === "employee" && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => setRole("employee")}
            >
              <Text style={{ color: role === "employee" ? colors.primaryForeground : colors.mutedForeground }}>Employee</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleRegister}
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Register</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={{ color: colors.mutedForeground }}>Already have an account? </Text>
          <Link href="/login" asChild>
            <TouchableOpacity>
              <Text style={{ color: colors.primary, fontWeight: "600" }}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: 24, justifyContent: "center" },
  headerContainer: { alignItems: "center", marginBottom: 48 },
  title: { fontSize: 32, fontWeight: "bold", marginTop: 16 },
  formContainer: { gap: 16 },
  input: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  roleContainer: { flexDirection: "row", gap: 12 },
  roleOption: { flex: 1, height: 44, borderWidth: 1, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  button: { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 8 },
  buttonText: { fontSize: 16, fontWeight: "bold" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
});
