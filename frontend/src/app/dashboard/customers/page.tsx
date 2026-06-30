"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
  Users, Plus, X, RefreshCw, ChevronRight,
  Pencil, Trash2, Car, Tag, Phone, Mail,
  ShieldAlert, Zap, CheckCircle, XCircle,
  Clock, Settings, AlertTriangle, BarChart3,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ────────────────────────────────────────────────────

interface IdTag {
  id: number;
  id_tag: string;
  customer_id: number | null;
  expiry_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_type: string;
  monthly_charge_limit: number | null;
  charge_limit_enabled: boolean;
  created_at: string;
  id_tags: IdTag[];
}

interface Transaction {
  id: number;
  transaction_id: number;
  charge_point_id: string;
  start_timestamp: string;
  stop_timestamp: string | null;
  energy_consumed_kwh: number | null;
  total_cost: number | null;
  status: string;
}

interface UsageInfo {
  customer_id: number;
  customer_name: string;
  id_tag: string;
  effective_limit: number | null;
  limit_enabled: boolean;
  used_this_month: number;
  remaining: number | null;
  is_over_limit: boolean;
  has_extra_sessions: number;
  month: number;
  year: number;
}

interface LimitConfig {
  monthly_limit: number;
  is_enabled: boolean;
}

interface LimitRequest {
  id: number;
  customer_id: number;
  customer_name: string;
  id_tag: string;
  charge_point_id: string | null;
  reason: string | null;
  status: string;
  extra_sessions: number;
  requested_at: string;
  resolved_at: string | null;
}

interface CustomerForm {
  name: string; email: string; phone: string;
  car_brand: string; car_model: string;
  car_type: string; id_tag: string;
}

// ── Constants & Helpers ───────────────────────────────────────

const statusColor: Record<string, string> = {
  Accepted: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Blocked: "text-red-400 bg-red-500/10 border-red-500/20",
  Expired: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Invalid: "text-gray-400 bg-gray-700/50 border-gray-600/20",
  ConcurrentTx: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

const requestStatusColor: Record<string, string> = {
  Pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Approved: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Rejected: "text-red-400 bg-red-500/10 border-red-500/20",
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium" });

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const emptyForm: CustomerForm = {
  name: "", email: "", phone: "", car_brand: "",
  car_model: "", car_type: "private", id_tag: "",
};

const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 flex-shrink-0 w-28">{label}</span>
      <span className={`text-xs text-right break-all ${mono ? "font-mono text-emerald-400" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const colors = ["bg-emerald-500/20 text-emerald-400", "bg-blue-500/20 text-blue-400",
    "bg-purple-500/20 text-purple-400", "bg-amber-500/20 text-amber-400"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${color}`}>
      {initials}
    </div>
  );
}

