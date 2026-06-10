"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BatteryCharging, Plus, X, Wifi, WifiOff,
  MapPin, Zap, RefreshCw, ChevronRight, Pencil, Trash2, Check,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ────────────────────────────────────────────────────
interface Connector {
  connector_id: number;
  status: string;
  error_code: string | null;
}

interface ChargePoint {
  id: number;
  charge_point_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  number_of_connectors: number;
  tariff_per_kwh: number;
  cp_status: string;
  is_online: boolean;
  last_heartbeat: string | null;
  vendor_name: string | null;
  model: string | null;
  connectors: Connector[];
}

interface CPForm {
  charge_point_id: string;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  number_of_connectors: string;
  tariff_per_kwh: string;
}

// ── Constants ────────────────────────────────────────────────
const statusColor: Record<string, string> = {
  Available:   "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Charging:    "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Faulted:     "text-red-400 bg-red-500/10 border-red-500/20",
  Unavailable: "text-gray-400 bg-gray-700/50 border-gray-600/20",
  Preparing:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Finishing:   "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Reserved:    "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  Unknown:     "text-gray-500 bg-gray-800 border-gray-700",
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const emptyForm: CPForm = {
  charge_point_id: "", name: "", address: "",
  latitude: "", longitude: "", number_of_connectors: "1", tariff_per_kwh: "0",
};

// ── Input Component ──────────────────────────────────────────
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

const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors";

// ── Detail Panel ─────────────────────────────────────────────
function DetailPanel({ cp, onClose, onDelete }: {
  cp: ChargePoint;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: cp.name,
    address: cp.address ?? "",
    tariff_per_kwh: String(cp.tariff_per_kwh),
  });

  const updateMut = useMutation({
    mutationFn: (data: typeof form) =>
      api.put(`/api/charge-points/${cp.charge_point_id}`, {
        ...data,
        tariff_per_kwh: parseFloat(data.tariff_per_kwh) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["charge-points"] });
      setEditing(false);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-md bg-gray-900 border-l border-gray-800 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${cp.is_online ? "bg-emerald-400" : "bg-gray-600"}`} />
            <h2 className="text-sm font-semibold text-white">{cp.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(!editing)}
              className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => { if (confirm(`Hapus ${cp.name}?`)) onDelete(cp.charge_point_id); }}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Status badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
              {cp.cp_status}
            </span>
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${cp.is_online ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-gray-500 bg-gray-800 border-gray-700"}`}>
              {cp.is_online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {cp.is_online ? "Online" : "Offline"}
            </span>
          </div>

          {/* Edit form atau info */}
          {editing ? (
            <div className="space-y-3">
              <Field label="Nama" required>
                <input className={inputCls} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Alamat">
                <input className={inputCls} value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="Tarif (Rp/kWh)">
                <input type="number" className={inputCls} value={form.tariff_per_kwh}
                  onChange={(e) => setForm({ ...form, tariff_per_kwh: e.target.value })} />
              </Field>
              <div className="flex gap-2 pt-1">
                <button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-medium text-xs rounded-lg transition-colors disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> Simpan
                </button>
                <button onClick={() => setEditing(false)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <InfoRow label="Charge Point ID" value={cp.charge_point_id} mono />
              <InfoRow label="Nama" value={cp.name} />
              <InfoRow label="Alamat" value={cp.address ?? "-"} />
              <InfoRow label="Vendor" value={cp.vendor_name ?? "-"} />
              <InfoRow label="Model" value={cp.model ?? "-"} />
              <InfoRow label="Jumlah Konektor" value={String(cp.number_of_connectors)} />
              <InfoRow label="Tarif" value={formatIDR(cp.tariff_per_kwh) + "/kWh"} />
              <InfoRow label="Last Heartbeat" value={formatTime(cp.last_heartbeat)} />
              {cp.latitude && cp.longitude && (
                <InfoRow label="Koordinat" value={`${cp.latitude}, ${cp.longitude}`} />
              )}
            </div>
          )}

          {/* Connectors */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Konektor</p>
            {cp.connectors?.length ? (
              <div className="space-y-2">
                {cp.connectors.map((c) => (
                  <div key={c.connector_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-gray-500" />
                      <span className="text-xs text-gray-300">Konektor {c.connector_id}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusColor[c.status] ?? statusColor.Unknown}`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 bg-gray-800 rounded-lg px-3 py-3">
                Belum ada data konektor
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 flex-shrink-0 w-32">{label}</span>
      <span className={`text-xs text-right ${mono ? "font-mono text-emerald-400" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}

// ── Add Modal ─────────────────────────────────────────────────
function AddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CPForm>(emptyForm);
  const [error, setError] = useState("");

  const set = (k: keyof CPForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const addMut = useMutation({
    mutationFn: (data: CPForm) =>
      api.post("/api/charge-points", {
        charge_point_id: data.charge_point_id,
        name: data.name,
        address: data.address || null,
        latitude: data.latitude ? parseFloat(data.latitude) : null,
        longitude: data.longitude ? parseFloat(data.longitude) : null,
        number_of_connectors: parseInt(data.number_of_connectors) || 1,
        tariff_per_kwh: parseFloat(data.tariff_per_kwh) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["charge-points"] });
      onClose();
    },
    onError: (e: any) => {
      setError(e.response?.data?.detail ?? "Gagal menambah charge point");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Tambah Charge Point</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Charge Point ID" required>
            <input className={inputCls} placeholder="CP001" value={form.charge_point_id} onChange={set("charge_point_id")} />
            <p className="text-xs text-gray-600 mt-1">Harus sama dengan ID yang dikonfigurasi di perangkat</p>
          </Field>
          <Field label="Nama" required>
            <input className={inputCls} placeholder="SPKLU Bandung 01" value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Alamat">
            <input className={inputCls} placeholder="Jl. Asia Afrika No. 1, Bandung" value={form.address} onChange={set("address")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <input type="number" step="any" className={inputCls} placeholder="-6.9175" value={form.latitude} onChange={set("latitude")} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="any" className={inputCls} placeholder="107.6191" value={form.longitude} onChange={set("longitude")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jumlah Konektor" required>
              <input type="number" min="1" max="10" className={inputCls} value={form.number_of_connectors} onChange={set("number_of_connectors")} />
            </Field>
            <Field label="Tarif (Rp/kWh)">
              <input type="number" min="0" className={inputCls} placeholder="2500" value={form.tariff_per_kwh} onChange={set("tariff_per_kwh")} />
            </Field>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Batal
          </button>
          <button onClick={() => addMut.mutate(form)} disabled={addMut.isPending || !form.charge_point_id || !form.name}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold rounded-lg transition-colors">
            {addMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Tambah
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ChargePointsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<ChargePoint | null>(null);
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
  const qc = useQueryClient();

  const { data: chargePoints = [], isLoading, refetch } = useQuery<ChargePoint[]>({
    queryKey: ["charge-points"],
    queryFn: () => api.get("/api/charge-points").then((r) => r.data),
    refetchInterval: 15000,
  });

  const deleteMut = useMutation({
    mutationFn: (cpId: string) => api.delete(`/api/charge-points/${cpId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["charge-points"] });
      setSelected(null);
    },
  });

  const filtered = chargePoints.filter((cp) => {
    if (filter === "online") return cp.is_online;
    if (filter === "offline") return !cp.is_online;
    return true;
  });

  const totalOnline = chargePoints.filter((cp) => cp.is_online).length;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Charge Points</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {chargePoints.length} terdaftar · {totalOnline} online
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Tambah CP
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total", value: chargePoints.length, color: "text-white" },
          { label: "Online", value: totalOnline, color: "text-emerald-400" },
          { label: "Offline", value: chargePoints.length - totalOnline, color: "text-gray-400" },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {(["all", "online", "offline"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${filter === f ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
            {f === "all" ? "Semua" : f === "online" ? "Online" : "Offline"}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-gray-900 border border-gray-800 rounded-xl text-center">
          <BatteryCharging className="w-10 h-10 text-gray-700 mb-3" />
          <p className="text-sm text-gray-500">Belum ada charge point</p>
          <p className="text-xs text-gray-600 mt-1">Klik "Tambah CP" untuk mendaftarkan charge point pertama</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map((cp) => (
            <div key={cp.id}
              onClick={() => setSelected(cp)}
              className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 cursor-pointer transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${cp.is_online ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-gray-600"}`} />
                  <div>
                    <p className="text-sm font-semibold text-white">{cp.name}</p>
                    <p className="text-xs font-mono text-gray-500">{cp.charge_point_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
                    {cp.cp_status}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-gray-600 mb-0.5">Konektor</p>
                  <p className="text-gray-300 font-medium">{cp.number_of_connectors}</p>
                </div>
                <div>
                  <p className="text-gray-600 mb-0.5">Tarif</p>
                  <p className="text-gray-300 font-medium">{formatIDR(cp.tariff_per_kwh)}/kWh</p>
                </div>
                <div>
                  <p className="text-gray-600 mb-0.5">Heartbeat</p>
                  <p className="text-gray-300 font-medium">{formatTime(cp.last_heartbeat)}</p>
                </div>
              </div>

              {cp.address && (
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-800">
                  <MapPin className="w-3 h-3 text-gray-600 flex-shrink-0" />
                  <p className="text-xs text-gray-500 truncate">{cp.address}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {selected && (
        <DetailPanel
          cp={selected}
          onClose={() => setSelected(null)}
          onDelete={(id) => deleteMut.mutate(id)}
        />
      )}
    </div>
  );
}
