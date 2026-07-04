import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from "react-native";
import { useRouter, Link } from "expo-router";
import { useLogin, useGoogleSignIn } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { GoogleSignin, isSuccessResponse, isGoogleSignInAvailable } from "@/utils/googleSignin";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const { login: setAuthData } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const loginMutation = useLogin();
  const googleSignInMutation = useGoogleSignIn();

  const handleLogin = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    loginMutation.mutate(
      { data: { email: trimmedEmail, password } },
      {
        onSuccess: async (data) => {
          await setAuthData(data.token, data.user);
          router.replace("/(tabs)");
        },
        onError: (err: unknown) => {
          const data = (err as { data?: { error?: string } })?.data;
          const message = data?.error ?? "Invalid email or password. Please try again.";
          Alert.alert("Login Failed", message);
        },
      }
    );
  };

  const handleGoogleSignIn = async () => {
    if (!isGoogleSignInAvailable) {
      Alert.alert(
        "Not Available in Expo Go",
        "Google Sign-In requires a development build. Use your email and password to sign in here.",
      );
      return;
    }
    try {
      setGoogleLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();

      if (!isSuccessResponse(response)) {
        return;
      }

      const idToken = response.data.idToken;
      if (!idToken) {
        Alert.alert("Error", "Could not get Google ID token. Please try again.");
        return;
      }

      googleSignInMutation.mutate(
        { data: { idToken } },
        {
          onSuccess: async (data) => {
            await setAuthData(data.token, data.user);
            router.replace("/(tabs)");
          },
          onError: (err: unknown) => {
            const data = (err as { data?: { error?: string } })?.data;
            const message = data?.error ?? "Google Sign-In failed. Please try again.";
            Alert.alert("Sign-In Failed", message);
          },
        }
      );
    } catch (error: unknown) {
      const e = error as { code?: number };
      if (e.code !== -5) {
        Alert.alert("Error", "Google Sign-In failed. Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const isLoading = loginMutation.isPending || googleLoading || googleSignInMutation.isPending;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerContainer}>
          <Feather name="shield" size={48} color={colors.accent} />
          <Text style={[styles.title, { color: colors.foreground }]}>Gemini Rent</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Manager Portal</Text>
        </View>

        <View style={styles.formContainer}>
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
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign In</Text>
            )}
          </TouchableOpacity>

          <Link href="/forgot-password" asChild>
            <TouchableOpacity style={styles.forgotButton} disabled={isLoading}>
              <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot Password?</Text>
            </TouchableOpacity>
          </Link>

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[
              styles.googleButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: isGoogleSignInAvailable ? 1 : 0.5,
              },
            ]}
            onPress={handleGoogleSignIn}
            disabled={isLoading}
          >
            {googleLoading || googleSignInMutation.isPending ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={[styles.googleButtonText, { color: colors.foreground }]}>
                  {isGoogleSignInAvailable ? "Continue with Google" : "Google Sign-In (Dev Build Only)"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={{ color: colors.mutedForeground }}>Don't have an account? </Text>
          <Link href="/register" asChild>
            <TouchableOpacity>
              <Text style={{ color: colors.primary, fontWeight: "600" }}>Register</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  formContainer: {
    gap: 16,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  forgotButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  forgotText: {
    fontSize: 14,
    fontWeight: "600",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
  },
  googleButton: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4285F4",
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 32,
  },
});
