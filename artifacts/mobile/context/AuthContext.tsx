import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { User } from "@workspace/api-client-react";
import { GoogleSignin } from "@/utils/googleSignin";
import { registerPushToken, unregisterPushToken, setupPushTokenRefresh } from "@/utils/pushNotifications";

const GOOGLE_WEB_CLIENT_ID = "910455573442-ni8hs248tapqpnimin4il8grhg38f645.apps.googleusercontent.com";

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
});

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const pushCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    async function loadAuth() {
      try {
        const storedToken = await AsyncStorage.getItem("auth_token");
        const storedUser = await AsyncStorage.getItem("auth_user");
        if (storedToken && storedUser) {
          try {
            const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
            const response = await fetch(`${baseUrl}/api/auth/me`, {
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            if (response.status === 401) {
              await AsyncStorage.removeItem("auth_token");
              await AsyncStorage.removeItem("auth_user");
            } else {
              setToken(storedToken);
              setUser(JSON.parse(storedUser));
              // Re-register push token on app restart (token may have rotated)
              void registerPushToken(storedToken).catch(() => {});
              pushCleanupRef.current = setupPushTokenRefresh(storedToken);
            }
          } catch {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
          }
        }
      } catch (e) {
        console.error("Failed to load auth state", e);
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();

    return () => {
      pushCleanupRef.current?.();
    };
  }, []);

  const login = async (newToken: string, newUser: User) => {
    try {
      await AsyncStorage.setItem("auth_token", newToken);
      await AsyncStorage.setItem("auth_user", JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      // Register device for push notifications (non-blocking)
      void registerPushToken(newToken).catch(() => {});
      pushCleanupRef.current?.();
      pushCleanupRef.current = setupPushTokenRefresh(newToken);
    } catch (e) {
      console.error("Failed to save auth state", e);
    }
  };

  const logout = async () => {
    try {
      // Unregister push token before clearing auth
      if (token) {
        await unregisterPushToken(token).catch(() => {});
      }
      pushCleanupRef.current?.();
      pushCleanupRef.current = null;

      await AsyncStorage.removeItem("auth_token");
      await AsyncStorage.removeItem("auth_user");
      queryClient.clear();
      setToken(null);
      setUser(null);
      try {
        const currentUser = await GoogleSignin.getCurrentUser();
        if (currentUser) {
          await GoogleSignin.signOut();
        }
      } catch {
        // Google sign-out failure is non-critical
      }
    } catch (e) {
      console.error("Failed to clear auth state", e);
    }
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...updates } as User;
    try {
      await AsyncStorage.setItem("auth_user", JSON.stringify(updated));
      setUser(updated);
    } catch (e) {
      console.error("Failed to update user state", e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        updateUser,
        isLoading,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