function IdTagBadge({ tag }: { tag: IdTag }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${statusColor[tag.status] ?? statusColor.Invalid}`}>
      <span className="font-mono">{tag.id_tag}</span>
      <span className="opacity-70">· {tag.status}</span>
    </span>
  );
}

// ── Usage Bar ─────────────────────────────────────────────────

function UsageBar({ usage }: { usage: UsageInfo }) {
  if (!usage.limit_enabled || usage.effective_limit == null) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full" />
        <span className="text-xs text-gray-600">Tidak dibatasi</span>
      </div>
    );
  }
  const pct = Math.min((usage.used_this_month / usage.effective_limit) * 100, 100);
  const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs">
        <span className={pct >= 100 ? "text-red-400" : "text-gray-400"}>
          {usage.used_this_month}/{usage.effective_limit} sesi
          {usage.has_extra_sessions > 0 && (
            <span className="text-blue-400 ml-1">(+{usage.has_extra_sessions} extra)</span>
          )}
        </span>
        {pct >= 100
          ? <span className="text-red-400 font-medium">Over limit</span>
          : <span className="text-gray-500">{usage.remaining} tersisa</span>
        }
      </div>
    </div>
  );
}

// ── Global Config Modal ───────────────────────────────────────

function GlobalConfigModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: cfg } = useQuery<LimitConfig>({
    queryKey: ["limit-config"],
    queryFn: () => api.get("/api/charging-limit/config").then((r) => r.data),
  });

  const [form, setForm] = useState({ monthly_limit: cfg?.monthly_limit ?? 15, is_enabled: cfg?.is_enabled ?? true });

  const updateMut = useMutation({
    mutationFn: (data: typeof form) => api.put("/api/charging-limit/config", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["limit-config"] });
      qc.invalidateQueries({ queryKey: ["limit-usage"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" /> Konfigurasi Limit Global
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <Field label="Limit Bulanan (sesi)">
            <input type="number" min={1} max={9999}
              value={form.monthly_limit}
              onChange={(e) => setForm({ ...form, monthly_limit: Number(e.target.value) })}
              className={inputCls} />
            <p className="text-xs text-gray-600 mt-1">Berlaku untuk semua customer (kecuali yang punya override)</p>
          </Field>

          <Field label="Status Fitur">
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => setForm({ ...form, is_enabled: !form.is_enabled })}
                className={`relative w-11 h-6 rounded-full transition-colors ${form.is_enabled ? "bg-emerald-500" : "bg-gray-600"}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${form.is_enabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <span className="text-sm text-gray-300">{form.is_enabled ? "Aktif" : "Nonaktif"}</span>
            </div>
          </Field>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg hover:bg-gray-700 transition-colors">
            Batal
          </button>
          <button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending}
            className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors disabled:opacity-50">
            {updateMut.isPending ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Request Panel ─────────────────────────────────────────────

function RequestsPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [extraSessions, setExtraSessions] = useState<Record<number, number>>({});

  const { data: requests = [], isLoading, refetch } = useQuery<LimitRequest[]>({
    queryKey: ["limit-requests"],
    queryFn: () => api.get("/api/charging-limit/requests").then((r) => r.data),
    refetchInterval: 15000,
  });

  const approveMut = useMutation({
    mutationFn: ({ id, extra }: { id: number; extra: number }) =>
      api.put(`/api/charging-limit/requests/${id}/approve`, { extra_sessions: extra }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["limit-requests"] });
      qc.invalidateQueries({ queryKey: ["limit-usage"] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => api.put(`/api/charging-limit/requests/${id}/reject`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["limit-requests"] });
      qc.invalidateQueries({ queryKey: ["limit-usage"] });
    },
  });

  const pending = requests.filter((r) => r.status === "Pending");
  const resolved = requests.filter((r) => r.status !== "Pending");

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-900 border-l border-gray-800 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Request Akses Charging</h2>
            {pending.length > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded-md border border-amber-500/20">
                {pending.length} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-gray-500" /></div>}

          {/* Pending requests */}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-400 mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Menunggu Persetujuan
              </p>
              <div className="space-y-3">
                {pending.map((req) => (
                  <div key={req.id} className="bg-gray-800/60 border border-amber-500/20 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p className="text-sm font-medium text-white">{req.customer_name}</p>
                        <p className="text-xs font-mono text-emerald-400">{req.id_tag}</p>
                        {req.charge_point_id && (
                          <p className="text-xs text-gray-500 mt-0.5">CP: {req.charge_point_id}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0">{formatTime(req.requested_at)}</span>
                    </div>

                    {req.reason && (
                      <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2 mb-3">
                        {req.reason}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <label className="text-xs text-gray-400 whitespace-nowrap">Sesi tambahan:</label>
                        <input type="number" min={1} max={50}
                          value={extraSessions[req.id] ?? 1}
                          onChange={(e) => setExtraSessions({ ...extraSessions, [req.id]: Number(e.target.value) })}
                          className="w-16 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-emerald-500" />
                      </div>
                      <button
                        onClick={() => rejectMut.mutate(req.id)}
                        disabled={rejectMut.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs rounded-lg transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Tolak
                      </button>
                      <button
                        onClick={() => approveMut.mutate({ id: req.id, extra: extraSessions[req.id] ?? 1 })}
                        disabled={approveMut.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs rounded-lg transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Setujui
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resolved requests */}
          {resolved.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-3">Riwayat Request</p>
              <div className="space-y-2">
                {resolved.map((req) => (
                  <div key={req.id} className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-white">{req.customer_name}</p>
                        <p className="text-xs font-mono text-gray-500">{req.id_tag}</p>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${requestStatusColor[req.status]}`}>
                          {req.status}
                        </span>
                        {req.status === "Approved" && (
                          <p className="text-xs text-blue-400 mt-0.5">+{req.extra_sessions} sesi</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && requests.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40">
              <ShieldAlert className="w-10 h-10 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Belum ada request</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────

function DetailPanel({ customer, onClose, onDelete }: {
  customer: Customer; onClose: () => void; onDelete: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editingLimit, setEditLimit] = useState(false);
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.phone ?? "",
    car_brand: customer.car_brand ?? "",
    car_model: customer.car_model ?? "",
  });
  const [limitForm, setLimitForm] = useState({
    monthly_charge_limit: customer.monthly_charge_limit,
    charge_limit_enabled: customer.charge_limit_enabled,
  });

  const { data: transactions } = useQuery<Transaction[]>({
    queryKey: ["customer-transactions", customer.id],
    queryFn: () => api.get(`/api/customers/${customer.id}/transactions?limit=5`).then((r) => r.data),
  });

  const { data: usage } = useQuery<UsageInfo>({
    queryKey: ["limit-usage-customer", customer.id],
    queryFn: () => api.get(`/api/charging-limit/usage/${customer.id}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  const updateMut = useMutation({
    mutationFn: (data: typeof form) => api.put(`/api/customers/${customer.id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); setEditing(false); },
  });

  // ── ID Tag (RFID) management ──
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState("");

  const addTagMut = useMutation({
    mutationFn: (id_tag: string) =>
      api.post(`/api/customers/${customer.id}/id-tags`, { id_tag, status: "Accepted" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setNewTag(""); setShowAddTag(false); setTagError("");
    },
    onError: (err: AxiosError<{ detail?: string }>) => setTagError(err.response?.data?.detail ?? "Gagal menambahkan ID Tag"),
  });

  const updateTagStatusMut = useMutation({
    mutationFn: ({ tagId, status: newStatus }: { tagId: number; status: string }) =>
      api.put(`/api/id-tags/${tagId}`, { status: newStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });

  const deleteTagMut = useMutation({
    mutationFn: (tagId: number) => api.delete(`/api/id-tags/${tagId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });

  const updateLimitMut = useMutation({
    mutationFn: (data: typeof limitForm) =>
      api.put(`/api/customers/${customer.id}/limit`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["limit-usage"] });
      qc.invalidateQueries({ queryKey: ["limit-usage-customer", customer.id] });
      setEditLimit(false);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-md bg-gray-900 border-l border-gray-800 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <div className="flex items-center gap-3">
            <Avatar name={customer.name} />
            <div>
              <h2 className="text-sm font-semibold text-white">{customer.name}</h2>
              <p className="text-xs text-gray-500">{customer.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setEditing(!editing)}
              className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => { if (confirm(`Hapus ${customer.name}?`)) onDelete(customer.id); }}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* Ringkasan jumlah RFID */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border text-gray-300 bg-gray-800/60 border-gray-700">
              <Tag className="w-3 h-3" /> {customer.id_tags.length} RFID terdaftar
            </span>
            {customer.id_tags.some((t) => t.status === "Blocked") && (
              <span className="px-2.5 py-1 rounded-lg text-xs font-medium border text-red-400 bg-red-500/10 border-red-500/20">
                Ada RFID diblokir
              </span>
            )}
          </div>

          {/* Edit info */}
          {editing ? (
            <div className="space-y-3">
              <Field label="Nama" required>
                <input className={inputCls} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="No. Telepon">
                <input className={inputCls} value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Merek Mobil">
                <input className={inputCls} value={form.car_brand}
                  onChange={(e) => setForm({ ...form, car_brand: e.target.value })} />
              </Field>
              <Field label="Model Mobil">
                <input className={inputCls} value={form.car_model}
                  onChange={(e) => setForm({ ...form, car_model: e.target.value })} />
              </Field>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)}
                  className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg hover:bg-gray-700 transition-colors">
                  Batal
                </button>
                <button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending}
                  className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors disabled:opacity-50">
                  {updateMut.isPending ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <InfoRow label="No. Telepon" value={customer.phone ?? "-"} />
              <InfoRow label="Kendaraan" value={customer.car_brand ? `${customer.car_brand} ${customer.car_model}` : "-"} />
              <InfoRow label="Tipe" value={customer.car_type} />
              <InfoRow label="Terdaftar" value={formatDate(customer.created_at)} />
            </div>
          )}

          {/* ── RFID / ID Tag Management ── */}
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-emerald-400" />
                <p className="text-xs font-semibold text-gray-300">RFID / ID Tag ({customer.id_tags.length})</p>
              </div>
              <button onClick={() => setShowAddTag(!showAddTag)}
                className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1">
                <Plus className="w-3 h-3" /> Tambah
              </button>
            </div>

            <div className="p-4 space-y-2.5">
              {tagError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <p className="text-xs text-red-400">{tagError}</p>
                </div>
              )}

              {showAddTag && (
                <div className="flex gap-2 pb-2 border-b border-gray-800">
                  <input
                    className={`${inputCls} flex-1`}
                    placeholder="RFID / Token baru"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                  />
                  <button
                    onClick={() => newTag.trim() && addTagMut.mutate(newTag.trim())}
                    disabled={addTagMut.isPending || !newTag.trim()}
                    className="px-3 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-gray-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap">
                    {addTagMut.isPending ? "..." : "Simpan"}
                  </button>
                </div>
              )}

              {customer.id_tags.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-3">Belum ada RFID terdaftar</p>
              ) : (
                customer.id_tags.map((tag) => (
                  <div key={tag.id} className="flex items-center justify-between gap-2 bg-gray-800/40 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-white truncate">{tag.id_tag}</p>
                      {tag.expiry_date && (
                        <p className="text-xs text-gray-500">Exp: {formatDate(tag.expiry_date)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <select
                        value={tag.status}
                        onChange={(e) => updateTagStatusMut.mutate({ tagId: tag.id, status: e.target.value })}
                        className={`text-xs font-medium rounded-md border px-2 py-1 bg-gray-900 focus:outline-none ${statusColor[tag.status] ?? statusColor.Invalid}`}
                      >
                        {["Accepted", "Blocked", "Expired", "Invalid", "ConcurrentTx"].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => { if (confirm(`Hapus RFID ${tag.id_tag}?`)) deleteTagMut.mutate(tag.id); }}
                        className="p-1 rounded-md hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Charging Limit Section ── */}
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-800/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-xs font-semibold text-gray-300">Batas Charging Bulanan</p>
              </div>
              <button onClick={() => setEditLimit(!editingLimit)}
                className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1">
                <Settings className="w-3 h-3" /> Atur
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* Usage bar */}
              {usage && <UsageBar usage={usage} />}

              {/* Over limit warning */}
              {usage?.is_over_limit && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">
                    Customer telah mencapai batas charging bulan ini. Charging akan ditolak oleh OCPP
                    hingga bulan depan atau admin memberikan akses sementara.
                  </p>
                </div>
              )}

              {/* Edit limit form */}
              {editingLimit && (
                <div className="space-y-3 pt-2 border-t border-gray-700">
                  <Field label="Override Limit (kosongkan = ikut global)">
                    <input type="number" min={1} max={9999}
                      value={limitForm.monthly_charge_limit ?? ""}
                      placeholder="Ikut setting global"
                      onChange={(e) => setLimitForm({
                        ...limitForm,
                        monthly_charge_limit: e.target.value ? Number(e.target.value) : null,
                      })}
                      className={inputCls} />
                  </Field>
                  <Field label="Status Limit">
                    <div className="flex items-center gap-3 mt-1">
                      <button
                        onClick={() => setLimitForm({ ...limitForm, charge_limit_enabled: !limitForm.charge_limit_enabled })}
                        className={`relative w-11 h-6 rounded-full transition-colors ${limitForm.charge_limit_enabled ? "bg-emerald-500" : "bg-gray-600"}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${limitForm.charge_limit_enabled ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                      <span className="text-sm text-gray-300">
                        {limitForm.charge_limit_enabled ? "Limit aktif" : "Tidak dibatasi"}
                      </span>
                    </div>
                  </Field>
                  <div className="flex gap-2">
                    <button onClick={() => setEditLimit(false)}
                      className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg hover:bg-gray-700 transition-colors">
                      Batal
                    </button>
                    <button onClick={() => updateLimitMut.mutate(limitForm)} disabled={updateLimitMut.isPending}
                      className="flex-1 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs rounded-lg transition-colors disabled:opacity-50">
                      {updateLimitMut.isPending ? "Menyimpan..." : "Simpan"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Transaksi terakhir */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-3">Transaksi Terakhir</p>
            {!transactions || transactions.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Belum ada transaksi</p>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between bg-gray-800/40 rounded-xl p-3">
                    <div>
                      <p className="text-xs font-medium text-white">{tx.charge_point_id}</p>
                      <p className="text-xs text-gray-500">{formatTime(tx.start_timestamp)}</p>
                    </div>
                    <div className="text-right">
                      {tx.energy_consumed_kwh != null && (
                        <p className="text-xs text-emerald-400">{tx.energy_consumed_kwh} kWh</p>
                      )}
                      {tx.total_cost != null && (
                        <p className="text-xs text-gray-400">{formatIDR(tx.total_cost)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add Modal ─────────────────────────────────────────────────

function AddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [error, setError] = useState("");

  const createMut = useMutation({
    mutationFn: (data: CustomerForm) => api.post("/api/customers", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); onClose(); },
    onError: (err: AxiosError<{ detail?: string }>) => setError(err.response?.data?.detail ?? "Gagal membuat customer"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <h2 className="text-sm font-semibold text-white">Tambah Customer</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <Field label="Nama Lengkap" required>
            <input className={inputCls} placeholder="John Doe" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" required>
            <input type="email" className={inputCls} placeholder="john@example.com" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="No. Telepon">
            <input className={inputCls} placeholder="08xxxxxxxxxx" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Merek Mobil">
              <input className={inputCls} placeholder="Toyota" value={form.car_brand}
                onChange={(e) => setForm({ ...form, car_brand: e.target.value })} />
            </Field>
            <Field label="Model Mobil">
              <input className={inputCls} placeholder="bZ4X" value={form.car_model}
                onChange={(e) => setForm({ ...form, car_model: e.target.value })} />
            </Field>
          </div>
          <Field label="Tipe Kendaraan">
            <select className={inputCls} value={form.car_type}
              onChange={(e) => setForm({ ...form, car_type: e.target.value })}>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </Field>
          <Field label="ID Tag (RFID) Pertama" required>
            <input className={inputCls} placeholder="RFID / Token unik" value={form.id_tag}
              onChange={(e) => setForm({ ...form, id_tag: e.target.value })} />
            <p className="text-xs text-gray-600 mt-1">RFID tambahan bisa ditambahkan nanti dari detail customer</p>
          </Field>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg hover:bg-gray-700 transition-colors">
              Batal
            </button>
            <button onClick={() => createMut.mutate(form)} disabled={createMut.isPending || !form.name || !form.email || !form.id_tag}
              className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
              {createMut.isPending ? "Menyimpan..." : "Tambah Customer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function CustomersPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: customers = [], isLoading, refetch } = useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: () => api.get("/api/customers?limit=100").then((r) => r.data),
    refetchInterval: 30000,
  });

  // Derive customer terpilih langsung dari cache `customers` (bukan snapshot
  // terpisah) supaya DetailPanel selalu menampilkan data id_tags terbaru
  // setelah tambah/edit/hapus RFID, tanpa perlu effect tambahan.
  const selected = selectedId != null ? (customers.find((c) => c.id === selectedId) ?? null) : null;

  const { data: usageList = [] } = useQuery<UsageInfo[]>({
    queryKey: ["limit-usage"],
    queryFn: () => api.get("/api/charging-limit/usage").then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: limitRequests = [] } = useQuery<LimitRequest[]>({
    queryKey: ["limit-requests"],
    queryFn: () => api.get("/api/charging-limit/requests?status=Pending").then((r) => r.data),
    refetchInterval: 15000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/customers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); setSelectedId(null); },
  });

  const usageMap = new Map(usageList.map((u) => [u.customer_id, u]));
  const pendingCount = limitRequests.length;
  const overLimitCount = usageList.filter((u) => u.is_over_limit).length;

  const filtered = customers.filter((c) => {
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      c.id_tags.some((t) => t.id_tag.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === "all" || c.id_tags.some((t) => t.status === statusFilter);
    return matchSearch && matchStatus;
  });

  const statuses = ["all", "Accepted", "Blocked", "Expired", "Invalid"];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers.length} pelanggan terdaftar</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Pending requests badge */}
          <button onClick={() => setShowRequests(true)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${pendingCount > 0
              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}>
            <ShieldAlert className="w-3.5 h-3.5" />
            Request Akses
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-500 text-gray-950 text-xs font-bold rounded-md">
                {pendingCount}
              </span>
            )}
          </button>

          <button onClick={() => setShowConfig(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs rounded-lg transition-colors">
            <Settings className="w-3.5 h-3.5" /> Limit Global
          </button>

          <button onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Tambah Customer
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { label: "Total", value: customers.length, color: "text-white" },
          { label: "RFID Accepted", value: customers.filter((c) => c.id_tags.some((t) => t.status === "Accepted")).length, color: "text-emerald-400" },
          { label: "RFID Blocked", value: customers.filter((c) => c.id_tags.some((t) => t.status === "Blocked")).length, color: "text-red-400" },
          { label: "RFID Expired", value: customers.filter((c) => c.id_tags.some((t) => t.status === "Expired")).length, color: "text-amber-400" },
          { label: "Over Limit Bulan Ini", value: overLimitCount, color: overLimitCount > 0 ? "text-red-400" : "text-gray-500" },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Over-limit alert */}
      {overLimitCount > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">
            <span className="font-semibold">{overLimitCount} customer</span> telah mencapai batas charging bulan ini.
            Charging mereka akan otomatis ditolak.
          </p>
          <button onClick={() => setShowRequests(true)}
            className="ml-auto text-xs text-red-400 hover:text-red-300 whitespace-nowrap underline">
            Lihat Request →
          </button>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <input
            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
            placeholder="Cari nama, email, atau id tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {statuses.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {s === "all" ? "Semua" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-gray-900 border border-gray-800 rounded-xl">
          <Users className="w-10 h-10 text-gray-700 mb-3" />
          <p className="text-sm text-gray-500">{search ? "Tidak ada hasil pencarian" : "Belum ada customer"}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Pelanggan</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Kontak</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Kendaraan</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">ID Tag (RFID)</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Limit Bulan Ini</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Terdaftar</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const usage = usageMap.get(c.id);
                return (
                  <tr key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} />
                        <span className="text-sm font-medium text-white">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate max-w-36">{c.email}</span>
                        </div>
                        {c.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Phone className="w-3 h-3 flex-shrink-0" />
                            {c.phone}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.car_brand ? (
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Car className="w-3 h-3 flex-shrink-0" />
                          {c.car_brand} {c.car_model}
                        </div>
                      ) : <span className="text-xs text-gray-600">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.id_tags.length === 0 ? (
                        <span className="text-xs text-gray-600">Belum ada RFID</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-56">
                          <IdTagBadge tag={c.id_tags[0]} />
                          {c.id_tags.length > 1 && (
                            <span className="px-1.5 py-0.5 rounded-md text-xs text-gray-500 bg-gray-800 border border-gray-700">
                              +{c.id_tags.length - 1} lainnya
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-36">
                      {usage ? (
                        usage.limit_enabled && usage.effective_limit != null ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className={usage.is_over_limit ? "text-red-400 font-medium" : "text-gray-400"}>
                                {usage.used_this_month}/{usage.effective_limit}
                              </span>
                              {usage.is_over_limit
                                ? <span className="text-red-400 text-xs flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> Over</span>
                                : <span className="text-gray-600 text-xs">{usage.remaining} sisa</span>
                              }
                            </div>
                            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${usage.is_over_limit ? "bg-red-500" : usage.used_this_month / usage.effective_limit >= 0.8 ? "bg-amber-500" : "bg-emerald-500"}`}
                                style={{ width: `${Math.min((usage.used_this_month / usage.effective_limit) * 100, 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">Tidak dibatasi</span>
                        )
                      ) : (
                        <span className="text-xs text-gray-700">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Menampilkan {filtered.length} dari {customers.length} customer
            </p>
          </div>
        </div>
      )}

      {/* Modals & Panels */}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {showConfig && <GlobalConfigModal onClose={() => setShowConfig(false)} />}
      {showRequests && <RequestsPanel onClose={() => setShowRequests(false)} />}
      {selected && (
        <DetailPanel
          customer={selected}
          onClose={() => setSelectedId(null)}
          onDelete={(id) => deleteMut.mutate(id)}
        />
      )}
    </div>
  );
}
