import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const PUSH_TOKEN_KEY = "expo_push_token";

// Configure how notifications appear when the app is in foreground
// Expo SDK 54: shouldShowBanner + shouldShowList replace shouldShowAlert
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function getExpoPushToken(): Promise<string | null> {
  // Push tokens only work on real devices, not simulators
  if (!Device.isDevice) return null;

  type PermStatus = { granted: boolean; canAskAgain: boolean };
  const existing = (await Notifications.getPermissionsAsync()) as unknown as PermStatus;
  let hasPermission = existing.granted;

  if (!hasPermission && existing.canAskAgain) {
    const requested = (await Notifications.requestPermissionsAsync()) as unknown as PermStatus;
    hasPermission = requested.granted;
  }

  if (!hasPermission) return null;

  // Android requires a notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Rent Manager",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1e3a5f",
      enableVibrate: true,
    });
  }

  const projectId =
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    (Constants.easConfig?.projectId as string | undefined) ??
    "72f5326b-e8a6-459a-9e0d-dc5f2387e3c3";

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenData.data;
}

async function postToken(token: string, authToken: string): Promise<void> {
  await fetch(`${BASE_URL}/api/push-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      token,
      deviceId: (Device.osInternalBuildId ?? Device.modelId) || undefined,
      platform: Platform.OS,
    }),
  });
}

/** Register this device's push token with the backend after login. */
export async function registerPushToken(authToken: string): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (!token) return;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await postToken(token, authToken);
  } catch (err) {
    console.warn("[Push] Registration failed:", err);
  }
}

/** Remove this device's push token from the backend on logout. */
export async function unregisterPushToken(authToken: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!token) return;
    await fetch(`${BASE_URL}/api/push-tokens`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token }),
    });
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch (err) {
    console.warn("[Push] Unregistration failed:", err);
  }
}

/**
 * Listen for token rotations and update the backend automatically.
 * Returns a cleanup function — call it on logout or unmount.
 */
export function setupPushTokenRefresh(authToken: string): () => void {
  const sub = Notifications.addPushTokenListener(async ({ data: token }) => {
    if (!token) return;
    try {
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
      await postToken(token, authToken);
    } catch {}
  });
  return () => sub.remove();
}
