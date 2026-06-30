"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, Tooltip, ResponsiveContainer,
} from "recharts";
import { Wifi, WifiOff, Zap, Activity, Circle, RefreshCw, Gauge, Radio, ChevronRight } from "lucide-react";
import EvChargerHud from "@/components/EvChargerHud";
import HudStatRing from "@/components/HudStatRing";
import AnimatedBatteryGauge from "@/components/AnimatedBatteryGauge";
import DownloadMenu from "@/components/DownloadMenu";
import { exportTransactionToCsv, exportTransactionToExcel } from "@/lib/exportTransactions";
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
  id_tag?: string | null;
  start_timestamp: string | null;
  meter_start: number | null;
  energy_consumed_kwh?: number | null;
  total_cost?: number | null;
  status?: string;
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

// ── Transaction Meter Chart (multi-card per measurand) ──────────
function SingleMeasurandCard({
  measurand, points, txId,
}: { measurand: string; points: MeterPoint[]; txId: number }) {
  const filtered = useMemo(
    () => points.filter((p) => p.measurand === measurand).map((p) => ({ time: fmtChartTime(p.timestamp), value: p.value })),
    [points, measurand]
  );
  const latest = useMemo(() => {
    const arr = points.filter((p) => p.measurand === measurand);
    return arr[arr.length - 1];
  }, [points, measurand]);
  const color = colorFor(measurand, 0);

  return (
    <div className="hud-panel relative rounded-xl border border-gray-800 bg-gray-950/60 overflow-hidden">
      <div className="relative z-10 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-gray-400 truncate" title={measurand}>{measurand}</p>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        </div>
        {latest && (
          <p className="text-xl font-bold font-mono tabular-nums" style={{ color }}>
            {latest.value} <span className="text-[11px] text-gray-500 font-normal">{latest.unit}</span>
          </p>
        )}
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-[90px] text-gray-600 text-xs font-mono">
            Menunggu data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={filtered} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${txId}-${measurand}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="value" name={measurand}
                stroke={color} strokeWidth={1.5} dot={false}
                fill={`url(#grad-${txId}-${measurand})`}
                isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function TransactionMeterChart({ tx }: { tx: ActiveTransaction }) {
  const [points, setPoints] = useState<MeterPoint[]>([]);
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

  const handleDownloadCsv = () => exportTransactionToCsv(tx, points);
  const handleDownloadExcel = () => exportTransactionToExcel(tx, points);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <p className="text-sm font-medium text-white font-mono">
            {tx.charge_point_id} · CN-{tx.connector_id}
          </p>
          <span className="text-xs font-mono text-gray-500">Tx #{tx.ocpp_transaction_id}</span>
          <span className="flex items-center gap-1 text-[10px] text-cyan-400 ml-1 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-blink-dot" />
            LIVE
          </span>
        </div>
        <DownloadMenu
          onDownloadCsv={handleDownloadCsv}
          onDownloadExcel={handleDownloadExcel}
          disabled={points.length === 0}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[100px]">
          <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />
        </div>
      ) : measurands.length === 0 ? (
        <div className="flex items-center justify-center h-[100px] text-gray-600 text-sm font-mono">
          Menunggu MeterValues...
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {measurands.map((m) => (
            <SingleMeasurandCard key={m} measurand={m} points={points} txId={tx.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tabel rincian gabungan semua transaksi aktif ────────────────
function ActiveTransactionsTable({ transactions }: { transactions: ActiveTransaction[] }) {
  if (transactions.length === 0) return null;
  return (
    <div className="hud-panel rounded-2xl border border-gray-800 bg-gray-950/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800/80">
        <p className="text-xs font-mono uppercase tracking-wider text-gray-500">Rincian Transaksi Aktif</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 font-mono border-b border-gray-800/80">
              <th className="px-4 py-2 font-medium">Tx ID</th>
              <th className="px-3 py-2 font-medium">Charge Point</th>
              <th className="px-3 py-2 font-medium">CN</th>
              <th className="px-3 py-2 font-medium">ID Tag</th>
              <th className="px-3 py-2 font-medium">Mulai</th>
              <th className="px-3 py-2 font-medium text-right">Meter Awal</th>
              <th className="px-3 py-2 font-medium text-right">Energi (kWh)</th>
              <th className="px-3 py-2 font-medium text-right">Estimasi Biaya</th>
            </tr>
          </thead>
          <tbody className="font-mono text-gray-300">
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-b border-gray-900 hover:bg-gray-900/60 transition-colors">
                <td className="px-4 py-2 text-cyan-400">#{tx.ocpp_transaction_id}</td>
                <td className="px-3 py-2">{tx.charge_point_id}</td>
                <td className="px-3 py-2">CN-{tx.connector_id}</td>
                <td className="px-3 py-2 text-gray-400">{tx.id_tag ?? "-"}</td>
                <td className="px-3 py-2 text-gray-400">{formatTime(tx.start_timestamp)}</td>
                <td className="px-3 py-2 text-right">{tx.meter_start ?? "-"}</td>
                <td className="px-3 py-2 text-right text-emerald-400">{tx.energy_consumed_kwh?.toFixed?.(2) ?? "-"}</td>
                <td className="px-3 py-2 text-right">{tx.total_cost != null ? `Rp${tx.total_cost.toLocaleString("id-ID")}` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Monitor Transaksi Section ───────────────────────────────────
function TransactionMonitorSection({ cpList }: { cpList: CPState[] }) {
  const { data: activeTx = [], isLoading } = useQuery<ActiveTransaction[]>({
    queryKey: ["transactions", "Active", "monitor"],
    queryFn: () => api.get("/api/transactions?status=Active&limit=50").then((r) => r.data),
    refetchInterval: 15000,
  });

  // CP yang sedang Charging (sumber: status real-time WebSocket)
  const chargingCps = useMemo(
    () => cpList.filter((cp) => cp.is_online && cp.cp_status === "Charging"),
    [cpList]
  );

  const [selectedCpId, setSelectedCpId] = useState<string>("");
  const [selectedTxId, setSelectedTxId] = useState<number | null>(null);

  // Effective CP terpilih: pakai pilihan user kalau masih valid (masih Charging),
  // kalau tidak fallback ke CP Charging pertama — dihitung langsung di render,
  // tanpa useEffect+setState, supaya tidak ada cascading render.
  const effectiveCpId = chargingCps.some((cp) => cp.charge_point_id === selectedCpId)
    ? selectedCpId
    : (chargingCps[0]?.charge_point_id ?? "");

  // Transaksi aktif milik CP terpilih
  const txForSelectedCp = useMemo(
    () => activeTx.filter((tx) => tx.charge_point_id === effectiveCpId),
    [activeTx, effectiveCpId]
  );

  // Effective transaksi terpilih: pakai pilihan user kalau masih valid,
  // kalau tidak fallback ke transaksi pertama milik CP terpilih.
  const effectiveTxId = txForSelectedCp.some((tx) => tx.id === selectedTxId)
    ? selectedTxId
    : (txForSelectedCp[0]?.id ?? null);

  const selectedTx = txForSelectedCp.find((tx) => tx.id === effectiveTxId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2 font-mono">
          <Activity className="w-4 h-4 text-cyan-400 animate-status-glow" /> ACTIVE_SESSIONS // TRANSAKSI BERJALAN
        </h2>
        <span className="text-xs text-gray-500 font-mono">[{activeTx.length}]</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 bg-gray-900 border border-gray-800 rounded-xl">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : chargingCps.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 bg-gray-900 border border-gray-800 rounded-xl">
          <Gauge className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-sm text-gray-500 font-mono">Tidak ada charge point yang sedang Charging</p>
        </div>
      ) : (
        <>
          {/* Filter tingkat 1: pilih charge point yang Charging */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-wider text-gray-500">Pilih Charge Point</p>
            <div className="flex flex-wrap gap-2">
              {chargingCps.map((cp) => (
                <button
                  key={cp.charge_point_id}
                  onClick={() => setSelectedCpId(cp.charge_point_id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
                    effectiveCpId === cp.charge_point_id
                      ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-blink-dot" />
                  {cp.name}
                </button>
              ))}
            </div>
          </div>

          {/* Filter tingkat 2: pilih transaksi (kalau CP punya >1 transaksi aktif) */}
          {txForSelectedCp.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono uppercase tracking-wider text-gray-500">Pilih Transaksi</p>
              <div className="flex flex-wrap gap-2">
                {txForSelectedCp.map((tx) => (
                  <button
                    key={tx.id}
                    onClick={() => setSelectedTxId(tx.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-mono transition-colors ${
                      effectiveTxId === tx.id
                        ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                        : "border-gray-700 bg-gray-900 text-gray-500 hover:border-gray-600"
                    }`}
                  >
                    <ChevronRight className="w-3 h-3" /> CN-{tx.connector_id} · Tx#{tx.ocpp_transaction_id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chart per measurand untuk transaksi terpilih */}
          {selectedTx ? (
            <TransactionMeterChart key={selectedTx.id} tx={selectedTx} />
          ) : (
            <div className="flex items-center justify-center h-24 bg-gray-900 border border-gray-800 rounded-xl">
              <p className="text-sm text-gray-500 font-mono">Tidak ada transaksi aktif pada charge point ini</p>
            </div>
          )}
        </>
      )}

      {/* Tabel rincian gabungan semua transaksi aktif */}
      <ActiveTransactionsTable transactions={activeTx} />
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
    <div className="relative p-6 space-y-6 hud-grid-bg rounded-2xl">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-cyan-400" />
            EVCS Command Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5 font-mono">
            Live status charge point via WebSocket
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono font-medium ${wsConnected ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_-4px_#34d399]"
          : "text-red-400 bg-red-500/10 border-red-500/30"
          }`}>
          <Circle className={`w-2 h-2 fill-current ${wsConnected ? "animate-blink-dot" : ""}`} />
          {wsConnected ? "LINK ESTABLISHED" : "LINK LOST"}
        </div>
      </div>

      {/* ── Strip ringkasan HUD (ring counter) ──────────────── */}
      <div className="hud-panel border border-gray-800 rounded-2xl bg-gray-950/60 backdrop-blur-sm overflow-hidden">
        <div className="relative z-10 flex items-stretch justify-center divide-x divide-gray-800/80">
          <HudStatRing label="Total CP" value={cpList.length} color="#e5e7eb" />
          <HudStatRing label="Online" value={online} total={cpList.length || 1} color="#34d399" pulse={online > 0} />
          <HudStatRing label="Charging" value={charging} total={cpList.length || 1} color="#22d3ee" pulse={charging > 0} />
        </div>
      </div>

      {/* ── Grid kartu charger HUD ───────────────────────────── */}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {cpList.map(cp => {
            const effectiveStatus = cp.is_online ? cp.cp_status : "Unavailable";
            const isLive = cp.is_online && (cp.cp_status === "Charging" || cp.cp_status === "Preparing");
            const ringGlow = effectiveStatus === "Charging" ? "shadow-cyan-500/30"
              : effectiveStatus === "Faulted" ? "shadow-red-500/30"
              : effectiveStatus === "Available" ? "shadow-emerald-500/20"
              : "shadow-transparent";
            return (
              <div
                key={cp.charge_point_id}
                className={`hud-panel relative rounded-2xl overflow-hidden border transition-all ${cp.is_online ? "border-gray-700" : "border-gray-800 opacity-50"} ${isLive ? `animate-border-glow-pulse shadow-lg ${ringGlow}` : ""}`}
                style={isLive ? { ["--tw-shadow-color" as any]: effectiveStatus === "Charging" ? "#22d3ee" : "#fbbf24" } : undefined}
              >
                {/* Scanline animasi melintas di atas kartu aktif */}
                {isLive && (
                  <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-cyan-400/10 to-transparent animate-hud-scan pointer-events-none z-0" />
                )}

                <div className="relative z-10 bg-gray-950/70 backdrop-blur-sm">
                  {/* Header card: nama + status badge */}
                  <div className="px-4 py-3 border-b border-gray-800/80 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{cp.name}</p>
                      <p className="text-xs font-mono text-gray-500">{cp.charge_point_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-mono font-medium border transition-colors ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
                        {cp.cp_status.toUpperCase()}
                      </span>
                      {cp.is_online ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-gray-600" />}
                    </div>
                  </div>

                  {/* Hero: ikon charger HUD besar di tengah */}
                  <div className="flex items-center justify-center py-5 relative">
                    <span className="hud-corner hud-corner-tl text-gray-700" />
                    <span className="hud-corner hud-corner-tr text-gray-700" />
                    <span className="hud-corner hud-corner-bl text-gray-700" />
                    <span className="hud-corner hud-corner-br text-gray-700" />
                    <EvChargerHud status={effectiveStatus} size={132} />
                  </div>

                  {/* Vendor / model */}
                  {cp.vendor_name && (
                    <p className="text-center text-xs text-gray-500 font-mono -mt-2 mb-2">
                      {cp.vendor_name} · {cp.model}
                    </p>
                  )}

                  {/* Konektor */}
                  <div className="p-4 pt-2 space-y-3">
                    {cp.connectors.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-mono uppercase tracking-wider text-gray-500">Konektor</p>
                        <div className="grid grid-cols-2 gap-2">
                          {cp.connectors.map(c => (
                            <div key={c.connector_id} className={`relative rounded-lg border px-3 py-2.5 flex items-center justify-between transition-colors ${statusColor[c.status] ?? statusColor.Unknown}`}>
                              <div className="flex items-center gap-1.5">
                                <Zap className={`w-3.5 h-3.5 ${c.status === "Charging" ? "animate-status-glow" : ""}`} />
                                <span className="text-xs font-mono font-medium">CN-{c.connector_id}</span>
                              </div>
                              {c.status === "Charging" ? (
                                <AnimatedBatteryGauge isCharging size="sm" />
                              ) : (
                                <span className="text-xs font-bold font-mono">{c.status}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <p className="text-xs text-gray-600 font-mono">Menunggu StatusNotification...</p>}
                    {cp.last_heartbeat && (
                      <p className="text-xs text-gray-600 font-mono flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${cp.is_online ? "bg-emerald-500 animate-blink-dot" : "bg-gray-600"}`} />
                        HB: {formatTime(cp.last_heartbeat)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Monitor Transaksi — grafik meter values realtime per transaksi aktif */}
      <TransactionMonitorSection cpList={cpList} />
    </div>
  );
}