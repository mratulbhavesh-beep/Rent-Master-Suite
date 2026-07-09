import React, { useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Switch, Modal,
  FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { shareViaWhatsApp, interpolateTemplate, type ShareResult } from "@/utils/whatsapp";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Template {
  id: number;
  name: string;
  type: string;
  body: string;
  variables: string[];
  isActive: boolean;
  updatedAt: string;
}

interface ReminderLog {
  id: number;
  tenantId: number;
  tenantName: string | null;
  type: string;
  phone: string | null;
  message: string | null;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface TenantRow {
  id: number;
  name: string;
  phone: string;
  unitNumber: string | null;
  rentAmount: number;
  balanceDue: number;
  propertyName: string | null;
  propertyId: number;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  reminder_3days: "3-Day Advance",
  reminder_due: "Due Date",
  reminder_overdue: "Overdue",
  receipt_whatsapp: "Receipt",
  reminder_today: "Due Today",
  payment_received: "Payment Received",
};

const STATUS_COLORS: Record<string, string> = {
  shared: "#22c55e",
  sent: "#22c55e",
  share_sheet: "#3b82f6",
  cancelled: "#94a3b8",
  failed: "#ef4444",
  pending: "#f59e0b",
};

const STATUS_LABELS: Record<string, string> = {
  shared: "SHARED",
  sent: "SHARED",
  share_sheet: "ALT SHARE",
  cancelled: "CANCELLED",
  failed: "FAILED",
  pending: "PENDING",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function RemindersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useAuth();

  // Main screen state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "logs">("templates");

  // Compose modal state
  const [composeOpen, setComposeOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [tRes, lRes] = await Promise.all([
        fetch(`${API_BASE}/reminders/templates`, { headers: h }),
        fetch(`${API_BASE}/reminders/logs`, { headers: h }),
      ]);
      const tData = await tRes.json();
      const lData = await lRes.json();
      if (Array.isArray(tData)) setTemplates(tData);
      if (Array.isArray(lData)) setLogs(lData);
    } catch {
      Alert.alert("Error", "Failed to load reminder data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const fetchTenants = useCallback(async () => {
    if (!token) return;
    setTenantsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tenants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setTenants(
          data
            .filter((t: any) => t.status === "active" && t.phone)
            .map((t: any) => ({
              id: t.id,
              name: t.name,
              phone: t.phone,
              unitNumber: t.unitNumber ?? null,
              rentAmount: parseFloat(String(t.rentAmount ?? 0)),
              balanceDue: parseFloat(String(t.balanceDue ?? 0)),
              propertyName: t.propertyName ?? null,
              propertyId: t.propertyId,
              status: t.status,
            }))
        );
      }
    } catch {
      Alert.alert("Error", "Failed to load tenants");
    } finally {
      setTenantsLoading(false);
    }
  }, [token]);

  // ─── Template editing ───────────────────────────────────────────────────────

  const startEdit = (t: Template) => { setEditId(t.id); setEditBody(t.body); setEditName(t.name); };

  const saveTemplate = async () => {
    if (!editId || !token) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/reminders/templates/${editId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, body: editBody }),
      });
      const updated = await res.json();
      setTemplates(prev => prev.map(t => t.id === editId ? { ...t, ...updated } : t));
      setEditId(null);
      Alert.alert("Saved", "Template updated successfully.");
    } catch {
      Alert.alert("Error", "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: Template) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/reminders/templates/${t.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      const updated = await res.json();
      setTemplates(prev => prev.map(tp => tp.id === t.id ? { ...tp, ...updated } : tp));
    } catch {
      Alert.alert("Error", "Failed to update template");
    }
  };

  // ─── Compose modal ──────────────────────────────────────────────────────────

  const openCompose = () => {
    setSelectedTenant(null);
    setSelectedTemplate(null);
    setPreviewMessage("");
    setSearchQuery("");
    setTemplatePickerOpen(false);
    setComposeOpen(true);
    fetchTenants();
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setSelectedTenant(null);
    setSelectedTemplate(null);
    setPreviewMessage("");
  };

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const buildVars = (tenant: TenantRow): Record<string, string | number> => {
    const now = new Date();
    return {
      tenantName: tenant.name,
      propertyName: tenant.propertyName ?? "",
      unitNumber: tenant.unitNumber ?? "",
      billingPeriod: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
      amount: tenant.rentAmount.toLocaleString("en-IN"),
      rentAmount: tenant.rentAmount.toLocaleString("en-IN"),
      dueDate: `${now.getDate() + 5} ${MONTHS[now.getMonth()]}`,
      outstandingAmount: tenant.balanceDue.toLocaleString("en-IN"),
      ownerName: user?.name ?? "Your Landlord",
    };
  };

  const selectTenant = (tenant: TenantRow) => {
    setSelectedTenant(tenant);
    if (selectedTemplate) {
      setPreviewMessage(interpolateTemplate(selectedTemplate.body, buildVars(tenant)));
    }
    setSearchQuery(tenant.name);
  };

  const selectTemplate = (tpl: Template) => {
    setSelectedTemplate(tpl);
    setTemplatePickerOpen(false);
    if (selectedTenant) {
      setPreviewMessage(interpolateTemplate(tpl.body, buildVars(selectedTenant)));
    }
  };

  const logShare = async (tenant: TenantRow, tpl: Template, msg: string, result: ShareResult) => {
    if (!token || result === "cancelled") return;
    try {
      await fetch(`${API_BASE}/reminders/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant.id,
          type: tpl.type,
          message: msg,
          phone: tenant.phone,
          status: result === "whatsapp" ? "shared" : "share_sheet",
          templateId: tpl.id,
        }),
      });
      fetchAll();
    } catch {
      // Fire-and-forget — share already happened, logging is best-effort
    }
  };

  const handleShareViaWhatsApp = async () => {
    if (!selectedTenant || !selectedTemplate || !previewMessage) {
      Alert.alert("Incomplete", "Please select a tenant and a template.");
      return;
    }
    if (!selectedTenant.phone) {
      Alert.alert("No Phone Number", "This tenant has no phone number saved.");
      return;
    }

    setSharing(true);
    try {
      const result = await shareViaWhatsApp(selectedTenant.phone, previewMessage);
      if (result !== "cancelled") {
        await logShare(selectedTenant, selectedTemplate, previewMessage, result);
        closeCompose();
      }
    } finally {
      setSharing(false);
    }
  };

  // ─── Filtered tenant list ───────────────────────────────────────────────────

  const filteredTenants = useMemo(
    () =>
      tenants.filter(t =>
        searchQuery.length < 2 ||
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.phone && t.phone.includes(searchQuery))
      ),
    [tenants, searchQuery]
  );

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>WhatsApp Reminders</Text>
        <TouchableOpacity onPress={openCompose} style={[styles.composeBtn, { backgroundColor: "#25D36620" }]}>
          <Feather name="edit" size={18} color="#25D366" />
        </TouchableOpacity>
      </View>

      {/* ── Info banner ── */}
      <View style={[styles.infoBanner, { backgroundColor: "#25D36615", borderColor: "#25D36640" }]}>
        <Feather name="message-circle" size={14} color="#25D366" />
        <Text style={[styles.infoText, { color: "#16a34a" }]}>
          Free — opens WhatsApp with message pre-filled. No paid service required.
        </Text>
      </View>

      {/* ── Tabs ── */}
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {(["templates", "logs"] as const).map(tab => (
          <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && { borderBottomColor: "#25D366", borderBottomWidth: 2 }]}>
            <Text style={[styles.tabText, { color: activeTab === tab ? "#25D366" : colors.mutedForeground }]}>
              {tab === "templates" ? "Message Templates" : `Send Log (${logs.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Content ── */}
      {loading ? (
        <ActivityIndicator size="large" color="#25D366" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}>

          {activeTab === "templates" ? (
            templates.map(t => (
              <View key={t.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.templateType, { color: "#25D366" }]}>{TYPE_LABELS[t.type] ?? t.type}</Text>
                    {editId === t.id ? (
                      <TextInput
                        style={[styles.nameInput, { color: colors.foreground, borderColor: colors.border }]}
                        value={editName}
                        onChangeText={setEditName}
                      />
                    ) : (
                      <Text style={[styles.templateName, { color: colors.foreground }]}>{t.name}</Text>
                    )}
                  </View>
                  <Switch
                    value={t.isActive}
                    onValueChange={() => toggleActive(t)}
                    trackColor={{ false: colors.border, true: "#25D36660" }}
                    thumbColor={t.isActive ? "#25D366" : colors.mutedForeground}
                  />
                </View>

                {editId === t.id ? (
                  <>
                    <TextInput
                      style={[styles.bodyInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={editBody}
                      onChangeText={setEditBody}
                      multiline
                      numberOfLines={6}
                      textAlignVertical="top"
                    />
                    <View style={styles.vars}>
                      <Text style={[styles.varsLabel, { color: colors.mutedForeground }]}>Available variables:</Text>
                      <Text style={[styles.varsList, { color: "#25D366" }]}>{t.variables.map(v => `{{${v}}}`).join("  ")}</Text>
                    </View>
                    <View style={styles.editBtns}>
                      <TouchableOpacity onPress={() => setEditId(null)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
                        <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={saveTemplate} disabled={saving} style={[styles.saveBtn, { backgroundColor: "#25D366" }]}>
                        {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[styles.bodyPreview, { color: colors.mutedForeground }]}>{t.body}</Text>
                    <TouchableOpacity onPress={() => startEdit(t)} style={[styles.editBtn, { borderColor: colors.border }]}>
                      <Feather name="edit-2" size={14} color="#25D366" />
                      <Text style={[styles.editBtnText, { color: "#25D366" }]}>Edit Template</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ))
          ) : (
            logs.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="message-circle" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No reminders shared yet</Text>
                <TouchableOpacity onPress={openCompose}
                  style={[styles.emptyBtn, { backgroundColor: "#25D366" }]}>
                  <Feather name="edit" size={14} color="#fff" />
                  <Text style={styles.emptyBtnText}>Send a Reminder</Text>
                </TouchableOpacity>
              </View>
            ) : (
              logs.map(l => (
                <View key={l.id} style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.logHeader}>
                    <View>
                      <Text style={[styles.logTenant, { color: colors.foreground }]}>{l.tenantName ?? "—"}</Text>
                      <Text style={[styles.logType, { color: colors.mutedForeground }]}>{TYPE_LABELS[l.type] ?? l.type}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: (STATUS_COLORS[l.status] ?? "#94a3b8") + "20" }]}>
                      <Text style={[styles.statusText2, { color: STATUS_COLORS[l.status] ?? "#94a3b8" }]}>
                        {STATUS_LABELS[l.status] ?? l.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.logPhone, { color: colors.mutedForeground }]}>{l.phone ?? "—"}</Text>
                  <Text style={[styles.logDate, { color: colors.mutedForeground }]}>
                    {l.sentAt ? fmtDateTime(l.sentAt) : fmtDateTime(l.createdAt)}
                  </Text>
                </View>
              ))
            )
          )}
        </ScrollView>
      )}

      {/* ── Compose Modal ── */}
      <Modal
        visible={composeOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCompose}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: colors.background }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* Modal header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={closeCompose} style={styles.backBtn}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.foreground }]}>Send Reminder</Text>
            <View style={{ width: 36 }} />
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Step 1: Tenant */}
            <Text style={[styles.stepLabel, { color: colors.mutedForeground }]}>1  SELECT TENANT</Text>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Search by name or phone..."
              placeholderTextColor={colors.mutedForeground}
              value={searchQuery}
              onChangeText={text => { setSearchQuery(text); if (selectedTenant && text !== selectedTenant.name) setSelectedTenant(null); }}
            />

            {tenantsLoading ? (
              <ActivityIndicator color="#25D366" style={{ marginVertical: 12 }} />
            ) : (
              !selectedTenant && filteredTenants.slice(0, 8).map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => selectTenant(t)}
                  style={[styles.tenantRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.tenantAvatar, { backgroundColor: "#25D36620" }]}>
                    <Text style={[styles.tenantAvatarText, { color: "#25D366" }]}>{t.name[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tenantRowName, { color: colors.foreground }]}>{t.name}</Text>
                    <Text style={[styles.tenantRowSub, { color: colors.mutedForeground }]}>
                      {t.propertyName ?? ""}
                      {t.unitNumber ? ` · Unit ${t.unitNumber}` : ""}
                      {" · "}
                      {t.phone}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))
            )}

            {selectedTenant && (
              <View style={[styles.selectedCard, { backgroundColor: "#25D36615", borderColor: "#25D36640" }]}>
                <Feather name="check-circle" size={14} color="#25D366" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.selectedName, { color: colors.foreground }]}>{selectedTenant.name}</Text>
                  <Text style={[styles.selectedSub, { color: colors.mutedForeground }]}>
                    {selectedTenant.phone}
                    {selectedTenant.unitNumber ? ` · Unit ${selectedTenant.unitNumber}` : ""}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => { setSelectedTenant(null); setSearchQuery(""); }}>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2: Template */}
            <Text style={[styles.stepLabel, { color: colors.mutedForeground, marginTop: 20 }]}>2  SELECT TEMPLATE</Text>
            <TouchableOpacity
              onPress={() => setTemplatePickerOpen(v => !v)}
              style={[styles.templatePicker, { backgroundColor: colors.card, borderColor: selectedTemplate ? "#25D366" : colors.border }]}
            >
              <Text style={[styles.templatePickerText, { color: selectedTemplate ? colors.foreground : colors.mutedForeground }]}>
                {selectedTemplate ? selectedTemplate.name : "Tap to choose a template…"}
              </Text>
              <Feather name={templatePickerOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>

            {templatePickerOpen && (
              <View style={[styles.templateDropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {templates.filter(t => t.isActive).map(t => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => selectTemplate(t)}
                    style={[styles.templateOption, { borderBottomColor: colors.border }]}
                  >
                    <View>
                      <Text style={[styles.templateOptionType, { color: "#25D366" }]}>{TYPE_LABELS[t.type] ?? t.type}</Text>
                      <Text style={[styles.templateOptionName, { color: colors.foreground }]}>{t.name}</Text>
                    </View>
                    {selectedTemplate?.id === t.id && <Feather name="check" size={16} color="#25D366" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Step 3: Message preview */}
            {previewMessage ? (
              <>
                <Text style={[styles.stepLabel, { color: colors.mutedForeground, marginTop: 20 }]}>3  MESSAGE PREVIEW</Text>
                <View style={[styles.previewBubble, { backgroundColor: "#dcf8c6" }]}>
                  <Text style={[styles.previewText, { color: "#1a1a1a" }]}>{previewMessage}</Text>
                </View>
                <TextInput
                  style={[styles.previewEdit, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                  value={previewMessage}
                  onChangeText={setPreviewMessage}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  placeholder="Edit message if needed…"
                  placeholderTextColor={colors.mutedForeground}
                />
              </>
            ) : null}

            {/* Share button */}
            <TouchableOpacity
              onPress={handleShareViaWhatsApp}
              disabled={!selectedTenant || !selectedTemplate || sharing}
              style={[
                styles.shareBtn,
                {
                  backgroundColor: selectedTenant && selectedTemplate ? "#25D366" : colors.border,
                  marginTop: 24,
                },
              ]}
            >
              {sharing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="message-circle" size={18} color="#fff" />
                  <Text style={styles.shareBtnText}>Share via WhatsApp</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={[styles.shareNote, { color: colors.mutedForeground }]}>
              WhatsApp will open with the message pre-filled.{"\n"}
              The tenant's chat will be opened automatically using the saved phone number.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700", flex: 1 },
  composeBtn: { padding: 8, borderRadius: 8 },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 12, padding: 10, borderRadius: 10, borderWidth: 1 },
  infoText: { fontSize: 12, flex: 1, lineHeight: 18 },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { fontSize: 13, fontWeight: "600" },

  // Template cards
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 },
  templateType: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  templateName: { fontSize: 15, fontWeight: "600" },
  nameInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, marginTop: 4 },
  bodyPreview: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
  bodyInput: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13, lineHeight: 20, minHeight: 120, marginBottom: 10 },
  vars: { marginBottom: 12 },
  varsLabel: { fontSize: 11, marginBottom: 4 },
  varsList: { fontSize: 12, fontFamily: "monospace" },
  editBtns: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  cancelBtnText: { fontSize: 13, fontWeight: "600" },
  saveBtn: { borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" },
  editBtnText: { fontSize: 13, fontWeight: "600" },

  // Log cards
  logCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  logTenant: { fontSize: 13, fontWeight: "700" },
  logType: { fontSize: 11, marginTop: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText2: { fontSize: 10, fontWeight: "700" },
  logPhone: { fontSize: 12, marginBottom: 2 },
  logDate: { fontSize: 11 },

  // Empty state
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  emptyBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  // Modal
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 10 },
  stepLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 10 },
  searchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, marginBottom: 8 },
  tenantRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 6 },
  tenantAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tenantAvatarText: { fontSize: 16, fontWeight: "700" },
  tenantRowName: { fontSize: 14, fontWeight: "600" },
  tenantRowSub: { fontSize: 12, marginTop: 1 },
  selectedCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 12 },
  selectedName: { fontSize: 14, fontWeight: "600" },
  selectedSub: { fontSize: 12 },
  templatePicker: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  templatePickerText: { fontSize: 14 },
  templateDropdown: { borderWidth: 1, borderRadius: 10, marginTop: 4, overflow: "hidden" },
  templateOption: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottomWidth: 1 },
  templateOptionType: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  templateOptionName: { fontSize: 13, fontWeight: "600", marginTop: 1 },
  previewBubble: { borderRadius: 12, borderTopRightRadius: 2, padding: 14, marginBottom: 8 },
  previewText: { fontSize: 14, lineHeight: 20 },
  previewEdit: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 20, minHeight: 80, marginBottom: 4 },
  shareBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, paddingVertical: 16, borderRadius: 14 },
  shareBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  shareNote: { fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 12 },
});
