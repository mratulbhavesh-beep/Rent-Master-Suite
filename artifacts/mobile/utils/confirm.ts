import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirmation dialogs.
 *
 * `Alert.alert` with multiple buttons does not reliably work on web (Expo's
 * web build of `react-native-web` renders nothing / never invokes the
 * button callbacks for multi-button alerts), which made destructive actions
 * across the app (Delete Payment, Delete Tenant, Restore Backup, etc.)
 * appear completely unresponsive when opened in a browser preview. On
 * native (iOS/Android) `Alert.alert` works fine and is used as-is; on web
 * we fall back to `window.confirm`, which only supports a single OK/Cancel
 * choice, so multi-action dialogs are resolved by asking sequentially.
 */

export type ConfirmButton = {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

/**
 * Show a native-style alert/confirm with an arbitrary set of buttons.
 * Business logic in each button's `onPress` is never altered — only the
 * dialog presentation differs by platform.
 */
export function showConfirm(title: string, message: string, buttons: ConfirmButton[]): void {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons as any);
    return;
  }

  if (typeof window === "undefined" || typeof window.confirm !== "function") return;

  const actionable = buttons.filter(b => b.style !== "cancel");

  if (actionable.length <= 1) {
    const action = actionable[0];
    if (window.confirm(`${title}\n\n${message}`)) action?.onPress?.();
    return;
  }

  // More than one non-cancel action: window.confirm only supports a single
  // OK/Cancel choice, so offer each option in turn.
  for (const btn of actionable) {
    const ok = window.confirm(
      `${title}\n\n${message}\n\nPress OK to "${btn.text}", or Cancel to see other options.`
    );
    if (ok) {
      btn.onPress?.();
      return;
    }
  }
}

/**
 * Convenience wrapper for the common Cancel / Confirm (usually destructive)
 * two-button pattern used by most delete/confirm flows.
 */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { confirmText?: string; cancelText?: string; destructive?: boolean }
): void {
  showConfirm(title, message, [
    { text: options?.cancelText ?? "Cancel", style: "cancel" },
    {
      text: options?.confirmText ?? "Delete",
      style: options?.destructive === false ? "default" : "destructive",
      onPress: onConfirm,
    },
  ]);
}
