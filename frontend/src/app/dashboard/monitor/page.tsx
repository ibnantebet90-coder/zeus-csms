"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Wifi, WifiOff, Zap, Activity, Circle, RefreshCw, Gauge } from "lucide-react";
import api from "@/lib/axios";

interface Connector { connector_id: number; status: string; }
interface CPState {
  charge_point_id: string; name: string; cp_status: string;
  is_online: boolean; last_heartbeat: string | null;
  vendor_name: string | null; model: string | null;
  connectors: Connector[];
}

interface ActiveTransaction {
  id: number;
  ocpp_transaction_id: number;
  charge_point_id: string;
  connector_id: number;
  start_timestamp: string | null;
  meter_start: number | null;
}

interface MeterPoint {
  timestamp: string;
  measurand: string;
  value: number;
  unit: string | null;
}

const statusColor: Record<string, string> = {
  Available: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Charging: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Faulted: "text-red-400 bg-red-500/10 border-red-500/20",
  Unavailable: "text-gray-400 bg-gray-700 border-gray-600",
  Preparing: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Unknown: "text-gray-500 bg-gray-800 border-gray-700",
};

const MEASURAND_COLORS: Record<string, string> = {
  "Energy.Active.Import.Register": "#10b981",
  "Power.Active.Import": "#3b82f6",
  "Current.Import": "#f59e0b",
  Voltage: "#a855f7",
  SoC: "#ef4444",
};
const fallbackColors = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4"];
const colorFor = (measurand: string, idx: number) => MEASURAND_COLORS[measurand] ?? fallbackColors[idx % fallbackColors.length];

function parseConnectors(raw: any): Connector[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(c => c.connector_id !== 0);
  return Object.entries(raw)
    .filter(([id]) => id !== "0")
    .map(([id, status]) => ({ connector_id: parseInt(id), status: status as string }));
}

function calcCpStatus(connectors: Connector[]): string {
  const s = connectors.map(c => c.status);
  if (s.includes("Charging")) return "Charging";
  if (s.includes("Faulted")) return "Faulted";
  if (s.every(x => x === "Available")) return "Available";
  if (s.includes("Unavailable")) return "Unavailable";
  return "Unknown";
}

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("id-ID", { timeStyle: "medium" }) : "-";

const fmtChartTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { timeStyle: "short" });

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="text-white font-semibold">{p.value?.toFixed?.(3) ?? p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Transaction Meter Chart ─────────────────────────────────────
function TransactionMeterChart({ tx }: { tx: ActiveTransaction }) {
  const [points, setPoints] = useState<MeterPoint[]>([]);
  const [selectedMeasurand, setSelectedMeasurand] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Load histori awal via REST
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/transactions/${tx.id}/meter-values`).then((r) => {
      if (cancelled) return;
      const hist: MeterPoint[] = r.data.map((mv: any) => ({
        timestamp: mv.timestamp, measurand: mv.measurand, value: mv.value, unit: mv.unit,
      }));
      setPoints(hist);
      const measurands = Array.from(new Set(hist.map((p) => p.measurand)));
      if (measurands.length) setSelectedMeasurand((prev) => prev || measurands[0]);
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [tx.id]);

  // Subscribe ke event WebSocket global (di-dispatch oleh parent lewat CustomEvent)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.transaction_id !== tx.ocpp_transaction_id) return;
      if (detail.charge_point_id !== tx.charge_point_id) return;
      setPoints((prev) => [
        ...prev,
        {
          timestamp: detail.timestamp,
          measurand: detail.measurand,
          value: parseFloat(detail.value),
          unit: detail.unit,
        },
      ].slice(-300)); // batasi histori in-memory agar chart tidak membengkak
    };
    window.addEventListener("zeus:meter_value", handler);
    return () => window.removeEventListener("zeus:meter_value", handler);
  }, [tx.ocpp_transaction_id, tx.charge_point_id]);

  const measurands = useMemo(() => Array.from(new Set(points.map((p) => p.measurand))).sort(), [points]);

  const chartData = useMemo(() => {
    if (!selectedMeasurand) return [];
    return points
      .filter((p) => p.measurand === selectedMeasurand)
      .map((p) => ({ time: fmtChartTime(p.timestamp), value: p.value }));
  }, [points, selectedMeasurand]);

  const latest = points[points.length - 1];
  const unit = latest?.unit ?? "";

  return (
    <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-emerald-400" />
          <p className="text-sm font-medium text-white">
            {tx.charge_point_id} · Konektor {tx.connector_id}
          </p>
          <span className="text-xs font-mono text-gray-500">Tx #{tx.ocpp_transaction_id}</span>
        </div>
        {measurands.length > 0 && (
          <select
            value={selectedMeasurand}
            onChange={(e) => setSelectedMeasurand(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500">
            {measurands.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[180px]">
          <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[180px] text-gray-600 text-sm">
          Menunggu MeterValues...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false}
              interval={Math.floor(chartData.length / 6)} />
            <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="value" name={`${selectedMeasurand}${unit ? ` (${unit})` : ""}`}
              stroke={colorFor(selectedMeasurand, 0)} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}

      {latest && (
        <p className="text-xs text-gray-500">
          Nilai terakhir: <span className="text-white font-semibold">{latest.value} {latest.unit}</span> · {fmtChartTime(latest.timestamp)}
        </p>
      )}
    </div>
  );
}

// ── Monitor Transaksi Section ───────────────────────────────────
function TransactionMonitorSection() {
  const { data: activeTx = [], isLoading } = useQuery<ActiveTransaction[]>({
    queryKey: ["transactions", "Active", "monitor"],
    queryFn: () => api.get("/api/transactions?status=Active&limit=12").then((r) => r.data),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" /> Monitor Transaksi Aktif
        </h2>
        <span className="text-xs text-gray-500">{activeTx.length} transaksi berjalan</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 bg-gray-900 border border-gray-800 rounded-xl">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : activeTx.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 bg-gray-900 border border-gray-800 rounded-xl">
          <Gauge className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-sm text-gray-500">Tidak ada transaksi aktif saat ini</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {activeTx.map((tx) => (
            <TransactionMeterChart key={tx.id} tx={tx} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MonitorPage() {
  const qc = useQueryClient();
  const [cpStates, setCpStates] = useState<Record<string, CPState>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/charge-points").then((r) => {
      const init: Record<string, CPState> = {};
      r.data.forEach((cp: any) => {
        const connectors = parseConnectors(cp.connectors);
        init[cp.charge_point_id] = {
          ...cp, connectors,
          cp_status: connectors.length ? calcCpStatus(connectors) : cp.cp_status,
        };
      });
      setCpStates(init);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let destroyed = false;
    let ws: WebSocket | null = null;

    function connect() {
      if (destroyed) return;
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
      const wsBase = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000";
      ws = new WebSocket(`${wsBase}/ws/monitor`);

      ws.onopen = () => { if (!destroyed) setWsConnected(true); };
      ws.onclose = () => { if (!destroyed) { setWsConnected(false); setTimeout(connect, 3000); } };
      ws.onerror = () => { };

      ws.onmessage = (e) => {
        if (destroyed) return;
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === "snapshot") {
            setCpStates(prev => {
              const next = { ...prev };
              Object.entries(msg.data).forEach(([cpId, data]: [string, any]) => {
                const connectors = parseConnectors(data.connectors);
                next[cpId] = {
                  ...prev[cpId],
                  charge_point_id: cpId,
                  name: data.name || cpId,
                  is_online: data.is_online ?? true,
                  vendor_name: data.vendor_name,
                  model: data.model,
                  last_heartbeat: data.last_heartbeat,
                  connectors,
                  cp_status: data.cp_status || calcCpStatus(connectors),
                };
              });
              return next;
            });
          }

          if (msg.type === "connector_update") {
            const { charge_point_id: cpId, connector_id, status, cp_status } = msg;
            setCpStates(prev => {
              if (!prev[cpId]) return prev;
              const connectors = [...prev[cpId].connectors];
              const idx = connectors.findIndex(c => c.connector_id === connector_id);
              if (idx >= 0) connectors[idx] = { ...connectors[idx], status };
              else connectors.push({ connector_id, status });
              return {
                ...prev, [cpId]: {
                  ...prev[cpId], connectors,
                  cp_status: cp_status || calcCpStatus(connectors),
                }
              };
            });
            // Sync React Query
            qc.setQueryData<any[]>(["charge-points"], old => old ? old.map((cp: any) => {
              if (cp.charge_point_id !== cpId) return cp;
              const conns = [...(cp.connectors ?? [])];
              const idx = conns.findIndex((c: any) => c.connector_id === connector_id);
              if (idx >= 0) conns[idx] = { ...conns[idx], status };
              else conns.push({ connector_id, status });
              return { ...cp, connectors: conns, cp_status: cp_status || calcCpStatus(conns) };
            }) : old);
            qc.setQueryData<any[]>(["charge-points-map"], old => old ? old.map((cp: any) => {
              if (cp.charge_point_id !== cpId) return cp;
              return { ...cp, cp_status: cp_status || cp.cp_status };
            }) : old);
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }

          if (msg.type === "cp_update") {
            const cpId = msg.charge_point_id;
            setCpStates(prev => {
              if (!prev[cpId]) return prev;
              const cur = prev[cpId];
              const isCharging = cur.connectors.some(c => c.status === "Charging");
              return {
                ...prev, [cpId]: {
                  ...cur,
                  is_online: msg.data.is_online ?? cur.is_online,
                  last_heartbeat: msg.data.last_heartbeat || cur.last_heartbeat,
                  cp_status: isCharging ? cur.cp_status : (msg.data.cp_status || cur.cp_status),
                }
              };
            });
          }

          if (msg.type === "transaction_update") {
            qc.invalidateQueries({ queryKey: ["transactions"] });
            qc.invalidateQueries({ queryKey: ["transactions-recent"] });
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }

          if (msg.type === "meter_value_update") {
            setCpStates(prev => {
              const cpId = msg.charge_point_id;
              if (!prev[cpId]) return prev;
              return {
                ...prev, [cpId]: {
                  ...prev[cpId],
                  last_meter: msg.data,
                }
              };
            });
            // Teruskan ke chart transaksi yang sedang terbuka (lihat TransactionMeterChart)
            window.dispatchEvent(new CustomEvent("zeus:meter_value", {
              detail: { charge_point_id: msg.charge_point_id, ...msg.data },
            }));
          }
        } catch { }
      };
    }

    connect();
    return () => {
      destroyed = true;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws?.close();
        }
      }
    };
  }, [qc]);

  const cpList = Object.values(cpStates);
  const online = cpList.filter(cp => cp.is_online).length;
  const charging = cpList.filter(cp => cp.cp_status === "Charging").length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Monitoring Real-time</h1>
          <p className="text-sm text-gray-500 mt-0.5">Live status charge point via WebSocket</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${wsConnected ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
          : "text-red-400 bg-red-500/10 border-red-500/20"
          }`}>
          <Circle className={`w-2 h-2 fill-current ${wsConnected ? "animate-pulse" : ""}`} />
          {wsConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total CP", value: cpList.length, color: "text-white" },
          { label: "Online", value: online, color: "text-emerald-400" },
          { label: "Charging", value: charging, color: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : cpList.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 bg-gray-900 border border-gray-800 rounded-xl">
          <Activity className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-sm text-gray-500">Belum ada charge point</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {cpList.map(cp => (
            <div key={cp.charge_point_id} className={`bg-gray-900 border rounded-xl overflow-hidden ${cp.is_online ? "border-gray-700" : "border-gray-800 opacity-60"
              }`}>
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${cp.is_online ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" : "bg-gray-600"
                    }`} />
                  <div>
                    <p className="text-sm font-semibold text-white">{cp.name}</p>
                    <p className="text-xs font-mono text-gray-500">{cp.charge_point_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
                    {cp.cp_status}
                  </span>
                  {cp.is_online ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-gray-600" />}
                </div>
              </div>
              <div className="p-4 space-y-3">
                {cp.vendor_name && <p className="text-xs text-gray-500">{cp.vendor_name} · {cp.model}</p>}
                {cp.connectors.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-500">Konektor</p>
                    <div className="grid grid-cols-2 gap-2">
                      {cp.connectors.map(c => (
                        <div key={c.connector_id} className={`rounded-lg border px-3 py-2.5 flex items-center justify-between ${statusColor[c.status] ?? statusColor.Unknown}`}>
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5" />
                            <span className="text-xs font-medium">Konektor {c.connector_id}</span>
                          </div>
                          <span className="text-xs font-bold">{c.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <p className="text-xs text-gray-600">Menunggu StatusNotification...</p>}
                {cp.last_heartbeat && <p className="text-xs text-gray-600">Heartbeat: {formatTime(cp.last_heartbeat)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Monitor Transaksi — grafik meter values realtime per transaksi aktif */}
      <TransactionMonitorSection />
    </div>
  );
}