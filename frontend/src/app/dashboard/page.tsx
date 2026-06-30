"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Zap, Receipt, TrendingUp, Wifi, RefreshCw } from "lucide-react";
import EvChargerIcon from "@/components/EvChargerIcon";
import api from "@/lib/axios";

interface Summary {
  total_charge_points: number;
  online_charge_points: number;
  active_transactions: number;
  total_transactions_today: number;
  total_energy_today_kwh: number;
  total_revenue_today: number;
}

interface Transaction {
  id: number;
  transaction_id: number;
  charge_point_id: string;
  start_timestamp: string;
  energy_consumed_kwh: number;
  status: string;
}

interface ChargePoint {
  id: number;
  charge_point_id: string;
  name: string;
  cp_status: string;
  is_online: boolean;
  last_heartbeat: string;
}

const statusColor: Record<string, string> = {
  Available: "text-emerald-400 bg-emerald-500/10",
  Charging: "text-blue-400 bg-blue-500/10",
  Faulted: "text-red-400 bg-red-500/10",
  Unavailable: "text-gray-400 bg-gray-700/50",
  Preparing: "text-amber-400 bg-amber-500/10",
  Unknown: "text-gray-500 bg-gray-800",
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatTime = (iso: string) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-medium text-white">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

function StatCard({ title, value, subtitle, icon: Icon, color, customIcon }: {
  title: string; value: string | number; subtitle?: string;
  icon?: any; color: string; customIcon?: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    purple: "bg-purple-500/10 border-purple-500/20 text-purple-400",
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 transition-colors hover:border-gray-700">
      <div className="flex items-start justify-between mb-4">
        <p className="text-sm text-gray-400">{title}</p>
        {customIcon ? (
          customIcon
        ) : (
          <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${colors[color]}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}

const energyData = [
  { day: "Sen", energy: 142 }, { day: "Sel", energy: 198 },
  { day: "Rab", energy: 167 }, { day: "Kam", energy: 221 },
  { day: "Jum", energy: 189 }, { day: "Sab", energy: 254 },
  { day: "Min", energy: 0 },
];

export default function DashboardPage() {
  const { data: summary, isLoading, refetch } = useQuery<Summary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get("/api/dashboard/summary").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: transactions } = useQuery<Transaction[]>({
    queryKey: ["transactions-recent"],
    queryFn: () => api.get("/api/transactions?limit=10").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: chargePoints } = useQuery<ChargePoint[]>({
    queryKey: ["charge-points-list"],
    queryFn: () => api.get("/api/charge-points").then((r) => r.data),
    refetchInterval: 15000,
  });

  const statusData = chargePoints
    ? Object.entries(chargePoints.reduce((acc: Record<string, number>, cp) => {
      acc[cp.cp_status] = (acc[cp.cp_status] ?? 0) + 1;
      return acc;
    }, {})).map(([name, value]) => ({ name, value }))
    : [];

  const today = energyData.map((d, i) =>
    i === 6 ? { ...d, energy: summary?.total_energy_today_kwh ?? 0 } : d
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">Memuat data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 hover:text-white transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          title="Total Charge Points"
          value={summary?.total_charge_points ?? 0}
          subtitle={`${summary?.online_charge_points ?? 0} online`}
          color="emerald"
          customIcon={
            <EvChargerIcon
              status={(summary?.active_transactions ?? 0) > 0 ? "Charging" : "Available"}
              size={36}
            />
          }
        />
        <StatCard title="Transaksi Aktif" value={summary?.active_transactions ?? 0}
          subtitle="Sedang mengisi daya" icon={Zap} color="blue" />
        <StatCard title="Transaksi Hari Ini" value={summary?.total_transactions_today ?? 0}
          subtitle="Total sesi hari ini" icon={Receipt} color="purple" />
        <StatCard title="Energi Hari Ini" value={`${(summary?.total_energy_today_kwh ?? 0).toFixed(1)} kWh`}
          subtitle="Total energi tersalurkan" icon={TrendingUp} color="amber" />
        <StatCard title="Pendapatan Hari Ini" value={formatIDR(summary?.total_revenue_today ?? 0)}
          subtitle="Dari transaksi selesai" icon={Receipt} color="emerald" />
        <StatCard title="CP Online" value={`${summary?.online_charge_points ?? 0} / ${summary?.total_charge_points ?? 0}`}
          subtitle="Charge point terhubung" icon={Wifi} color="blue" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Energi 7 Hari Terakhir (kWh)</h2>
            {(summary?.active_transactions ?? 0) > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={today} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradEnergy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="energy" name="kWh" stroke="#10b981"
                strokeWidth={2} fill="url(#gradEnergy)"
                dot={{ fill: "#10b981", r: 3 }}
                activeDot={{ r: 5, stroke: "#10b981", strokeWidth: 2, fill: "#030712" }}
                animationDuration={600} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Status Charge Points</h2>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusData} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="Jumlah" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">
              Belum ada charge point
            </div>
          )}
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Transaksi Terbaru</h2>
            <span className="text-xs text-gray-500">{transactions?.length ?? 0} data</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-gray-500 font-medium">ID</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Charge Point</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Mulai</th>
                <th className="px-4 py-3 text-right text-gray-500 font-medium">Energi</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions?.length ? transactions.map((tx) => (
                <tr key={tx.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-gray-400 font-mono">#{tx.transaction_id}</td>
                  <td className="px-4 py-3 text-white">{tx.charge_point_id}</td>
                  <td className="px-4 py-3 text-gray-400">{formatTime(tx.start_timestamp)}</td>
                  <td className="px-4 py-3 text-right text-white">{tx.energy_consumed_kwh ? `${tx.energy_consumed_kwh} kWh` : "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-md font-medium ${tx.status === "Active" ? "bg-blue-500/10 text-blue-400" : tx.status === "Completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-700 text-gray-400"}`}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600">Belum ada transaksi</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Status Charge Points</h2>
            <span className="text-xs text-gray-500">{chargePoints?.length ?? 0} terdaftar</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Nama</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">ID</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Status</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {chargePoints?.length ? chargePoints.map((cp) => (
                <tr key={cp.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{cp.name}</td>
                  <td className="px-4 py-3 text-gray-400 font-mono">{cp.charge_point_id}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-md font-medium ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
                      {cp.cp_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{cp.last_heartbeat ? formatTime(cp.last_heartbeat) : "-"}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">Belum ada charge point</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
