"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, Users, Receipt, Sliders, Plus, X,
  RefreshCw, Trash2, Check, ShieldCheck, ShieldOff,
  KeyRound, Eye, EyeOff, Zap,
} from "lucide-react";
import api from "@/lib/axios";
import { useAuth } from "@/context/AuthContext";

// ── Types ─────────────────────────────────────────────────────
interface User {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface Tariff {
  id: number;
  charge_point_id: string;
  cost_per_kwh: number;
  currency: string;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

interface ChargePoint {
  charge_point_id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────
const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors";

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium" });

const roleColor: Record<string, string> = {
  SuperAdmin: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Admin:      "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Guest:      "text-gray-400 bg-gray-700/50 border-gray-600",
};

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  TAB 1 — MANAJEMEN USER
// ════════════════════════════════════════════════════════════
function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [showAdd, setShowAdd]     = useState(false);
  const [editId, setEditId]       = useState<number | null>(null);
  const [editRole, setEditRole]   = useState("");
  const [showPwForm, setShowPw]   = useState<number | null>(null);
  const [newPw, setNewPw]         = useState("");
  const [showPw, setShowPw2]      = useState(false);

  const { data: users = [], isLoading, refetch } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/api/users").then((r) => r.data),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.put(`/api/users/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setEditId(null); setShowPw(null); setNewPw(""); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{users.length} user terdaftar</p>
        <div className="flex gap-2">
          <button onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Tambah User
          </button>
        </div>
      </div>

      {/* Add User Form */}
      {showAdd && <AddUserForm onClose={() => setShowAdd(false)} />}

      {/* User list */}
      {isLoading ? (
        <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-gray-500" /></div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="bg-gray-800/50 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {u.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{u.username}</p>
                      {u.username === me?.username && (
                        <span className="text-xs text-gray-500">(saya)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${roleColor[u.role] ?? roleColor.Guest}`}>
                        {u.role}
                      </span>
                      <span className={`text-xs ${u.is_active ? "text-emerald-400" : "text-red-400"}`}>
                        {u.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                      <span className="text-xs text-gray-600">· {formatDate(u.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Actions — hanya untuk bukan diri sendiri */}
                {u.username !== me?.username && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Toggle active */}
                    <button
                      onClick={() => updateMut.mutate({ id: u.id, data: { is_active: !u.is_active } })}
                      title={u.is_active ? "Nonaktifkan" : "Aktifkan"}
                      className={`p-1.5 rounded-lg transition-colors ${
                        u.is_active
                          ? "hover:bg-red-500/10 text-gray-500 hover:text-red-400"
                          : "hover:bg-emerald-500/10 text-gray-500 hover:text-emerald-400"
                      }`}>
                      {u.is_active ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    </button>
                    {/* Edit role */}
                    <button onClick={() => { setEditId(u.id); setEditRole(u.role); }}
                      className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-white transition-colors">
                      <Sliders className="w-4 h-4" />
                    </button>
                    {/* Reset password */}
                    <button onClick={() => setShowPw(showPwForm === u.id ? null : u.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-white transition-colors">
                      <KeyRound className="w-4 h-4" />
                    </button>
                    {/* Delete */}
                    <button onClick={() => { if (confirm(`Hapus user ${u.username}?`)) deleteMut.mutate(u.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Edit role inline */}
              {editId === u.id && (
                <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2">
                  <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
                    <option value="SuperAdmin">SuperAdmin</option>
                    <option value="Admin">Admin</option>
                    <option value="Guest">Guest</option>
                  </select>
                  <button onClick={() => updateMut.mutate({ id: u.id, data: { role: editRole } })}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-medium text-xs rounded-lg transition-colors">
                    <Check className="w-3.5 h-3.5" /> Simpan
                  </button>
                  <button onClick={() => setEditId(null)}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors">
                    Batal
                  </button>
                </div>
              )}

              {/* Reset password inline */}
              {showPwForm === u.id && (
                <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showPw ? "text" : "password"}
                      placeholder="Password baru"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                    />
                    <button onClick={() => setShowPw2(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button onClick={() => updateMut.mutate({ id: u.id, data: { password: newPw } })}
                    disabled={!newPw || newPw.length < 6}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-medium text-xs rounded-lg transition-colors">
                    <Check className="w-3.5 h-3.5" /> Reset
                  </button>
                  <button onClick={() => { setShowPw(null); setNewPw(""); }}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors">
                    Batal
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add User Form ─────────────────────────────────────────────
function AddUserForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: "", password: "", role: "Admin" });
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);

  const addMut = useMutation({
    mutationFn: () => api.post("/api/auth/register", form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); onClose(); },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Gagal menambah user"),
  });

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-white">Tambah User Baru</p>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Username" required>
          <input className={inputCls} placeholder="johndoe" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Password" required>
          <div className="relative">
            <input type={showPw ? "text" : "password"} className={inputCls}
              placeholder="Min. 6 karakter" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </Field>
        <Field label="Role" required>
          <select className={inputCls} value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="SuperAdmin">SuperAdmin</option>
            <option value="Admin">Admin</option>
            <option value="Guest">Guest</option>
          </select>
        </Field>
      </div>
      {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose}
          className="px-4 py-2 text-sm text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
          Batal
        </button>
        <button onClick={() => addMut.mutate()}
          disabled={addMut.isPending || !form.username || form.password.length < 6}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold rounded-lg transition-colors">
          {addMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Tambah
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  TAB 2 — TARIF
// ════════════════════════════════════════════════════════════
function TariffsTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ charge_point_id: "", cost_per_kwh: "", currency: "IDR" });
  const [error, setError] = useState("");

  const { data: tariffs = [], isLoading, refetch } = useQuery<Tariff[]>({
    queryKey: ["tariffs"],
    queryFn: () => api.get("/api/tariffs").then((r) => r.data),
  });

  const { data: chargePoints = [] } = useQuery<ChargePoint[]>({
    queryKey: ["cp-list-simple"],
    queryFn: () => api.get("/api/charge-points").then((r) => r.data),
  });

  const addMut = useMutation({
    mutationFn: () => api.post("/api/tariffs", {
      charge_point_id: form.charge_point_id,
      cost_per_kwh: parseFloat(form.cost_per_kwh),
      currency: form.currency,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tariffs"] }); setShowAdd(false); setForm({ charge_point_id: "", cost_per_kwh: "", currency: "IDR" }); },
    onError: (e: any) => setError(e.response?.data?.detail ?? "Gagal menambah tarif"),
  });

  const activateMut = useMutation({
    mutationFn: (id: number) => api.put(`/api/tariffs/${id}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tariffs"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/tariffs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tariffs"] }),
  });

