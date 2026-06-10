"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, RefreshCw, X, CheckCheck, Filter,
  AlertTriangle, AlertCircle, Info, ChevronRight, BatteryCharging,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────
interface Alert {
  id: number;
  charge_point_id: string;
  connector_id: number | null;
  timestamp: string;
  status: string;
  error_code: string | null;
  info: string | null;
  vendor_id: string | null;
  vendor_error_code: string | null;
  is_resolved: boolean;
}

interface ChargePoint {
  charge_point_id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────
const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

const timeAgo = (iso: string) => {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}d yang lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m yang lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}j yang lalu`;
  return `${Math.floor(diff / 86400)}h yang lalu`;
};

// Error severity berdasarkan error_code OCPP
const getSeverity = (errorCode: string | null, status: string) => {
  if (!errorCode || errorCode === "NoError") {
    if (status === "Faulted") return "high";
    if (status === "Unavailable") return "medium";
    return "low";
  }
  const high = ["GroundFailure", "OverCurrentFailure", "OverVoltage", "UnderVoltage",
    "PowerMeterFailure", "PowerSwitchFailure", "EVCommunicationError"];
  const med  = ["ConnectorLockFailure", "ReaderFailure", "ResetRequired", "WeakSignal"];
  if (high.some((e) => errorCode.includes(e))) return "high";
  if (med.some((e) => errorCode.includes(e)))  return "medium";
  return "low";
};

const severityConfig = {
  high:   { icon: AlertCircle,   color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20",    label: "Kritis"  },
  medium: { icon: AlertTriangle, color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20", label: "Sedang"  },
  low:    { icon: Info,          color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20",   label: "Rendah"  },
};

// ── Detail Panel ──────────────────────────────────────────────
function DetailPanel({ alert, onClose, onResolve }: {
  alert: Alert;
  onClose: () => void;
  onResolve: (id: number) => void;
}) {
  const sev = getSeverity(alert.error_code, alert.status);
  const { icon: SevIcon, color, bg, label } = severityConfig[sev];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-md bg-gray-900 border-l border-gray-800 overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${bg}`}>
              <SevIcon className={`w-4 h-4 ${color}`} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Alert #{alert.id}</h2>
              <p className="text-xs text-gray-500">{alert.charge_point_id}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${bg} ${color}`}>
              {label}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
              alert.is_resolved
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-amber-400 bg-amber-500/10 border-amber-500/20"
            }`}>
              {alert.is_resolved ? "Resolved" : "Unresolved"}
            </span>
          </div>

          {/* Detail rows */}
          <div className="space-y-3">
            {[
              { label: "Charge Point",  value: alert.charge_point_id,           mono: true  },
              { label: "Konektor",      value: alert.connector_id != null ? `Konektor ${alert.connector_id}` : "-" },
              { label: "Status",        value: alert.status                                  },
              { label: "Error Code",    value: alert.error_code ?? "NoError",    mono: true  },
              { label: "Info",          value: alert.info ?? "-"                             },
              { label: "Vendor ID",     value: alert.vendor_id ?? "-",           mono: true  },
              { label: "Vendor Error",  value: alert.vendor_error_code ?? "-",   mono: true  },
              { label: "Waktu",         value: formatTime(alert.timestamp)                   },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <span className="text-xs text-gray-500 flex-shrink-0 w-28">{label}</span>
                <span className={`text-xs text-right break-all ${mono ? "font-mono text-emerald-400" : "text-gray-200"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Resolve button */}
          {!alert.is_resolved && (
            <button onClick={() => { onResolve(alert.id); onClose(); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-xl transition-colors">
              <CheckCheck className="w-4 h-4" />
              Tandai Resolved
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function AlertsPage() {
  const [selected, setSelected]       = useState<Alert | null>(null);
  const [showFilter, setShowFilter]   = useState(false);
  const [resolvedFilter, setResolved] = useState<"all" | "unresolved" | "resolved">("unresolved");
  const [severityFilter, setSeverity] = useState("all");
  const [cpFilter, setCp]             = useState("");
  const qc = useQueryClient();

  // Ambil semua charge points untuk filter dropdown
  const { data: chargePoints = [] } = useQuery<ChargePoint[]>({
    queryKey: ["cp-list-simple"],
    queryFn: () => api.get("/api/charge-points").then((r) => r.data),
  });

  // Ambil alerts — per charge point lalu digabung
  const { data: allAlerts = [], isLoading, refetch } = useQuery<Alert[]>({
    queryKey: ["alerts-all", cpFilter],
    queryFn: async () => {
      const cps = cpFilter
        ? [{ charge_point_id: cpFilter }]
        : chargePoints;
      const results = await Promise.all(
        cps.map((cp) =>
          api.get(`/api/charge-points/${cp.charge_point_id}/alerts?limit=100`)
            .then((r) => r.data)
            .catch(() => [])
        )
      );
      return results.flat().sort(
        (a: Alert, b: Alert) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    },
    enabled: chargePoints.length > 0,
    refetchInterval: 20000,
  });

  // Resolve mutation
  const resolveMut = useMutation({
    mutationFn: (id: number) =>
      api.put(`/api/alerts/${id}`, { is_resolved: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts-all"] }),
  });

  // Filter lokal
  const filtered = allAlerts.filter((a) => {
    const sev = getSeverity(a.error_code, a.status);
    const matchResolved =
      resolvedFilter === "all" ? true :
      resolvedFilter === "resolved" ? a.is_resolved : !a.is_resolved;
    const matchSeverity = severityFilter === "all" || sev === severityFilter;
    return matchResolved && matchSeverity;
  });

  // Summary counts
  const unresolved = allAlerts.filter((a) => !a.is_resolved).length;
  const high    = allAlerts.filter((a) => !a.is_resolved && getSeverity(a.error_code, a.status) === "high").length;
  const medium  = allAlerts.filter((a) => !a.is_resolved && getSeverity(a.error_code, a.status) === "medium").length;
  const low     = allAlerts.filter((a) => !a.is_resolved && getSeverity(a.error_code, a.status) === "low").length;

  const hasFilter = resolvedFilter !== "unresolved" || severityFilter !== "all" || cpFilter;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unresolved > 0
              ? <span className="text-amber-400">{unresolved} alert belum resolved</span>
              : "Semua alert sudah resolved"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilter(!showFilter)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              showFilter || hasFilter
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white"
            }`}>
            <Filter className="w-4 h-4" />
            Filter {hasFilter && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>
          <button onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Unresolved", value: unresolved, color: "text-white" },
          { label: "Kritis",     value: high,        color: "text-red-400" },
          { label: "Sedang",     value: medium,      color: "text-amber-400" },
          { label: "Rendah",     value: low,         color: "text-blue-400" },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-400">Filter Alerts</p>
            {hasFilter && (
              <button onClick={() => { setResolved("unresolved"); setSeverity("all"); setCp(""); }}
                className="text-xs text-red-400 hover:text-red-300 transition-colors">Reset</button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Status</label>
              <select value={resolvedFilter}
                onChange={(e) => setResolved(e.target.value as typeof resolvedFilter)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
                <option value="all">Semua</option>
                <option value="unresolved">Unresolved</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Severity</label>
              <select value={severityFilter} onChange={(e) => setSeverity(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
                <option value="all">Semua</option>
                <option value="high">Kritis</option>
                <option value="medium">Sedang</option>
                <option value="low">Rendah</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Charge Point</label>
              <select value={cpFilter} onChange={(e) => setCp(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
                <option value="">Semua CP</option>
                {chargePoints.map((cp) => (
                  <option key={cp.charge_point_id} value={cp.charge_point_id}>
                    {cp.charge_point_id}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Alert list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-gray-900 border border-gray-800 rounded-xl">
          <Bell className="w-10 h-10 text-gray-700 mb-3" />
          <p className="text-sm text-gray-500">
            {hasFilter ? "Tidak ada alert sesuai filter" : "Tidak ada alert"}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            {!hasFilter && "Alert akan muncul saat charge point melaporkan error"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((alert) => {
            const sev = getSeverity(alert.error_code, alert.status);
            const { icon: SevIcon, color, bg } = severityConfig[sev];

            return (
              <div key={alert.id}
                onClick={() => setSelected(alert)}
                className={`bg-gray-900 border rounded-xl p-4 cursor-pointer transition-all group flex items-start gap-4 ${
                  alert.is_resolved
                    ? "border-gray-800 hover:border-gray-700 opacity-60"
                    : "border-gray-800 hover:border-gray-700"
                }`}>
                {/* Icon */}
                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${bg}`}>
                  <SevIcon className={`w-4 h-4 ${color}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-white">{alert.charge_point_id}</p>
                      {alert.connector_id != null && (
                        <span className="text-xs text-gray-500">· Konektor {alert.connector_id}</span>
                      )}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color} ${bg} border`}>
                        {alert.status}
                      </span>
                    </div>
                    <span className="text-xs text-gray-600 flex-shrink-0">{timeAgo(alert.timestamp)}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {alert.error_code && alert.error_code !== "NoError" && (
                      <span className="text-xs font-mono text-gray-400">{alert.error_code}</span>
                    )}
                    {alert.info && (
                      <span className="text-xs text-gray-500 truncate">{alert.info}</span>
                    )}
                  </div>

                  <p className="text-xs text-gray-600 mt-1">{formatTime(alert.timestamp)}</p>
                </div>

                {/* Right side */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!alert.is_resolved && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resolveMut.mutate(alert.id); }}
                      className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-gray-500 hover:text-emerald-400 transition-colors"
                      title="Tandai resolved">
                      <CheckCheck className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          alert={selected}
          onClose={() => setSelected(null)}
          onResolve={(id) => resolveMut.mutate(id)}
        />
      )}
    </div>
  );
}
