import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import {
  StorageAccessFramework,
  readAsStringAsync as fsReadAsStringAsync,
} from "expo-file-system/legacy";
import { useColors } from "@/hooks/useColors";
import { fmtDate } from "@/utils/dateFormat";
import {
  useListBackups,
  useCreateBackup,
  useRestoreBackup,
  useDeleteBackup,
  BackupMeta,
  getListBackupsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await AsyncStorage.getItem("auth_token");
  const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Types
// ─────────────────────────────────────────────────────────────────────────────

type Schedule = "off" | "daily" | "weekly" | "monthly";

type DriveStatus = {
  connected: boolean;
  email?: string;
  autoBackupEnabled?: boolean;
  lastBackupAt?: string | null;
  lastBackupStatus?: string;
  lastBackupError?: string | null;
  connectedAt?: string;
  hasDriveFile?: boolean;
};

const SCHEDULE_KEY = "backup_schedule";
const LAST_AUTO_BACKUP_KEY = "last_auto_backup_ts";
const SAF_EXPORT_DIR_KEY = "grm_export_saf_dir_uri";
const GRM_MAGIC = "GeminiRentManager";
const GRM_FORMAT_VERSION = "1.0";

const SCHEDULE_OPTIONS: { value: Schedule; label: string; desc: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: "off",     label: "Off",     desc: "No automatic backups",  icon: "x-circle" },
  { value: "daily",   label: "Daily",   desc: "Every 24 hours",        icon: "sunrise" },
  { value: "weekly",  label: "Weekly",  desc: "Every 7 days",          icon: "calendar" },
  { value: "monthly", label: "Monthly", desc: "Every 30 days",         icon: "archive" },
];

