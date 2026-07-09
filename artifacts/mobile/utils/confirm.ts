import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirmation dialog.
 *
 * `Alert.alert` with multiple buttons does not reliably work on web (Expo's
 * web build of `react-native-web` renders nothing / never invokes the
 * button callbacks for multi-button alerts), which made destructive actions
 * like "Delete Payment" appear completely unresponsive when the app is
 * opened in a browser preview. On native (iOS/Android) `Alert.alert` works
 * fine and is used as-is; on web we fall back to `window.confirm`.
 */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { confirmText?: string; cancelText?: string; destructive?: boolean }
): void {
  if (Platform.OS === "web") {
    const confirmed = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
    if (confirmed) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: options?.cancelText ?? "Cancel", style: "cancel" },
    {
      text: options?.confirmText ?? "Delete",
      style: options?.destructive === false ? "default" : "destructive",
      onPress: onConfirm,
    },
  ]);
}
