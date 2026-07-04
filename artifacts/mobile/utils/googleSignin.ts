/**
 * Safe wrapper around @react-native-google-signin/google-signin.
 *
 * The native module crashes Expo Go at import time because
 * TurboModuleRegistry.getEnforcing throws when the binary doesn't include
 * RNGoogleSignin. We load it inside a try/catch and fall back to a no-op mock
 * so the rest of the app keeps running in Expo Go.
 *
 * In an EAS Development Build or production build the real native module is
 * used and Google Sign-In works normally.
 */

export type GoogleSignInResponse =
  | { type: "success"; data: { idToken: string | null } }
  | { type: "cancelled" }
  | { type: "noPlayServices" };

interface GoogleSigninInterface {
  configure: (options: { webClientId: string }) => void;
  hasPlayServices: (options?: { showPlayServicesUpdateDialog?: boolean }) => Promise<boolean>;
  signIn: () => Promise<GoogleSignInResponse>;
  signOut: () => Promise<void>;
  getCurrentUser: () => Promise<unknown>;
}

const mockGoogleSignin: GoogleSigninInterface = {
  configure: () => {},
  hasPlayServices: async () => true,
  signIn: async () => ({ type: "cancelled" as const }),
  signOut: async () => {},
  getCurrentUser: async () => null,
};

const mockIsSuccessResponse = (response: { type: string }): response is { type: "success"; data: { idToken: string | null } } =>
  response.type === "success";

let _GoogleSignin: GoogleSigninInterface = mockGoogleSignin;
let _isSuccessResponse: typeof mockIsSuccessResponse = mockIsSuccessResponse;
let _isAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@react-native-google-signin/google-signin") as {
    GoogleSignin: GoogleSigninInterface;
    isSuccessResponse: typeof mockIsSuccessResponse;
  };
  _GoogleSignin = mod.GoogleSignin;
  _isSuccessResponse = mod.isSuccessResponse;
  _isAvailable = true;
} catch {
  // Running in Expo Go — native module not present; mock is already set above.
}

export const GoogleSignin = _GoogleSignin;
export const isSuccessResponse = _isSuccessResponse;
/** True in EAS Dev / production builds; false in Expo Go. */
export const isGoogleSignInAvailable = _isAvailable;
