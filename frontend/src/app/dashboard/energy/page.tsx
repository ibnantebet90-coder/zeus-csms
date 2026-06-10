"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Zap, RefreshCw, Download, Search, Maximize2,
  Minimize2, X, TrendingUp, Database, Clock, Activity,
  FileText, Table2, FileDown,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────
interface EnergyRecord { id: number; time_stamp: string; energy_trafo_2: number | null; source: string | null; }
interface Summary { total_records: number; latest_value: number | null; latest_timestamp: string | null; total_today_kwh: number; avg_today_kwh: number; max_today_kwh: number | null; }
interface DailyEnergy { date: string; total_kwh: number; avg_kwh: number; max_kwh: number; min_kwh: number; data_points: number; }
interface Top5 { date: string; total_kwh: number; }

// ── Helpers ───────────────────────────────────────────────
const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { timeStyle: "short" });
const fmtDate = (iso: string) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };
const fmtNum = (n: number | null | undefined, dec = 4) => n != null ? n.toFixed(dec) : "-";

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444"];

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="text-white font-semibold">{fmtNum(p.value, 3)} kWh</span>
        </div>
      ))}
    </div>
  );
};

// ── Fullscreen Table Modal ────────────────────────────────
function FullscreenTable({ data, onClose }: { data: EnergyRecord[]; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const filtered = data.filter(r =>
    !search ||
    String(r.energy_trafo_2 ?? "").includes(search) ||
    (r.source ?? "").toLowerCase().includes(search.toLowerCase()) ||
    r.time_stamp.includes(search)
  );

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Data Energi Trafo — Fullscreen</h2>
          <span className="text-xs text-gray-500">{filtered.length} dari {data.length} records</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cari..."
              className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 w-48" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X className="w-3 h-3" /></button>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {["ID", "Timestamp", "Energy Trafo 2 (kWh)", "Source"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-gray-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-2.5 text-gray-500 font-mono">{r.id}</td>
                <td className="px-4 py-2.5 text-gray-300">{fmt(r.time_stamp)}</td>
                <td className="px-4 py-2.5 font-mono text-emerald-400 font-semibold">{fmtNum(r.energy_trafo_2)}</td>
                <td className="px-4 py-2.5 text-gray-500">{r.source ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────
export default function EnergyMonitoringPage() {
  const [refreshMs, setRefreshMs] = useState(30000);
  const [search, setSearch] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [dailyDays, setDailyDays] = useState(30);
  const [exporting, setExporting] = useState("");
  const [seedLoading, setSeedLoading] = useState(false);

  // ── Queries ──────────────────────────────────────────────
  const { data: summary, refetch: refetchSummary } = useQuery<Summary>({
    queryKey: ["energy-summary"],
    queryFn: () => api.get("/api/energy/summary").then(r => r.data),
    refetchInterval: refreshMs,
  });

  const { data: latest = [], refetch: refetchLatest, isLoading } = useQuery<EnergyRecord[]>({
    queryKey: ["energy-latest", search],
    queryFn: () => api.get(`/api/energy/latest?limit=200${search ? `&search=${search}` : ""}`).then(r => r.data),
    refetchInterval: refreshMs,
  });

  const { data: todayData = [] } = useQuery<any[]>({
    queryKey: ["energy-today"],
    queryFn: () => api.get("/api/energy/today").then(r => r.data),
    refetchInterval: refreshMs,
  });

  const { data: dailyData = [] } = useQuery<DailyEnergy[]>({
    queryKey: ["energy-daily", dailyDays],
    queryFn: () => api.get(`/api/energy/daily?days=${dailyDays}`).then(r => r.data),
    refetchInterval: 60000,
  });

  const { data: top5 = [] } = useQuery<Top5[]>({
    queryKey: ["energy-top5", dailyDays],
    queryFn: () => api.get(`/api/energy/top5?days=${dailyDays}`).then(r => r.data),
    refetchInterval: 60000,
  });

  const refetchAll = () => {
    refetchSummary();
    refetchLatest();
  };

  // ── Export ───────────────────────────────────────────────
  const handleExport = async (format: "csv" | "xlsx" | "pdf", type: "latest" | "daily") => {
    setExporting(`${type}-${format}`);
    try {
      const res = await api.get(
        `/api/energy/export?format=${format}&export_type=${type}&days=${dailyDays}&limit=1000`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `zeus_energy_${type}_${new Date().toISOString().slice(0, 10)}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    finally { setExporting(""); }
  };

  // ── Seed demo ────────────────────────────────────────────
  const handleSeed = async () => {
    setSeedLoading(true);
    try {
      await api.post("/api/energy/seed-demo?days=30");
      refetchAll();
    } catch (e) { console.error(e); }
    finally { setSeedLoading(false); }
  };

  // ── Chart data ───────────────────────────────────────────
  const todayChart = todayData.map((d: any) => ({
    time: fmtTime(d.time_stamp),
    energy: d.energy_trafo_2,
  }));

  const dailyChart = dailyData.map(d => ({
    date: fmtDate(d.date),
    total_kwh: d.total_kwh,
    avg_kwh: d.avg_kwh,
  }));

  const maxDaily = Math.max(...dailyData.map(d => d.total_kwh), 0);

  return (
    <>
      {fullscreen && <FullscreenTable data={latest} onClose={() => setFullscreen(false)} />}

      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Monitoring Energi</h1>
            <p className="text-sm text-gray-500 mt-0.5">Data real-time dari trafo via Modbus</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto refresh selector */}
            <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
              <Clock className="w-3.5 h-3.5 text-gray-500" />
              <select value={refreshMs} onChange={e => setRefreshMs(Number(e.target.value))}
                id="energy-refresh"
                name="energy-refresh"
                className="bg-transparent text-xs text-gray-300 focus:outline-none">
                <option value={5000}>5 detik</option>
                <option value={10000}>10 detik</option>
                <option value={30000}>30 detik</option>
                <option value={60000}>1 menit</option>
                <option value={300000}>5 menit</option>
                <option value={0}>Manual</option>
              </select>
            </div>
            <button onClick={refetchAll}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            {/* Seed demo button */}
            {summary?.total_records === 0 && (
              <button onClick={handleSeed} disabled={seedLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs border border-amber-500/20 transition-colors">
                {seedLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                Insert Demo Data
              </button>
            )}
          </div>
        </div>

        {/* 10.1 Summary Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: "Jumlah Data", value: summary?.total_records?.toLocaleString("id-ID") ?? "0", icon: Database, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
            { label: "Energi Terakhir", value: summary?.latest_value != null ? `${fmtNum(summary.latest_value, 4)} kWh` : "-", icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
            { label: "Total Hari Ini", value: `${fmtNum(summary?.total_today_kwh, 3)} kWh`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
            { label: "Rata-rata Hari Ini", value: `${fmtNum(summary?.avg_today_kwh, 4)} kWh`, icon: Activity, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${s.bg}`}>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
              </div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              {s.label === "Energi Terakhir" && summary?.latest_timestamp && (
                <p className="text-xs text-gray-600 mt-1">{fmt(summary.latest_timestamp)}</p>
              )}
            </div>
          ))}
        </div>

        {/* 10.2 Grafik real-time hari ini */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Grafik Real-time Energi Hari Ini</h2>
              <p className="text-xs text-gray-500 mt-0.5">{todayData.length} data points · auto-refresh {refreshMs / 1000}s</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400">Live</span>
            </div>
          </div>
          {todayChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={todayChart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradToday" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(todayChart.length / 8)} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="energy" name="Energy Trafo 2"
                  stroke="#10b981" strokeWidth={2} fill="url(#gradToday)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">
              Belum ada data hari ini
            </div>
          )}
        </div>

        {/* 10.3 Grafik akumulasi harian */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Daily Consumption */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Daily Energy Consumption</h2>
                <p className="text-xs text-gray-500 mt-0.5">{dailyDays} hari terakhir</p>
              </div>
              {/* Dropdown Durasi/Data Historis */}
              <select
                id="history-period"
                name="history_period"
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
              >
                <option value="7">7 hari</option>
                <option value="14">14 hari</option>
                <option value="30">30 hari</option>
                <option value="60">60 hari</option>
                <option value="90">90 hari</option>
              </select>
            </div>
            {dailyChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dailyChart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.floor(dailyChart.length / 7)} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total_kwh" name="Total" radius={[3, 3, 0, 0]}>
                    {dailyChart.map((_, i) => (
                      <Cell key={i} fill={`hsl(${160 - i * (80 / dailyChart.length)}, 70%, 50%)`} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">Belum ada data harian</div>
            )}
          </div>

          {/* Top 5 */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Top 5 Daily Energy</h2>
                <p className="text-xs text-gray-500 mt-0.5">Hari dengan konsumsi tertinggi</p>
              </div>
            </div>
            {top5.length > 0 ? (
              <div className="space-y-3">
                {top5.map((item, i) => (
                  <div key={item.date} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: COLORS[i] + "20", color: COLORS[i] }}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-300">{item.date}</span>
                        <span className="text-xs font-bold font-mono" style={{ color: COLORS[i] }}>
                          {fmtNum(item.total_kwh, 3)} kWh
                        </span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${maxDaily > 0 ? (item.total_kwh / maxDaily) * 100 : 0}%`, background: COLORS[i] }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[180px] text-gray-600 text-sm">Belum ada data</div>
            )}
          </div>
        </div>

        {/* 10.1 Table + controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">Data Energi Trafo</h2>
              <span className="text-xs text-gray-500">{latest.length} records</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={search}
                  id="search-input"
                  name="search_query"
                  placeholder="Cari data..."
                  className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 w-40"
                  value=""
                  onChange={e => setSearch(e.target.value)}
                />
                {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X className="w-3 h-3" /></button>}
              </div>
              {/* Fullscreen */}
              <button onClick={() => setFullscreen(true)}
                className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                <Maximize2 className="w-4 h-4" />
              </button>
              {/* Download buttons */}
              <div className="flex gap-1">
                {(["csv", "xlsx", "pdf"] as const).map(fmt => (
                  <button key={fmt} onClick={() => handleExport(fmt, "latest")}
                    disabled={!!exporting}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-white text-xs rounded-lg uppercase transition-colors">
                    {exporting === `latest-${fmt}` ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  {["ID", "Timestamp", "Energy Trafo 2 (kWh)", "Source"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                  </td></tr>
                ) : latest.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">
                    Belum ada data — klik "Insert Demo Data" untuk testing
                  </td></tr>
                ) : (
                  latest.map(r => (
                    <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5 text-gray-500 font-mono">{r.id}</td>
                      <td className="px-4 py-2.5 text-gray-300">{fmt(r.time_stamp)}</td>
                      <td className="px-4 py-2.5 font-mono text-emerald-400 font-semibold">{fmtNum(r.energy_trafo_2)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{r.source ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 10.4 Download data section */}
          <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-gray-500">Download Data Harian ({dailyDays} hari)</p>
            <div className="flex gap-2">
              {(["csv", "xlsx", "pdf"] as const).map(fmt => (
                <button key={fmt} onClick={() => handleExport(fmt, "daily")}
                  disabled={!!exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-xs rounded-lg transition-colors uppercase">
                  {exporting === `daily-${fmt}` ? <RefreshCw className="w-3 h-3 animate-spin" /> :
                    fmt === "csv" ? <FileText className="w-3 h-3" /> :
                      fmt === "xlsx" ? <Table2 className="w-3 h-3" /> :
                        <FileDown className="w-3 h-3" />}
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
