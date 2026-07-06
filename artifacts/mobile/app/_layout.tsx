import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";

SplashScreen.preventAutoHideAsync();

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
setAuthTokenGetter(async () => {
  return await AsyncStorage.getItem("auth_token");
});

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Auth guard
  useEffect(() => {
    if (isLoading) return;
    const inProtectedGroup = segments[0] === "(tabs)";
    if (!isAuthenticated && inProtectedGroup) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, segments]);

  // Push notification tap handler — opens the correct Tenant Details screen
  useEffect(() => {
    function navigateToTenant(data: Record<string, unknown>) {
      const tenantId = data?.tenantId;
      if (tenantId != null) {
        router.push(`/tenant-detail?id=${tenantId}` as Parameters<typeof router.push>[0]);
      }
    }

    // Foreground / background tap
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      navigateToTenant(data);
    });

    // Cold-start tap (app was killed)
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as Record<string, unknown>;
        navigateToTenant(data);
      })
      .catch(() => {});

    return () => subscription.remove();
  }, [router]);

  return (
    <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="property-detail" />
      <Stack.Screen name="property-add" />
      <Stack.Screen name="tenant-detail" />
      <Stack.Screen name="tenant-add" />
      <Stack.Screen name="payment-add" />
      <Stack.Screen name="payment-receipt" />
      <Stack.Screen name="expenses" />
      <Stack.Screen name="loans" />
      <Stack.Screen name="loan-detail" />
      <Stack.Screen name="maintenance" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="payments" />
      <Stack.Screen name="rent-ledger-detail" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="account-security" />
      <Stack.Screen name="email-verification" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="notification-settings" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AuthProvider>
                  <RootLayoutNav />
                </AuthProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
