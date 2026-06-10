"use client";

import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  FileBarChart2, RefreshCw, Download, FileSpreadsheet,
  Zap, Receipt, BarChart3, Activity, Filter,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────

interface ReportDaily {
  report_date: string;
  charge_point_id: string;
  charge_point_name: string;
  total_transactions: number;
  total_energy_kwh: number;
  total_revenue: number;
}

interface ReportMonthly {
  year: number;
  month: number;
  month_name: string;
  charge_point_id: string;
  charge_point_name: string;
  total_transactions: number;
  total_energy_kwh: number;
  total_revenue: number;
  avg_energy_kwh: number;
}

interface ReportSummary {
  date_from: string;
  date_to: string;
  total_transactions: number;
  total_energy_kwh: number;
  total_revenue: number;
  avg_energy_per_tx_kwh: number;
  avg_cost_per_tx: number;
  active_charge_points: number;
}

// ── Helpers ───────────────────────────────────────────────────

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatIDRShort = (n: number) => {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`;
  return `Rp ${n}`;
};

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const currentYear = new Date().getFullYear();

// Palet warna chart
const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#f97316", "#84cc16"];

const shortName = (name: string) =>
  name.length > 14 ? name.slice(0, 13) + "…" : name;

// ── Custom Tooltip ────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label, formatter }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-gray-400 mb-1.5 font-medium">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-gray-300">{p.name}:</span>
          <span className="text-white font-medium">
            {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Custom Pie Label ──────────────────────────────────────────

const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
};

// ── Summary Cards ─────────────────────────────────────────────

function SummaryCards({ summary }: { summary: ReportSummary }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {[
        {
          label: "Total Transaksi", value: summary.total_transactions.toLocaleString("id-ID"),
          sub: `${summary.active_charge_points} CP aktif`,
          icon: <BarChart3 className="w-4 h-4" />, color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/10",
        },
        {
          label: "Total Energi", value: `${summary.total_energy_kwh.toFixed(2)} kWh`,
          sub: `Rata-rata ${summary.avg_energy_per_tx_kwh.toFixed(2)} kWh/tx`,
          icon: <Zap className="w-4 h-4" />, color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/10",
        },
        {
          label: "Total Pendapatan", value: formatIDR(summary.total_revenue),
          sub: `Rata-rata ${formatIDR(summary.avg_cost_per_tx)}/tx`,
          icon: <Receipt className="w-4 h-4" />, color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/10",
        },
        {
          label: "CP Aktif", value: String(summary.active_charge_points),
          sub: `${summary.date_from} s/d ${summary.date_to}`,
          icon: <Activity className="w-4 h-4" />, color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/10",
        },
      ].map((c) => (
        <div key={c.label} className={`bg-gray-900 border ${c.border} ${c.bg} rounded-xl p-4`}>
          <div className={`flex items-center gap-1.5 ${c.color} mb-2`}>
            {c.icon}
            <span className="text-xs font-medium">{c.label}</span>
          </div>
          <p className="text-xl font-bold text-white">{c.value}</p>
          <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Summary Table per CP ──────────────────────────────────────

function SummaryTable({ byCp }: {
  byCp: { id: string; name: string; tx: number; kwh: number; rev: number }[]
}) {
  const totalTx = byCp.reduce((s, r) => s + r.tx, 0);
  const totalKwh = byCp.reduce((s, r) => s + r.kwh, 0);
  const totalRev = byCp.reduce((s, r) => s + r.rev, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Transaksi */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
          <p className="text-xs font-semibold text-gray-300">Total Penggunaan</p>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800">
            <th className="px-4 py-2 text-left text-gray-500 font-medium">Nama</th>
            <th className="px-4 py-2 text-right text-gray-500 font-medium">Total</th>
          </tr></thead>
          <tbody>
            {byCp.map((r) => (
              <tr key={r.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                <td className="px-4 py-2.5 text-gray-300">{r.name}</td>
                <td className="px-4 py-2.5 text-right text-white font-medium">{r.tx}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-gray-800/30">
            <td className="px-4 py-2.5 text-gray-400 font-semibold">Total Penggunaan</td>
            <td className="px-4 py-2.5 text-right text-white font-bold">{totalTx}</td>
          </tr></tfoot>
        </table>
      </div>

      {/* Energi */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <p className="text-xs font-semibold text-gray-300">Konsumsi (kWh)</p>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800">
            <th className="px-4 py-2 text-left text-gray-500 font-medium">Nama</th>
            <th className="px-4 py-2 text-right text-gray-500 font-medium">kWh</th>
          </tr></thead>
          <tbody>
            {byCp.map((r) => (
              <tr key={r.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                <td className="px-4 py-2.5 text-gray-300">{r.name}</td>
                <td className="px-4 py-2.5 text-right text-emerald-400 font-medium">{r.kwh.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-gray-800/30">
            <td className="px-4 py-2.5 text-gray-400 font-semibold">Total Konsumsi (kWh)</td>
            <td className="px-4 py-2.5 text-right text-emerald-400 font-bold">{totalKwh.toFixed(3)}</td>
          </tr></tfoot>
        </table>
      </div>

      {/* Biaya */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <Receipt className="w-3.5 h-3.5 text-amber-400" />
          <p className="text-xs font-semibold text-gray-300">Biaya Pengisian (IDR)</p>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800">
            <th className="px-4 py-2 text-left text-gray-500 font-medium">Nama</th>
            <th className="px-4 py-2 text-right text-gray-500 font-medium">Biaya</th>
          </tr></thead>
          <tbody>
            {byCp.map((r) => (
              <tr key={r.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                <td className="px-4 py-2.5 text-gray-300">{r.name}</td>
                <td className="px-4 py-2.5 text-right text-amber-400 font-medium">{formatIDR(r.rev)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-gray-800/30">
            <td className="px-4 py-2.5 text-gray-400 font-semibold">Total Biaya (IDR)</td>
            <td className="px-4 py-2.5 text-right text-amber-400 font-bold">{formatIDR(totalRev)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Bar + Pie Section ─────────────────────────────────────────

function ChartSection({
  title, icon, byCp, dataKey, color, formatter, yTickFormatter,
}: {
  title: string;
  icon: React.ReactNode;
  byCp: { id: string; name: string; tx: number; kwh: number; rev: number }[];
  dataKey: "tx" | "kwh" | "rev";
  color: string;
  formatter: (v: number) => string;
  yTickFormatter: (v: number) => string;
}) {
  const barData = byCp.map((r, i) => ({ name: shortName(r.name), value: r[dataKey], color: COLORS[i % COLORS.length] }));
  const pieData = byCp.map((r, i) => ({ name: r.name, value: r[dataKey], color: COLORS[i % COLORS.length] }));

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        {icon}
        <p className="text-xs font-semibold text-gray-300">{title}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-800">
        {/* Bar Chart */}
        <div className="p-4">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={yTickFormatter} width={55} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => formatter(v)} />} />
              <Bar dataKey="value" name={title} radius={[3, 3, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Pie Chart */}
        <div className="p-4 flex items-center">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={pieData} cx="40%" cy="50%"
                outerRadius={75} dataKey="value"
                labelLine={false} label={renderPieLabel}
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip formatter={(v: number) => formatter(v)} />} />
              <Legend
                layout="vertical" align="right" verticalAlign="middle"
                iconSize={8}
                formatter={(value) => (
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>{shortName(value)}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Daily Timeline Chart ──────────────────────────────────────

function DailyTimelineChart({
  title, icon, dailyByCpDate, cpList, dataKey, formatter, yTickFormatter, colors,
}: {
  title: string;
  icon: React.ReactNode;
  dailyByCpDate: Map<string, Map<string, number>>;
  cpList: { id: string; name: string }[];
  dataKey: "tx" | "kwh" | "rev";
  formatter: (v: number) => string;
  yTickFormatter: (v: number) => string;
  colors: string[];
}) {
  // Build data: [{date, cpName1: val, cpName2: val, ...}]
  const chartData = useMemo(() => {
    const dates = Array.from(dailyByCpDate.keys()).sort();
    return dates.map((date) => {
      const row: any = {
        date: new Date(date + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      };
      cpList.forEach((cp) => {
        row[cp.name] = dailyByCpDate.get(date)?.get(cp.id + "_" + dataKey) ?? 0;
      });
      return row;
    });
  }, [dailyByCpDate, cpList, dataKey]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        {icon}
        <p className="text-xs font-semibold text-gray-300">{title}</p>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={yTickFormatter} width={55} />
            <Tooltip content={<ChartTooltip formatter={(v: number) => formatter(v)} />} />
            <Legend formatter={(v) => <span style={{ fontSize: 10, color: "#9ca3af" }}>{shortName(v)}</span>} />
            {cpList.map((cp, i) => (
              <Bar key={cp.id} dataKey={cp.name} stackId="a"
                fill={colors[i % colors.length]} radius={i === cpList.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function ReportPage() {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const [dateFrom, setDateFrom] = useState(daysAgo(29));
  const [dateTo, setDateTo] = useState(today());
  const [year, setYear] = useState(currentYear);
  const [cpFilter, setCpFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  // ── Queries ─────────────────────────────────────────────────

  const summaryParams = new URLSearchParams({
    date_from: dateFrom, date_to: dateTo,
    ...(cpFilter ? { charge_point_id: cpFilter } : {}),
  });

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } =
    useQuery<ReportSummary>({
      queryKey: ["report-summary", dateFrom, dateTo, cpFilter],
      queryFn: () => api.get(`/api/reports/summary?${summaryParams}`).then((r) => r.data),
    });

  const dailyParams = new URLSearchParams({
    date_from: dateFrom, date_to: dateTo,
    ...(cpFilter ? { charge_point_id: cpFilter } : {}),
  });

  const { data: dailyData = [], isLoading: dailyLoading, refetch: refetchDaily } =
    useQuery<ReportDaily[]>({
      queryKey: ["report-daily", dateFrom, dateTo, cpFilter],
      queryFn: () => api.get(`/api/reports/daily?${dailyParams}`).then((r) => r.data),
      enabled: mode === "daily",
    });

  const monthlyParams = new URLSearchParams({
    year: String(year),
    ...(cpFilter ? { charge_point_id: cpFilter } : {}),
  });

  const { data: monthlyData = [], isLoading: monthlyLoading, refetch: refetchMonthly } =
    useQuery<ReportMonthly[]>({
      queryKey: ["report-monthly", year, cpFilter],
      queryFn: () => api.get(`/api/reports/monthly?${monthlyParams}`).then((r) => r.data),
      enabled: mode === "monthly",
    });

  const isLoading = summaryLoading || dailyLoading || monthlyLoading;

  const handleRefresh = () => {
    refetchSummary();
    if (mode === "daily") refetchDaily();
    if (mode === "monthly") refetchMonthly();
  };

  // ── Derived Data ─────────────────────────────────────────────

  // Agregasi per CP (untuk bar + pie)
  const byCp = useMemo(() => {
    const source = mode === "daily" ? dailyData : monthlyData;
    const map = new Map<string, { id: string; name: string; tx: number; kwh: number; rev: number }>();
    source.forEach((r) => {
      const prev = map.get(r.charge_point_id);
      if (prev) {
        prev.tx += r.total_transactions;
        prev.kwh += r.total_energy_kwh;
        prev.rev += r.total_revenue;
      } else {
        map.set(r.charge_point_id, {
          id: r.charge_point_id, name: r.charge_point_name,
          tx: r.total_transactions, kwh: r.total_energy_kwh, rev: r.total_revenue,
        });
      }
    });
    return Array.from(map.values());
  }, [dailyData, monthlyData, mode]);

  // Agregasi harian per CP per tanggal (untuk timeline chart)
  const dailyByCpDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    dailyData.forEach((r) => {
      if (!map.has(r.report_date)) map.set(r.report_date, new Map());
      const inner = map.get(r.report_date)!;
      inner.set(r.charge_point_id + "_tx", (inner.get(r.charge_point_id + "_tx") ?? 0) + r.total_transactions);
      inner.set(r.charge_point_id + "_kwh", (inner.get(r.charge_point_id + "_kwh") ?? 0) + r.total_energy_kwh);
      inner.set(r.charge_point_id + "_rev", (inner.get(r.charge_point_id + "_rev") ?? 0) + r.total_revenue);
    });
    return map;
  }, [dailyData]);

  // CP list unik
  const cpList = useMemo(() =>
    byCp.map((r) => ({ id: r.id, name: r.name })),
    [byCp]
  );

  // ── Export ───────────────────────────────────────────────────

  const handleExport = async (format: "csv" | "excel") => {
    const ext = format === "csv" ? "csv" : "xlsx";
    const p = new URLSearchParams({ report_type: mode });
    if (mode === "daily") { p.set("date_from", dateFrom); p.set("date_to", dateTo); }
    else { p.set("year", String(year)); }
    if (cpFilter) p.set("charge_point_id", cpFilter);

    const res = await api.get(`/api/reports/export/${format}?${p}`, { responseType: "blob" });
    const filename = mode === "daily"
      ? `laporan_harian_${dateFrom}_${dateTo}.${ext}`
      : `laporan_bulanan_${year}.${ext}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([res.data]));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // ── Render ───────────────────────────────────────────────────

  const hasFilter = !!cpFilter;

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileBarChart2 className="w-5 h-5 text-emerald-400" />
            Laporan
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Laporan penggunaan dan pendapatan SPKLU</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode toggle */}
          <div className="flex bg-gray-800 rounded-lg p-0.5">
            {(["daily", "monthly"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === m
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-gray-400 hover:text-white"
                  }`}>
                {m === "daily" ? "Harian" : "Bulanan"}
              </button>
            ))}
          </div>

          <button onClick={() => setShowFilter(!showFilter)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${showFilter || hasFilter
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white"
              }`}>
            <Filter className="w-3.5 h-3.5" />
            Filter {hasFilter && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>

          <button onClick={handleRefresh}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>

          <button onClick={() => handleExport("csv")}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => handleExport("excel")}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs rounded-lg transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilter && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-400">Filter Laporan</p>
            {hasFilter && (
              <button onClick={() => setCpFilter("")}
                className="text-xs text-red-400 hover:text-red-300 transition-colors">
                Reset filter
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {mode === "daily" ? (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Dari Tanggal</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Sampai Tanggal</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors" />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tahun</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors">
                  {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Charge Point ID</label>
              <input value={cpFilter} onChange={(e) => setCpFilter(e.target.value)}
                placeholder="Kosongkan untuk semua"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span className="ml-2 text-sm text-gray-500">Memuat data...</span>
        </div>
      )}

      {!isLoading && (
        <>
          {/* Summary Cards */}
          {summary && <SummaryCards summary={summary} />}

          {/* Summary Table per CP */}
          {byCp.length > 0 && <SummaryTable byCp={byCp} />}

          {/* Chart Section — Transaksi */}
          {byCp.length > 0 && (
            <div className="space-y-4">
              <ChartSection
                title={`Total Transaksi per EVCS ${mode === "daily" ? "Periode Ini" : `Tahun ${year}`}`}
                icon={<BarChart3 className="w-3.5 h-3.5 text-blue-400" />}
                byCp={byCp} dataKey="tx" color="#3b82f6"
                formatter={(v) => `${v} tx`}
                yTickFormatter={(v) => String(v)}
              />

              {/* Daily timeline — Transaksi */}
              {mode === "daily" && cpList.length > 0 && (
                <DailyTimelineChart
                  title="Transaksi per EVCS per Hari"
                  icon={<BarChart3 className="w-3.5 h-3.5 text-blue-400" />}
                  dailyByCpDate={dailyByCpDate} cpList={cpList} dataKey="tx"
                  formatter={(v) => `${v} tx`}
                  yTickFormatter={(v) => String(v)}
                  colors={COLORS}
                />
              )}

              {/* Energi */}
              <ChartSection
                title={`Total Konsumsi Energi per EVCS ${mode === "daily" ? "Periode Ini" : `Tahun ${year}`}`}
                icon={<Zap className="w-3.5 h-3.5 text-emerald-400" />}
                byCp={byCp} dataKey="kwh" color="#10b981"
                formatter={(v) => `${v.toFixed(2)} kWh`}
                yTickFormatter={(v) => `${v}`}
              />

              {mode === "daily" && cpList.length > 0 && (
                <DailyTimelineChart
                  title="Konsumsi Energi per EVCS per Hari (kWh)"
                  icon={<Zap className="w-3.5 h-3.5 text-emerald-400" />}
                  dailyByCpDate={dailyByCpDate} cpList={cpList} dataKey="kwh"
                  formatter={(v) => `${v.toFixed(2)} kWh`}
                  yTickFormatter={(v) => `${v}`}
                  colors={COLORS}
                />
              )}

              {/* Biaya */}
              <ChartSection
                title={`Total Biaya Energi per EVCS ${mode === "daily" ? "Periode Ini" : `Tahun ${year}`}`}
                icon={<Receipt className="w-3.5 h-3.5 text-amber-400" />}
                byCp={byCp} dataKey="rev" color="#f59e0b"
                formatter={(v) => formatIDR(v)}
                yTickFormatter={(v) => formatIDRShort(v)}
              />

              {mode === "daily" && cpList.length > 0 && (
                <DailyTimelineChart
                  title="Biaya Energi per EVCS per Hari (IDR)"
                  icon={<Receipt className="w-3.5 h-3.5 text-amber-400" />}
                  dailyByCpDate={dailyByCpDate} cpList={cpList} dataKey="rev"
                  formatter={(v) => formatIDR(v)}
                  yTickFormatter={(v) => formatIDRShort(v)}
                  colors={COLORS}
                />
              )}
            </div>
          )}

          {/* Empty state */}
          {byCp.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 bg-gray-900 border border-gray-800 rounded-xl">
              <FileBarChart2 className="w-10 h-10 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Tidak ada data untuk periode ini</p>
              <p className="text-xs text-gray-600 mt-1">Coba ubah rentang tanggal atau filter CP</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
