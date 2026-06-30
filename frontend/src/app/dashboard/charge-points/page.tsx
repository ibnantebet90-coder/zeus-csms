"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, X, Wifi, WifiOff, MapPin, Zap, RefreshCw,
  Pencil, Trash2, Check, ChevronRight, ChevronDown,
  Activity, Server,
} from "lucide-react";
import EvChargerIcon from "@/components/EvChargerIcon";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────
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
  firmware_version: string | null;
  serial_number: string | null;
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

// ── Helpers ────────────────────────────────────────────────────
const statusColor: Record<string, string> = {
  Available: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Charging: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Faulted: "text-red-400 bg-red-500/10 border-red-500/20",
  Unavailable: "text-gray-400 bg-gray-700/50 border-gray-600/20",
  Preparing: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Finishing: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Reserved: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  Unknown: "text-gray-500 bg-gray-800 border-gray-700",
};

const connectorBg: Record<string, string> = {
  Available: "bg-emerald-500 text-white",
  Charging: "bg-blue-500 text-white",
  Faulted: "bg-red-500 text-white",
  Unavailable: "bg-gray-600 text-gray-300",
  Preparing: "bg-amber-500 text-white",
  Finishing: "bg-purple-500 text-white",
  Unknown: "bg-gray-700 text-gray-400",
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const emptyForm: CPForm = {
  charge_point_id: "", name: "", address: "",
  latitude: "", longitude: "", number_of_connectors: "1", tariff_per_kwh: "0",
};

const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors";

// ── Field wrapper ─────────────────────────────────────────────
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

// ── Connector Badge ───────────────────────────────────────────
function ConnectorBadge({ connector }: { connector: Connector }) {
  const label = String.fromCharCode(64 + connector.connector_id); // A, B, C...
  const bg = connectorBg[connector.status] ?? connectorBg.Unknown;
  const isCharging = connector.status === "Charging";
  return (
    <div className="relative inline-flex" title={`Connector ${label}: ${connector.status}`}>
      {isCharging && (
        <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-40" />
      )}
      <span className={`relative w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${bg} ring-2 ring-gray-900`}>
        {label}
      </span>
    </div>
  );
}

// ── Expanded Row ──────────────────────────────────────────────
function ExpandedRow({ cp }: { cp: ChargePoint }) {
  return (
    <tr className="bg-gray-950/60">
      <td colSpan={9} className="px-0 py-0">
        <div className="mx-4 my-3 border border-gray-800 rounded-xl overflow-hidden">
          {/* Sub-table header */}
          <div className="grid grid-cols-5 bg-gray-900 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-800">
            <span>Connector</span>
            <span>Status</span>
            <span>Error Code</span>
            <span>Tarif</span>
            <span>Alamat</span>
          </div>

          {/* Connector rows */}
          {cp.connectors && cp.connectors.length > 0 ? (
            cp.connectors.map((c) => (
              <div key={c.connector_id} className="grid grid-cols-5 px-4 py-3 text-sm border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors">
                <div className="flex items-center gap-2">
                  <ConnectorBadge connector={c} />
                  <span className="text-gray-300 text-xs">Connector {c.connector_id}</span>
                </div>
                <div>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusColor[c.status] ?? statusColor.Unknown}`}>
                    {c.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 flex items-center">
                  {c.error_code && c.error_code !== "NoError" ? (
                    <span className="text-red-400">{c.error_code}</span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>
                <div className="text-xs text-gray-300 flex items-center">
                  {formatIDR(cp.tariff_per_kwh)}/kWh
                </div>
                <div className="text-xs text-gray-500 flex items-center truncate">
                  {cp.address ?? "—"}
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-4 text-xs text-gray-600 text-center">
              Belum ada data konektor
            </div>
          )}

          {/* Footer info */}
          <div className="grid grid-cols-4 gap-4 px-4 py-3 bg-gray-900/50 border-t border-gray-800 text-xs">
            <div>
              <span className="text-gray-600">Serial Number</span>
              <p className="text-gray-300 font-mono mt-0.5">{cp.serial_number ?? "—"}</p>
            </div>
            <div>
              <span className="text-gray-600">Firmware</span>
              <p className="text-gray-300 font-mono mt-0.5">{cp.firmware_version ?? "—"}</p>
            </div>
            <div>
              <span className="text-gray-600">Koordinat</span>
              <p className="text-gray-300 mt-0.5">
                {cp.latitude && cp.longitude ? `${cp.latitude}, ${cp.longitude}` : "—"}
              </p>
            </div>
            <div>
              <span className="text-gray-600">Last Heartbeat</span>
              <p className="text-gray-300 mt-0.5">{formatTime(cp.last_heartbeat)}</p>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Edit Modal ────────────────────────────────────────────────
function EditModal({ cp, onClose }: { cp: ChargePoint; onClose: () => void }) {
  const qc = useQueryClient();
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
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Edit Charge Point</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{cp.charge_point_id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
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
        </div>
        <div className="px-5 py-4 border-t border-gray-800 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Batal
          </button>
          <button onClick={() => updateMut.mutate(form)} disabled={updateMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors">
            {updateMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Simpan
          </button>
        </div>
      </div>
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
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Tambah Charge Point</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Charge Point ID" required>
            <input className={inputCls} placeholder="CP001" value={form.charge_point_id} onChange={set("charge_point_id")} />
            <p className="text-xs text-gray-600 mt-1">Harus sama dengan ID yang dikonfigurasi di perangkat</p>
          </Field>
          <Field label="Nama" required>
            <input className={inputCls} placeholder="SPKLU Jakarta 01" value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Alamat">
            <input className={inputCls} placeholder="Jl. Sudirman No. 1, Jakarta" value={form.address} onChange={set("address")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <input type="number" step="any" className={inputCls} placeholder="-6.2088" value={form.latitude} onChange={set("latitude")} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="any" className={inputCls} placeholder="106.8456" value={form.longitude} onChange={set("longitude")} />
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
        <div className="px-5 py-4 border-t border-gray-800 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Batal
          </button>
          <button onClick={() => addMut.mutate(form)} disabled={addMut.isPending || !form.charge_point_id || !form.name}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors">
            {addMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Tambah
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Table Row ─────────────────────────────────────────────────
function CPRow({ cp, onEdit, onDelete }: {
  cp: ChargePoint;
  onEdit: (cp: ChargePoint) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors cursor-pointer group"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand toggle */}
        <td className="px-3 py-3 w-8">
          <button className="text-gray-500 hover:text-gray-300 transition-colors">
            {expanded
              ? <ChevronDown className="w-4 h-4" />
              : <ChevronRight className="w-4 h-4" />
            }
          </button>
        </td>

        {/* Actions */}
        <td className="px-3 py-3 w-20" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(cp)}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-blue-400 transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { if (confirm(`Hapus ${cp.name}?`)) onDelete(cp.charge_point_id); }}
              className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
              title="Hapus"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>

        {/* Name */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2.5">
            <EvChargerIcon status={cp.is_online ? cp.cp_status : "Unavailable"} size={22} />
            <div>
              <p className="text-sm font-medium text-white">{cp.name}</p>
              <p className="text-xs font-mono text-gray-500">{cp.charge_point_id}</p>
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {cp.is_online
              ? <Wifi className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              : <WifiOff className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
            }
            <span className={`px-2 py-0.5 rounded-md text-xs font-medium border transition-colors ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
              {cp.cp_status}
            </span>
          </div>
        </td>

        {/* Connectors */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            {cp.connectors && cp.connectors.length > 0 ? (
              cp.connectors.map((c) => (
                <ConnectorBadge key={c.connector_id} connector={c} />
              ))
            ) : (
              <span className="text-xs text-gray-600">—</span>
            )}
          </div>
        </td>

        {/* Location */}
        <td className="px-3 py-3 max-w-[160px]">
          {cp.address ? (
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-gray-600 flex-shrink-0" />
              <span className="text-xs text-gray-400 truncate">{cp.address}</span>
            </div>
          ) : (
            <span className="text-xs text-gray-600">—</span>
          )}
        </td>

        {/* Tariff */}
        <td className="px-3 py-3">
          <span className="text-xs text-gray-300">{formatIDR(cp.tariff_per_kwh)}/kWh</span>
        </td>

        {/* Vendor / Model */}
        <td className="px-3 py-3">
          <div>
            <p className="text-xs text-gray-300">{cp.vendor_name ?? "—"}</p>
            <p className="text-xs text-gray-600">{cp.model ?? ""}</p>
          </div>
        </td>

        {/* Last Heartbeat */}
        <td className="px-3 py-3">
          <span className="text-xs text-gray-500">{formatTime(cp.last_heartbeat)}</span>
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && <ExpandedRow cp={cp} />}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ChargePointsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<ChargePoint | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
  const qc = useQueryClient();

  const { data: chargePoints = [], isLoading, refetch } = useQuery<ChargePoint[]>({
    queryKey: ["charge-points"],
    queryFn: () => api.get("/api/charge-points").then((r) => r.data),
    refetchInterval: 15000,
  });

  const deleteMut = useMutation({
    mutationFn: (cpId: string) => api.delete(`/api/charge-points/${cpId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["charge-points"] }),
  });

  const filtered = chargePoints.filter((cp) => {
    const matchFilter =
      filter === "all" ? true :
        filter === "online" ? cp.is_online :
          !cp.is_online;
    const matchSearch =
      search === "" ? true :
        cp.name.toLowerCase().includes(search.toLowerCase()) ||
        cp.charge_point_id.toLowerCase().includes(search.toLowerCase()) ||
        (cp.address ?? "").toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const totalOnline = chargePoints.filter((cp) => cp.is_online).length;
  const totalCharging = chargePoints.filter((cp) => cp.cp_status === "Charging").length;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Charging Stations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {chargePoints.length} terdaftar · {totalOnline} online · {totalCharging} sedang mengisi
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Tambah Station
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Stations", value: chargePoints.length, icon: Server, color: "text-white", bg: "bg-gray-800", pulse: false },
          { label: "Online", value: totalOnline, icon: Wifi, color: "text-emerald-400", bg: "bg-emerald-500/10", pulse: false },
          { label: "Sedang Mengisi", value: totalCharging, icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10", pulse: totalCharging > 0 },
          { label: "Offline", value: chargePoints.length - totalOnline, icon: WifiOff, color: "text-gray-400", bg: "bg-gray-700/30", pulse: false },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3 transition-colors hover:border-gray-700">
            <div className={`p-2 rounded-lg ${s.bg} ${s.pulse ? "animate-status-glow" : ""}`} style={s.pulse ? { color: "#60a5fa" } : undefined}>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {(["all", "online", "offline"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {f === "all" ? "Semua" : f === "online" ? "Online" : "Offline"}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xs relative">
          <input
            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
            placeholder="Cari nama, ID, alamat..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <span className="text-xs text-gray-600 ml-auto">
          {filtered.length} records
        </span>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="mb-3 opacity-60">
              <EvChargerIcon status="Unavailable" size={48} />
            </div>
            <p className="text-sm text-gray-500">
              {search ? "Tidak ada hasil pencarian" : "Belum ada charging station"}
            </p>
            {!search && (
              <p className="text-xs text-gray-600 mt-1">Klik "Tambah Station" untuk mendaftarkan yang pertama</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-950/50">
                  <th className="px-3 py-3 w-8" />
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Aksi</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Nama</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Konektor</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Lokasi</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Tarif</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor / Model</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((cp) => (
                  <CPRow
                    key={cp.id}
                    cp={cp}
                    onEdit={setEditTarget}
                    onDelete={(id) => deleteMut.mutate(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {editTarget && <EditModal cp={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}