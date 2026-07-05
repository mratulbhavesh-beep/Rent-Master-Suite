import { Linking, Share, Alert } from "react-native";

/**
 * Normalises a phone number to international format expected by WhatsApp.
 * Handles Indian numbers (10-digit), numbers with leading 0, and already
 * internationalised numbers (with or without the leading +).
 */
export function formatPhoneForWhatsApp(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  return digits;
}

/** Checks whether WhatsApp is installed (Android / iOS). */
export async function isWhatsAppInstalled(): Promise<boolean> {
  try {
    return await Linking.canOpenURL("whatsapp://send?phone=1");
  } catch {
    return false;
  }
}

export type ShareResult = "whatsapp" | "share_sheet" | "cancelled";

/**
 * Opens WhatsApp with the tenant's phone number and a pre-filled message.
 *
 * Returns:
 *  "whatsapp"    — WhatsApp was opened (user still needs to press Send inside WhatsApp)
 *  "share_sheet" — WhatsApp was not installed; user chose the system share sheet
 *  "cancelled"   — WhatsApp not installed and user dismissed the fallback
 */
export async function shareViaWhatsApp(
  phone: string,
  message: string
): Promise<ShareResult> {
  const formattedPhone = formatPhoneForWhatsApp(phone);
  const encodedMessage = encodeURIComponent(message);

  const appUrl = `whatsapp://send?phone=${formattedPhone}&text=${encodedMessage}`;
  const webUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedMessage}`;

  // 1. Try the native WhatsApp app first
  const appInstalled = await isWhatsAppInstalled();
  if (appInstalled) {
    try {
      await Linking.openURL(appUrl);
      return "whatsapp";
    } catch {
      // fall through
    }
  }

  // 2. Try the WhatsApp web deep-link (opens in browser / WhatsApp Web)
  try {
    const webSupported = await Linking.canOpenURL(webUrl);
    if (webSupported) {
      await Linking.openURL(webUrl);
      return "whatsapp";
    }
  } catch {
    // fall through
  }

  // 3. WhatsApp unavailable — offer the Android/iOS Share Sheet as fallback
  return new Promise<ShareResult>((resolve) => {
    Alert.alert(
      "WhatsApp Not Installed",
      "WhatsApp is not installed on this device. Would you like to share the message using another app?",
      [
        {
          text: "Share via Another App",
          onPress: async () => {
            try {
              const result = await Share.share({ message });
              resolve(result.action === "sharedAction" ? "share_sheet" : "cancelled");
            } catch {
              resolve("cancelled");
            }
          },
        },
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => resolve("cancelled"),
        },
      ],
      { cancelable: false }
    );
  });
}

/**
 * Interpolates {{variable}} placeholders in a template body.
 * Unknown placeholders are left as-is.
 */
export function interpolateTemplate(
  body: string,
  vars: Record<string, string | number>
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}