  // Group tariffs by charge_point_id
  const grouped = tariffs.reduce((acc: Record<string, Tariff[]>, t) => {
    if (!acc[t.charge_point_id]) acc[t.charge_point_id] = [];
    acc[t.charge_point_id].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{tariffs.length} riwayat tarif</p>
        <div className="flex gap-2">
          <button onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Tambah Tarif
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-white">Tarif Baru</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Charge Point" required>
              <select className={inputCls} value={form.charge_point_id}
                onChange={(e) => setForm({ ...form, charge_point_id: e.target.value })}>
                <option value="">Pilih CP</option>
                {chargePoints.map((cp) => (
                  <option key={cp.charge_point_id} value={cp.charge_point_id}>
                    {cp.charge_point_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tarif (Rp/kWh)" required>
              <input type="number" className={inputCls} placeholder="2500"
                value={form.cost_per_kwh}
                onChange={(e) => setForm({ ...form, cost_per_kwh: e.target.value })} />
            </Field>
            <Field label="Mata Uang">
              <select className={inputCls} value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="IDR">IDR</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">Batal</button>
            <button onClick={() => addMut.mutate()}
              disabled={addMut.isPending || !form.charge_point_id || !form.cost_per_kwh}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold rounded-lg transition-colors">
              {addMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Simpan
            </button>
          </div>
        </div>
      )}

      {/* Grouped list */}
      {isLoading ? (
        <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-gray-500" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 bg-gray-800/50 border border-gray-800 rounded-xl">
          <Receipt className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-sm text-gray-500">Belum ada tarif</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cpId, cpTariffs]) => (
            <div key={cpId} className="bg-gray-800/50 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-sm font-medium text-white font-mono">{cpId}</span>
              </div>
              <div className="divide-y divide-gray-800">
                {cpTariffs.map((t) => (
                  <div key={t.id} className={`px-4 py-3 flex items-center justify-between gap-4 ${t.is_active ? "bg-emerald-500/5" : ""}`}>
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {formatIDR(t.cost_per_kwh)}/kWh
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(t.created_at)}</p>
                      </div>
                      {t.is_active && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                          Aktif
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!t.is_active && (
                        <button onClick={() => activateMut.mutate(t.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
                          <Check className="w-3 h-3" /> Aktifkan
                        </button>
                      )}
                      <button onClick={() => { if (confirm("Hapus tarif ini?")) deleteMut.mutate(t.id); }}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  TAB 3 — KONFIGURASI SISTEM
// ════════════════════════════════════════════════════════════
function SystemTab() {
  const info = [
    { label: "Versi ZEUS CSMS",    value: "0.3.0"               },
    { label: "OCPP Protocol",      value: "OCPP 1.6 JSON"        },
    { label: "OCPP Server Port",   value: "9000"                 },
    { label: "API Server Port",    value: "8000"                 },
    { label: "Database",           value: "MySQL 8.x"            },
    { label: "Backend Framework",  value: "FastAPI + Python 3.11" },
    { label: "Frontend Framework", value: "Next.js 16 + Tailwind" },
  ];

  return (
    <div className="space-y-5">
      {/* System info */}
      <div className="bg-gray-800/50 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-sm font-medium text-white">Informasi Sistem</p>
        </div>
        <div className="divide-y divide-gray-800">
          {info.map(({ label, value }) => (
            <div key={label} className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-gray-500">{label}</span>
              <span className="text-xs font-medium text-gray-200">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Role permissions */}
      <div className="bg-gray-800/50 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-sm font-medium text-white">Hak Akses per Role</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Fitur</th>
                <th className="px-4 py-2.5 text-center text-purple-400 font-medium">SuperAdmin</th>
                <th className="px-4 py-2.5 text-center text-blue-400 font-medium">Admin</th>
                <th className="px-4 py-2.5 text-center text-gray-400 font-medium">Guest</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "Lihat Dashboard",        sa: true,  ad: true,  gu: true  },
                { feature: "Lihat Charge Points",    sa: true,  ad: true,  gu: true  },
                { feature: "Tambah / Edit CP",       sa: true,  ad: true,  gu: false },
                { feature: "Lihat Customers",        sa: true,  ad: true,  gu: true  },
                { feature: "Tambah / Edit Customer", sa: true,  ad: true,  gu: false },
                { feature: "Lihat Transaksi",        sa: true,  ad: true,  gu: true  },
                { feature: "Kelola Tarif",           sa: true,  ad: true,  gu: false },
                { feature: "Resolve Alerts",         sa: true,  ad: true,  gu: false },
                { feature: "Manajemen User",         sa: true,  ad: false, gu: false },
                { feature: "Hapus Data",             sa: true,  ad: false, gu: false },
              ].map(({ feature, sa, ad, gu }) => (
                <tr key={feature} className="border-b border-gray-800/50">
                  <td className="px-4 py-2.5 text-gray-300">{feature}</td>
                  {[sa, ad, gu].map((v, i) => (
                    <td key={i} className="px-4 py-2.5 text-center">
                      {v
                        ? <span className="text-emerald-400">✓</span>
                        : <span className="text-gray-700">✗</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  MAIN PAGE
// ════════════════════════════════════════════════════════════
const tabs = [
  { id: "users",   icon: Users,    label: "Manajemen User" },
  { id: "tariffs", icon: Receipt,  label: "Tarif"          },
  { id: "system",  icon: Sliders,  label: "Sistem"         },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Pengaturan</h1>
        <p className="text-sm text-gray-500 mt-0.5">Kelola user, tarif, dan konfigurasi sistem</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === id
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {activeTab === "users"   && <UsersTab />}
        {activeTab === "tariffs" && <TariffsTab />}
        {activeTab === "system"  && <SystemTab />}
      </div>
    </div>
  );
}