const SCHEDULE_INTERVAL_MS: Record<Schedule, number> = {
  off:     Infinity,
  daily:   24 * 60 * 60 * 1000,
  weekly:  7  * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

// ─────────────────────────────────────────────────────────────────────────────
// GRM File Encoding / Decoding
// The .grm format is a proprietary envelope that prevents casual inspection
// or modification. A checksum guards against tampering — any modification
// causes the import to reject the file.
// ─────────────────────────────────────────────────────────────────────────────

function grmChecksum(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function encodeGRMFile(data: object, label: string): string {
  const payload = JSON.stringify(data);
  const checksum = grmChecksum(payload);
  const envelope = JSON.stringify({
    grm: GRM_MAGIC,
    fmtVersion: GRM_FORMAT_VERSION,
    app: "com.geminirent.manager",
    exported: new Date().toISOString(),
    label,
    checksum,
    payload: payload.split("").reverse().join(""),
  });
  return JSON.stringify({
    __grm__: true,
    format: GRM_MAGIC,
    v: GRM_FORMAT_VERSION,
    content: envelope,
  }, null, 2);
}

function decodeGRMFile(content: string): { data: object; label: string } | null {
  try {
    const wrapper = JSON.parse(content);
    if (!wrapper.__grm__ || wrapper.format !== GRM_MAGIC) return null;
    const envelope = JSON.parse(wrapper.content);
    if (envelope.grm !== GRM_MAGIC) return null;
    const payload = (envelope.payload as string).split("").reverse().join("");
    if (grmChecksum(payload) !== envelope.checksum) return null;
    return { data: JSON.parse(payload), label: envelope.label || "Imported Backup" };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return fmtDate(iso);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function formatDateFull(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function computeNextBackup(lastTs: number, schedule: Schedule): Date | null {
  if (schedule === "off") return null;
  return new Date(lastTs + SCHEDULE_INTERVAL_MS[schedule]);
}

function grmFileName(label: string): string {
  return `${label}.grm`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAF: Get (or request) access to Downloads/Gemini Rent Manager/
// Caches the granted directory URI so the permission picker only shows once.
// ─────────────────────────────────────────────────────────────────────────────

async function getOrRequestExportDir(): Promise<string> {
  const cached = await AsyncStorage.getItem(SAF_EXPORT_DIR_KEY);
  if (cached) return cached;

  const downloadsUri = StorageAccessFramework.getUriForDirectoryInRoot("Download");
  const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(downloadsUri);
  if (!perm.granted) throw new Error("permission_denied");

  let dirUri: string;
  try {
    dirUri = await StorageAccessFramework.makeDirectoryAsync(
      perm.directoryUri,
      "Gemini Rent Manager"
    );
  } catch {
    dirUri = perm.directoryUri;
  }

  await AsyncStorage.setItem(SAF_EXPORT_DIR_KEY, dirUri);
  return dirUri;
}

async function openDownloadsFolder() {
  const uris = [
    "content://com.android.externalstorage.documents/document/primary%3ADownload%2FGemini%20Rent%20Manager",
    "content://com.android.externalstorage.documents/tree/primary%3ADownload",
  ];
  for (const uri of uris) {
    try {
      const can = await Linking.canOpenURL(uri);
      if (can) { await Linking.openURL(uri); return; }
    } catch {}
  }
  Alert.alert("File Location", "Find your backup at:\nFiles → Downloads → Gemini Rent Manager");
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function BackupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [schedule, setSchedule] = useState<Schedule>("off");
  const [lastAutoTs, setLastAutoTs] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveBacking, setDriveBacking] = useState(false);
  const [driveRestoring, setDriveRestoring] = useState(false);
  const [drivePollingState, setDrivePollingState] = useState<string | null>(null);

  const loadDriveStatus = useCallback(async () => {
    try {
      const s = await apiFetch<DriveStatus>("/api/gdrive/status");
      setDriveStatus(s);
    } catch {
      setDriveStatus({ connected: false });
    }
  }, []);

  useEffect(() => { void loadDriveStatus(); }, [loadDriveStatus]);

  useEffect(() => {
    if (!drivePollingState) return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const r = await apiFetch<{ status: string; email?: string; error?: string }>(
          `/api/gdrive/auth/status/${drivePollingState}`,
        );
        if (cancelled) return;
        if (r.status === "complete") {
          clearInterval(poll);
          clearTimeout(deadline);
          setDrivePollingState(null);
          setDriveConnecting(false);
          await loadDriveStatus();
          Alert.alert("Google Drive Connected", `Connected as ${r.email}`);
        } else if (r.status === "error") {
          clearInterval(poll);
          clearTimeout(deadline);
          setDrivePollingState(null);
          setDriveConnecting(false);
          Alert.alert("Connection Failed", r.error ?? "Authentication failed. Please try again.");
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 2000);
    const deadline = setTimeout(() => {
      if (cancelled) return;
      clearInterval(poll);
      setDrivePollingState(null);
      setDriveConnecting(false);
      Alert.alert("Timed Out", "Google authentication timed out. Please try again.");
    }, 120_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(deadline);
    };
  }, [drivePollingState, loadDriveStatus]);

  const { data: backups = [], isLoading, refetch } = useListBackups();
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const deleteBackup = useDeleteBackup();

  // ── Load schedule & compute auto-backup state ───────────────────────────
  useEffect(() => {
    (async () => {
      const saved = (await AsyncStorage.getItem(SCHEDULE_KEY)) as Schedule | null;
      if (saved) setSchedule(saved);

      const lastTs = await AsyncStorage.getItem(LAST_AUTO_BACKUP_KEY);
      if (lastTs) {
        const ts = Number(lastTs);
        setLastAutoTs(ts);
        const elapsed = Date.now() - ts;
        const interval = SCHEDULE_INTERVAL_MS[saved ?? "off"];
        if (saved && saved !== "off" && elapsed > interval) setShowReminder(true);
      } else if ((saved ?? "off") !== "off") {
        setShowReminder(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isLoading && backups.length === 0) setShowReminder(true);
  }, [isLoading, backups.length]);

  // ── Schedule ───────────────────────────────────────────────────────────
  const handleScheduleChange = async (value: Schedule) => {
    setSchedule(value);
    await AsyncStorage.setItem(SCHEDULE_KEY, value);
  };

  // ── Create backup ──────────────────────────────────────────────────────
  const handleCreateBackup = useCallback(async (silent = false): Promise<boolean> => {
    setCreating(true);
    try {
      await createBackup.mutateAsync({ data: {} });
      const ts = Date.now();
      setLastAutoTs(ts);
      await AsyncStorage.setItem(LAST_AUTO_BACKUP_KEY, String(ts));
      await queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey() });
      setShowReminder(false);
      if (!silent) Alert.alert("Backup Created", "Your data has been backed up successfully.");
      return true;
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Backup failed.";
      if (!silent) Alert.alert("Backup Failed", msg);
      return false;
    } finally {
      setCreating(false);
    }
  }, [createBackup, queryClient]);

  // ── Two-step restore ───────────────────────────────────────────────────
  const handleRestore = useCallback((backup: BackupMeta) => {
    // Step 1: Safety backup
    Alert.alert(
      "Safety Backup",
      "Create a backup of your current data before restoring?\n\nThis lets you undo the restore if needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Skip",
          style: "default",
          onPress: () => confirmRestore(backup),
        },
        {
          text: "Yes, Back Up First",
          style: "default",
          onPress: async () => {
            const ok = await handleCreateBackup(true);
            if (ok) {
              Alert.alert("Safety Backup Done", "Safety backup created. Proceeding with restore…", [
                { text: "OK", onPress: () => confirmRestore(backup) },
              ]);
            } else {
              Alert.alert("Safety backup failed.", "Restore cancelled for your safety.");
            }
          },
        },
      ]
    );
  }, [handleCreateBackup]);

  const confirmRestore = useCallback((backup: BackupMeta) => {
    Alert.alert(
      "Restore This Backup?",
      `Current data will be replaced.\n\n📁 ${backup.label}\n🕐 ${formatDateFull(backup.createdAt)}\n📦 ${formatBytes(backup.sizeBytes)}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setRestoringId(backup.id);
            try {
              const result = await restoreBackup.mutateAsync({ id: backup.id });
              await queryClient.invalidateQueries();
              Alert.alert("Restore Complete", result.message ?? "Data restored successfully.");
            } catch (e: any) {
              Alert.alert("Restore Failed", e?.response?.data?.error ?? e?.message ?? "Restore failed.");
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  }, [restoreBackup, queryClient]);

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback((backup: BackupMeta) => {
    Alert.alert(
      "Delete Backup",
      `Delete "${backup.label}"?\n\nThis cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(backup.id);
            try {
              await deleteBackup.mutateAsync({ id: backup.id });
              await queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey() });
            } catch (e: any) {
              Alert.alert("Error", e?.response?.data?.error ?? "Could not delete backup.");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }, [deleteBackup, queryClient]);

  // ── Export (.grm file to Downloads/Gemini Rent Manager/) ─────────────────
  const handleExport = useCallback(async (backup: BackupMeta) => {
    if (Platform.OS === "web") {
      Alert.alert("Export Unavailable", "File export is available in the Android app.");
      return;
    }
    setExportingId(backup.id);
    try {
      // 1. Fetch backup data from server
      const res = await apiFetch<{ id: number; label: string; version: string; data: object }>(
        `/api/backup/${backup.id}/data`
      );

      // 2. Encode as proprietary .grm format
      const fileContent = encodeGRMFile(res.data, backup.label);
      const fileName = grmFileName(backup.label);

      if (Platform.OS === "android") {
        // 3. Get or request SAF permission for Downloads/Gemini Rent Manager/
        let exportDirUri: string;
        try {
          exportDirUri = await getOrRequestExportDir();
        } catch (permErr: any) {
          if (String(permErr?.message).includes("permission_denied")) return; // user cancelled picker
          throw permErr;
        }

        // 4. Write file directly to Downloads/Gemini Rent Manager/
        let fileUri: string;
        try {
          fileUri = await StorageAccessFramework.createFileAsync(
            exportDirUri,
            fileName,
            "application/octet-stream"
          );
        } catch (createErr: any) {
          // SAF URI may be stale — clear cache and let user re-grant next time
          await AsyncStorage.removeItem(SAF_EXPORT_DIR_KEY);
          throw new Error("Storage access expired. Please tap Export again to reconnect.");
        }
        await StorageAccessFramework.writeAsStringAsync(fileUri, fileContent);

        // 5. Show success dialog with Open Folder / Done
        Alert.alert(
          "Backup Exported Successfully",
          `Your backup has been saved to:\nDownloads/Gemini Rent Manager/\n\n📄 ${fileName}`,
          [
            { text: "Open Folder", onPress: openDownloadsFolder },
            { text: "Done" },
          ]
        );
      } else {
        // iOS: write to app Documents directory
        const docDir = FileSystem.Paths.document;
        const destFile = new FileSystem.File(docDir.uri + fileName);
        destFile.write(new TextEncoder().encode(fileContent));
        Alert.alert(
          "Backup Exported Successfully",
          `"${fileName}" has been saved to the Files app.`,
          [{ text: "Done" }]
        );
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "").toLowerCase();
      if (!msg.includes("cancel") && !msg.includes("permission_denied")) {
        Alert.alert("Export Failed", e?.message ?? "Could not export the backup file.");
      }
    } finally {
      setExportingId(null);
    }
  }, []);

  // ── Import (.grm file) ─────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Import Unavailable", "File import is available in the Android app.");
      return;
    }
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      if (!file.name.endsWith(".grm")) {
        Alert.alert("Invalid File", "Please select a valid Gemini Rent Manager backup file (.grm).");
        return;
      }

      const content = await fsReadAsStringAsync(file.uri, { encoding: "utf8" });

      const decoded = decodeGRMFile(content);
      if (!decoded) {
        Alert.alert(
          "Invalid Backup File",
          "This file is not a valid Gemini Rent Manager backup, or it has been corrupted or tampered with."
        );
        return;
      }

      // Create backup record on server
      const newBackup = await apiFetch<BackupMeta>(
        "/api/backup/import",
        {
          method: "POST",
          body: JSON.stringify({ label: decoded.label, data: decoded.data }),
        }
      );
      await queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey() });

      // Ask to restore immediately
      Alert.alert(
        "Import Successful",
        `"${newBackup.label}" has been imported.\n\nDo you want to restore from it now?`,
        [
          { text: "Not Now", style: "cancel" },
          {
            text: "Restore Now",
            style: "destructive",
            onPress: () => confirmRestore(newBackup),
          },
        ]
      );
    } catch (e: any) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (!msg.includes("cancel")) {
        Alert.alert("Import Failed", e?.message ?? "Could not import backup file.");
      }
    } finally {
      setImporting(false);
    }
  }, [queryClient, confirmRestore]);

  // ── Computed values ─────────────────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // ── Google Drive handlers ──────────────────────────────────────────────────
  const handleDriveConnect = async () => {
    setDriveConnecting(true);
    try {
      const { oauthUrl, stateToken } = await apiFetch<{ oauthUrl: string; stateToken: string }>(
        "/api/gdrive/auth/start",
      );
      await Linking.openURL(oauthUrl);
      setDrivePollingState(stateToken);
    } catch (err: any) {
      setDriveConnecting(false);
      Alert.alert("Error", err.message ?? "Could not start Google authentication");
    }
  };

  const handleDriveDisconnect = () => {
    Alert.alert(
      "Disconnect Google Drive",
      "Remove the Google Drive connection? Your Drive backup file will not be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await apiFetch("/api/gdrive/disconnect", { method: "DELETE" });
              setDriveStatus({ connected: false });
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Could not disconnect");
            }
          },
        },
      ],
    );
  };

  const handleDriveBackup = async () => {
    setDriveBacking(true);
    try {
      await apiFetch("/api/gdrive/backup", { method: "POST" });
      await loadDriveStatus();
      Alert.alert("Backup Complete", "Your data has been encrypted and saved to Google Drive.");
    } catch (err: any) {
      Alert.alert("Backup Failed", err.message ?? "Could not upload to Google Drive");
    } finally {
      setDriveBacking(false);
    }
  };

  const handleDriveRestore = () => {
    Alert.alert(
      "Restore from Google Drive",
      "This will replace ALL your current data with the Drive backup. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            setDriveRestoring(true);
            try {
              await apiFetch("/api/gdrive/restore", { method: "POST" });
              await refetch();
              Alert.alert("Restored", "All your data has been restored from Google Drive.");
            } catch (err: any) {
              Alert.alert("Restore Failed", err.message ?? "Could not restore from Google Drive");
            } finally {
              setDriveRestoring(false);
            }
          },
        },
      ],
    );
  };

  const handleDriveAutoBackupToggle = async () => {
    if (!driveStatus?.connected) return;
    const newVal = !driveStatus.autoBackupEnabled;
    setDriveStatus(prev => (prev ? { ...prev, autoBackupEnabled: newVal } : prev));
    try {
      await apiFetch("/api/gdrive/auto-backup", {
        method: "PUT",
        body: JSON.stringify({ enabled: newVal }),
      });
    } catch (err: any) {
      setDriveStatus(prev => (prev ? { ...prev, autoBackupEnabled: !newVal } : prev));
      Alert.alert("Error", err.message ?? "Could not update auto-backup setting");
    }
  };

  const sortedBackups = [...backups].reverse();
  const latestBackup = sortedBackups[0] ?? null;
  const daysSinceBackup = latestBackup
    ? Math.floor((Date.now() - new Date(latestBackup.createdAt).getTime()) / 86400000)
    : null;

  const nextBackupDate = lastAutoTs ? computeNextBackup(lastAutoTs, schedule) : null;

  const statusColor =
    backups.length === 0 ? colors.destructive :
    (daysSinceBackup ?? 99) <= 1 ? colors.success :
    (daysSinceBackup ?? 99) <= 7 ? colors.primary : colors.warning;

  const statusTitle =
    backups.length === 0 ? "No backups yet" :
    (daysSinceBackup ?? 0) <= 1 ? "Up to date" :
    (daysSinceBackup ?? 0) <= 7 ? "Recent backup" : "Backup needed";

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, {
        paddingTop: insets.top + 12,
        backgroundColor: colors.card,
        borderBottomColor: colors.border,
      }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Backup & Restore</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {backups.length} backup{backups.length !== 1 ? "s" : ""} · Server Storage
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: colors.primary }, creating && { opacity: 0.7 }]}
          onPress={() => handleCreateBackup()}
          disabled={creating}
        >
          {creating
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Feather name="upload-cloud" size={15} color="#fff" /><Text style={styles.createBtnText}>Backup</Text></>
          }
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >

        {/* ── Reminder Banner ─────────────────────────────────────────── */}
        {showReminder && (
          <TouchableOpacity
            style={[styles.reminderBanner, { backgroundColor: `${colors.warning}18`, borderColor: `${colors.warning}40` }]}
            onPress={() => handleCreateBackup()}
            activeOpacity={0.8}
          >
            <View style={[styles.reminderIcon, { backgroundColor: `${colors.warning}25` }]}>
              <Feather name="alert-triangle" size={18} color={colors.warning} />
            </View>
            <View style={styles.reminderText}>
              <Text style={[styles.reminderTitle, { color: colors.warning }]}>
                {backups.length === 0 ? "No backups found" : "Backup overdue"}
              </Text>
              <Text style={[styles.reminderDesc, { color: colors.mutedForeground }]}>
                {backups.length === 0
                  ? "Create your first backup to keep your data safe"
                  : `Last backup was ${daysSinceBackup} day${daysSinceBackup !== 1 ? "s" : ""} ago — tap to back up now`}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.warning} />
          </TouchableOpacity>
        )}

        {/* ── Status Card ─────────────────────────────────────────────── */}
        <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>{statusTitle}</Text>
              <Text style={[styles.statusDesc, { color: colors.mutedForeground }]}>
                {latestBackup
                  ? `Last backup: ${formatDate(latestBackup.createdAt)} at ${formatTime(latestBackup.createdAt)}`
                  : "Tap Backup to protect your data"}
              </Text>
            </View>
            {latestBackup && (
              <Text style={[styles.statusAgo, { color: colors.mutedForeground }]}>
                {timeAgo(latestBackup.createdAt)}
              </Text>
            )}
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{backups.length}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Backups</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {latestBackup ? formatBytes(latestBackup.sizeBytes) : "—"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Latest Size</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {schedule === "off" ? "Off" : schedule.charAt(0).toUpperCase() + schedule.slice(1)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Auto Schedule</Text>
            </View>
          </View>
        </View>

        {/* ── Backup Destination ───────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Backup Destination</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Active: Server / App Storage */}
          <View style={[styles.destRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.destIcon, { backgroundColor: `${colors.primary}18` }]}>
              <Feather name="server" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destLabel, { color: colors.foreground }]}>App Storage</Text>
              <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                Stored securely on the server · {backups.length} backup{backups.length !== 1 ? "s" : ""}
              </Text>
            </View>
            <View style={[styles.activeBadge, { backgroundColor: `${colors.success}18`, borderColor: `${colors.success}30` }]}>
              <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.activeBadgeText, { color: colors.success }]}>Active</Text>
            </View>
          </View>

          {/* Future: Cloud */}
          <View style={[styles.destRow, { borderBottomColor: colors.border, opacity: 0.4 }]}>
            <View style={[styles.destIcon, { backgroundColor: `${colors.mutedForeground}18` }]}>
              <Feather name="cloud" size={17} color={colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destLabel, { color: colors.foreground }]}>Cloud Backup</Text>
              <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>Remote cloud storage</Text>
            </View>
            <View style={[styles.soonBadge, { backgroundColor: `${colors.mutedForeground}15` }]}>
              <Text style={[styles.soonBadgeText, { color: colors.mutedForeground }]}>Coming Soon</Text>
            </View>
          </View>

          {/* Google Drive */}
          <View style={[styles.destRow, { borderBottomWidth: 0 }]}>
            <View style={[styles.destIcon, {
              backgroundColor: driveStatus?.connected ? `${colors.success}18` : `${colors.mutedForeground}18`,
            }]}>
              <Feather
                name="hard-drive" size={17}
                color={driveStatus?.connected ? colors.success : colors.mutedForeground}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destLabel, { color: colors.foreground }]}>Google Drive</Text>
              <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                {driveStatus?.connected ? driveStatus.email : "Sync to Google Drive"}
              </Text>
            </View>
            {driveStatus?.connected ? (
              <View style={[styles.activeBadge, { backgroundColor: `${colors.success}18`, borderColor: `${colors.success}30` }]}>
                <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.activeBadgeText, { color: colors.success }]}>Connected</Text>
              </View>
            ) : (
              <View style={[styles.soonBadge, { backgroundColor: `${colors.mutedForeground}15` }]}>
                <Text style={[styles.soonBadgeText, { color: colors.mutedForeground }]}>Not Set Up</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Google Drive Backup ──────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Google Drive Backup</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Connection row */}
          <View style={[styles.destRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.destIcon, {
              backgroundColor: driveStatus?.connected ? `${colors.success}18` : `${colors.mutedForeground}18`,
            }]}>
              <Feather
                name="hard-drive" size={17}
                color={driveStatus?.connected ? colors.success : colors.mutedForeground}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destLabel, { color: colors.foreground }]}>
                {driveStatus?.connected ? driveStatus.email : "Not Connected"}
              </Text>
              <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                {driveStatus?.connected
                  ? (driveStatus.lastBackupAt
                    ? `Last backup: ${formatDate(driveStatus.lastBackupAt)} · ${timeAgo(driveStatus.lastBackupAt)}`
                    : "Connected — no backup yet")
                  : "Connect your Google account to back up data"}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.eiBtn, {
                backgroundColor: driveStatus?.connected ? `${colors.destructive}15` : `${colors.primary}15`,
                borderColor: driveStatus?.connected ? `${colors.destructive}25` : `${colors.primary}25`,
              }]}
              onPress={driveStatus?.connected ? handleDriveDisconnect : handleDriveConnect}
              disabled={driveConnecting}
            >
              {driveConnecting
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={[styles.eiBtnText, {
                    color: driveStatus?.connected ? colors.destructive : colors.primary,
                  }]}>
                    {driveStatus?.connected ? "Disconnect" : "Connect"}
                  </Text>
              }
            </TouchableOpacity>
          </View>

          {/* Last backup error */}
          {driveStatus?.connected && driveStatus.lastBackupStatus === "error" && (
            <View style={[styles.autoStatusBox, { backgroundColor: `${colors.destructive}08`, borderTopColor: colors.border }]}>
              <View style={styles.autoStatusRow}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.autoStatusLabel, { color: colors.destructive }]}>Last backup failed</Text>
              </View>
              {!!driveStatus.lastBackupError && (
                <Text style={[styles.nextBackupNote, { color: colors.mutedForeground }]}>
                  {driveStatus.lastBackupError}
                </Text>
              )}
            </View>
          )}

          {/* Backup Now */}
          {driveStatus?.connected && (
            <View style={[styles.eiRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.destIcon, { backgroundColor: `${colors.primary}15` }]}>
                <Feather name="upload-cloud" size={17} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.destLabel, { color: colors.foreground }]}>Backup Now</Text>
                <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                  Encrypt and save to Google Drive
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.eiBtn, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}25` }]}
                onPress={handleDriveBackup}
                disabled={driveBacking || driveRestoring}
              >
                {driveBacking
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={[styles.eiBtnText, { color: colors.primary }]}>Backup</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Restore from Drive */}
          {driveStatus?.connected && driveStatus.hasDriveFile && (
            <View style={[styles.eiRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.destIcon, { backgroundColor: `${colors.accent}15` }]}>
                <Feather name="download-cloud" size={17} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.destLabel, { color: colors.foreground }]}>Restore from Drive</Text>
                <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                  Download and restore your Drive backup
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.eiBtn, { backgroundColor: `${colors.accent}15`, borderColor: `${colors.accent}25` }]}
                onPress={handleDriveRestore}
                disabled={driveBacking || driveRestoring}
              >
                {driveRestoring
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Text style={[styles.eiBtnText, { color: colors.accent }]}>Restore</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Restore disabled — no backup yet */}
          {driveStatus?.connected && !driveStatus.hasDriveFile && (
            <View style={[styles.eiRow, { borderBottomColor: colors.border, opacity: 0.5 }]}>
              <View style={[styles.destIcon, { backgroundColor: `${colors.muted}50` }]}>
                <Feather name="download-cloud" size={17} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.destLabel, { color: colors.foreground }]}>Restore from Drive</Text>
                <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                  No Drive backup yet — run a backup first
                </Text>
              </View>
            </View>
          )}

          {/* Not connected info */}
          {!driveStatus?.connected && (
            <View style={[styles.eiRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.destIcon, { backgroundColor: `${colors.primary}10` }]}>
                <Feather name="shield" size={17} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.destLabel, { color: colors.foreground }]}>AES-256 Encrypted</Text>
                <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                  Backup is encrypted before upload · Only you can read it
                </Text>
              </View>
            </View>
          )}

          {/* Auto-backup toggle */}
          {driveStatus?.connected && (
            <View style={[styles.autoStatusBox, { backgroundColor: `${colors.primary}08`, borderTopColor: colors.border }]}>
              <View style={[styles.autoStatusRow, { justifyContent: "space-between" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="zap" size={14} color={colors.primary} />
                  <Text style={[styles.autoStatusLabel, { color: colors.primary }]}>Daily Auto-Backup</Text>
                </View>
                <TouchableOpacity
                  onPress={handleDriveAutoBackupToggle}
                  style={[styles.activeBadge, {
                    backgroundColor: driveStatus.autoBackupEnabled
                      ? `${colors.success}18` : `${colors.mutedForeground}15`,
                    borderColor: driveStatus.autoBackupEnabled
                      ? `${colors.success}30` : colors.border,
                    paddingHorizontal: 12,
                  }]}
                >
                  {driveStatus.autoBackupEnabled ? (
                    <>
                      <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
                      <Text style={[styles.activeBadgeText, { color: colors.success }]}>ON</Text>
                    </>
                  ) : (
                    <Text style={[styles.soonBadgeText, { color: colors.mutedForeground }]}>OFF</Text>
                  )}
                </TouchableOpacity>
              </View>
              <Text style={[styles.nextBackupNote, { color: colors.mutedForeground }]}>
                {driveStatus.autoBackupEnabled
                  ? "Auto-backing up to Google Drive daily at 2 AM UTC"
                  : "Enable to automatically back up to Google Drive every day"}
              </Text>
            </View>
          )}
        </View>

        {/* ── Auto Backup Schedule ─────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Auto Backup Schedule</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {SCHEDULE_OPTIONS.map((opt, i) => {
            const isSelected = schedule === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.scheduleRow,
                  { borderBottomColor: colors.border },
                  i === SCHEDULE_OPTIONS.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => handleScheduleChange(opt.value)}
                activeOpacity={0.7}
              >
                <View style={[styles.scheduleIcon, {
                  backgroundColor: isSelected ? `${colors.primary}20` : `${colors.muted}60`,
                }]}>
                  <Feather name={opt.icon} size={16} color={isSelected ? colors.primary : colors.mutedForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.scheduleLabel, { color: colors.foreground }]}>{opt.label}</Text>
                  <Text style={[styles.scheduleDesc, { color: colors.mutedForeground }]}>{opt.desc}</Text>
                </View>
                <View style={[styles.radioOuter, { borderColor: isSelected ? colors.primary : colors.border }]}>
                  {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Auto Backup Status when a schedule is active */}
          {schedule !== "off" && (
            <View style={[styles.autoStatusBox, { backgroundColor: `${colors.primary}08`, borderTopColor: colors.border }]}>
              <View style={styles.autoStatusRow}>
                <Feather name="zap" size={14} color={colors.primary} />
                <Text style={[styles.autoStatusLabel, { color: colors.primary }]}>Auto Backup Status</Text>
                <View style={[styles.activeBadge, { backgroundColor: `${colors.success}18`, borderColor: `${colors.success}30` }]}>
                  <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.activeBadgeText, { color: colors.success }]}>Active</Text>
                </View>
              </View>
              {nextBackupDate && (
                <View style={styles.nextBackupRow}>
                  <View style={styles.nextBackupItem}>
                    <Text style={[styles.nextBackupKey, { color: colors.mutedForeground }]}>Next Backup Date</Text>
                    <Text style={[styles.nextBackupVal, { color: colors.foreground }]}>
                      {fmtDate(nextBackupDate)}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.nextBackupItem}>
                    <Text style={[styles.nextBackupKey, { color: colors.mutedForeground }]}>Next Backup Time</Text>
                    <Text style={[styles.nextBackupVal, { color: colors.foreground }]}>
                      {nextBackupDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </Text>
                  </View>
                </View>
              )}
              {!nextBackupDate && (
                <Text style={[styles.nextBackupNote, { color: colors.mutedForeground }]}>
                  Create your first backup to activate the schedule timer.
                </Text>
              )}
            </View>
          )}
        </View>

        {/* ── Export & Import ──────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Export & Import</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.eiRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.destIcon, { backgroundColor: `${colors.primary}15` }]}>
              <Feather name="download" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destLabel, { color: colors.foreground }]}>Export Backup</Text>
              <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                Save a .grm backup file to your device
              </Text>
            </View>
            {latestBackup && (
              <TouchableOpacity
                style={[styles.eiBtn, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}25` }]}
                onPress={() => handleExport(latestBackup)}
                disabled={exportingId === latestBackup.id}
              >
                {exportingId === latestBackup.id
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={[styles.eiBtnText, { color: colors.primary }]}>Export Latest</Text>
                }
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.eiRow, { borderBottomWidth: 0 }]}>
            <View style={[styles.destIcon, { backgroundColor: `${colors.accent}15` }]}>
              <Feather name="upload" size={17} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destLabel, { color: colors.foreground }]}>Import Backup</Text>
              <Text style={[styles.destDesc, { color: colors.mutedForeground }]}>
                Restore from a .grm backup file
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.eiBtn, { backgroundColor: `${colors.accent}15`, borderColor: `${colors.accent}25` }]}
              onPress={handleImport}
              disabled={importing}
            >
              {importing
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Text style={[styles.eiBtnText, { color: colors.accent }]}>Import</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Backup History ───────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Backup History</Text>

        {isLoading ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading backups…</Text>
          </View>
        ) : backups.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: `${colors.primary}15` }]}>
              <Feather name="database" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No backups yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Create your first backup to keep your properties, tenants, payments, and all business data safe.
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              onPress={() => handleCreateBackup()}
              disabled={creating}
            >
              {creating
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Feather name="upload-cloud" size={16} color="#fff" /><Text style={styles.emptyBtnText}>Create First Backup</Text></>
              }
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {sortedBackups.map((backup, idx) => {
              const isRestoring = restoringId === backup.id;
              const isDeleting = deletingId === backup.id;
              const isExporting = exportingId === backup.id;
              const isNewest = idx === 0;

              return (
                <View
                  key={backup.id}
                  style={[
                    styles.backupCard,
                    { borderBottomColor: colors.border },
                    idx === sortedBackups.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  {/* Card header */}
                  <View style={styles.backupCardHeader}>
                    <View style={[styles.backupIconWrap, {
                      backgroundColor: isNewest ? `${colors.primary}18` : `${colors.muted}50`,
                    }]}>
                      <Feather name="database" size={18} color={isNewest ? colors.primary : colors.mutedForeground} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.backupLabelRow}>
                        <Text
                          style={[styles.backupLabel, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {backup.label}
                        </Text>
                        {isNewest && (
                          <View style={[styles.latestBadge, { backgroundColor: `${colors.success}20` }]}>
                            <Text style={[styles.latestBadgeText, { color: colors.success }]}>Latest</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.backupMeta, { color: colors.mutedForeground }]}>
                        {formatDateFull(backup.createdAt)} · {timeAgo(backup.createdAt)}
                      </Text>
                    </View>
                  </View>

                  {/* Backup details grid */}
                  <View style={[styles.detailsGrid, { backgroundColor: `${colors.muted}30`, borderColor: colors.border }]}>
                    <View style={styles.detailCell}>
                      <Text style={[styles.detailKey, { color: colors.mutedForeground }]}>Size</Text>
                      <Text style={[styles.detailVal, { color: colors.foreground }]}>{formatBytes(backup.sizeBytes)}</Text>
                    </View>
                    <View style={[styles.detailCellDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.detailCell}>
                      <Text style={[styles.detailKey, { color: colors.mutedForeground }]}>Location</Text>
                      <Text style={[styles.detailVal, { color: colors.foreground }]}>
                        {backup.location ?? "Server Storage"}
                      </Text>
                    </View>
                    <View style={[styles.detailCellDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.detailCell}>
                      <Text style={[styles.detailKey, { color: colors.mutedForeground }]}>Version</Text>
                      <Text style={[styles.detailVal, { color: colors.foreground }]}>
                        v{backup.version ?? "1.0"}
                      </Text>
                    </View>
                    <View style={[styles.detailCellDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.detailCell}>
                      <Text style={[styles.detailKey, { color: colors.mutedForeground }]}>Status</Text>
                      <Text style={[styles.detailVal, { color: colors.success }]}>✓ Complete</Text>
                    </View>
                  </View>

                  {/* Action buttons */}
                  <View style={styles.backupActions}>
                    <TouchableOpacity
                      style={[styles.actionChip, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}20` }]}
                      onPress={() => handleRestore(backup)}
                      disabled={isRestoring || isDeleting || isExporting}
                    >
                      {isRestoring
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <><Feather name="rotate-ccw" size={13} color={colors.primary} />
                          <Text style={[styles.actionChipText, { color: colors.primary }]}>Restore</Text></>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionChip, { backgroundColor: `${colors.accent}12`, borderColor: `${colors.accent}20` }]}
                      onPress={() => handleExport(backup)}
                      disabled={isRestoring || isDeleting || isExporting}
                    >
                      {isExporting
                        ? <ActivityIndicator size="small" color={colors.accent} />
                        : <><Feather name="download" size={13} color={colors.accent} />
                          <Text style={[styles.actionChipText, { color: colors.accent }]}>Export</Text></>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionChip, { backgroundColor: `${colors.destructive}10`, borderColor: `${colors.destructive}20` }]}
                      onPress={() => handleDelete(backup)}
                      disabled={isRestoring || isDeleting || isExporting}
                    >
                      {isDeleting
                        ? <ActivityIndicator size="small" color={colors.destructive} />
                        : <><Feather name="trash-2" size={13} color={colors.destructive} />
                          <Text style={[styles.actionChipText, { color: colors.destructive }]}>Delete</Text></>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Encryption info note ──────────────────────────────────────── */}
        <View style={[styles.infoNote, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}20` }]}>
          <Feather name="shield" size={14} color={colors.primary} />
          <Text style={[styles.infoNoteText, { color: colors.mutedForeground }]}>
            Exported .grm files are encrypted with a proprietary format and checksum-protected.
            Only Gemini Rent Manager can import them. Backups include all properties, tenants,
            payments, expenses, loans, and maintenance records.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  backBtn: { width: 38, height: 38, justifyContent: "center", alignItems: "center" },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  headerSub: { fontSize: 12, marginTop: 1 },
  createBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, height: 36, borderRadius: 10,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  scroll: { padding: 16, gap: 10 },

  reminderBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 2,
  },
  reminderIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  reminderText: { flex: 1 },
  reminderTitle: { fontSize: 14, fontWeight: "700" },
  reminderDesc: { fontSize: 12, marginTop: 2 },

  statusCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTitle: { fontSize: 15, fontWeight: "700" },
  statusDesc: { fontSize: 12, marginTop: 2 },
  statusAgo: { fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth },
  statsRow: { flexDirection: "row" },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 11, textAlign: "center" },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36, alignSelf: "center" },

  sectionLabel: {
    fontSize: 11, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 0.8, marginTop: 6, marginBottom: 2, marginLeft: 4,
  },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },

  destRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  destIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  destLabel: { fontSize: 14, fontWeight: "600" },
  destDesc: { fontSize: 12, marginTop: 1 },
  activeBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeBadgeText: { fontSize: 11, fontWeight: "700" },
  soonBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  soonBadgeText: { fontSize: 11, fontWeight: "600" },

  scheduleRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 13, paddingHorizontal: 16, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleIcon: { width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  scheduleLabel: { fontSize: 15, fontWeight: "600" },
  scheduleDesc: { fontSize: 12, marginTop: 1 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, justifyContent: "center", alignItems: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5 },

  autoStatusBox: {
    padding: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  autoStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  autoStatusLabel: { flex: 1, fontSize: 13, fontWeight: "700" },
  nextBackupRow: { flexDirection: "row", gap: 0 },
  nextBackupItem: { flex: 1, alignItems: "center", gap: 3 },
  nextBackupKey: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "600" },
  nextBackupVal: { fontSize: 14, fontWeight: "700" },
  nextBackupNote: { fontSize: 12 },

  eiRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eiBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
    minWidth: 80, alignItems: "center",
  },
  eiBtnText: { fontSize: 13, fontWeight: "700" },

  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 32, alignItems: "center", gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 4,
  },
  emptyBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  backupCard: { borderBottomWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  backupCardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  backupIconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  backupLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  backupLabel: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
  backupMeta: { fontSize: 11, marginTop: 3 },
  latestBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  latestBadgeText: { fontSize: 10, fontWeight: "700" },

  detailsGrid: {
    flexDirection: "row", borderRadius: 10, borderWidth: 1,
    overflow: "hidden", marginTop: 2,
  },
  detailCell: { flex: 1, alignItems: "center", paddingVertical: 8, gap: 2 },
  detailCellDivider: { width: StyleSheet.hairlineWidth },
  detailKey: { fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "700" },
  detailVal: { fontSize: 12, fontWeight: "700" },

  backupActions: { flexDirection: "row", gap: 8 },
  actionChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, flex: 1,
    justifyContent: "center",
  },
  actionChipText: { fontSize: 12, fontWeight: "700" },

  infoNote: {
    flexDirection: "row", gap: 10, padding: 14,
    borderRadius: 14, borderWidth: 1, marginTop: 4, alignItems: "flex-start",
  },
  infoNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
