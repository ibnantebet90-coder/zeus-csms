"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, RefreshCw, Download, X, ChevronRight,
  Zap, Clock, BatteryCharging, Filter, Ticket, Check,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────
interface Transaction {
  id: number;
  transaction_id: number;
  charge_point_id: string;
  connector_id: number;
  id_tag: string | null;
  start_timestamp: string | null;
  stop_timestamp: string | null;
  meter_start: number | null;
  meter_stop: number | null;
  energy_consumed_kwh: number | null;
  tariff_per_kwh: number | null;
  total_cost: number | null;
  stop_reason: string | null;
  status: string;

  // [Billing v0.5]
  pricing_scheme: string | null;
  energy_cost: number | null;
  pbjt_rate: number | null;
  pbjt_amount: number | null;
  service_fee_per_kwh: number | null;
  service_fee_amount: number | null;
  subtotal: number | null;
  ppn_rate: number | null;
  ppn_base: number | null;
  ppn_amount: number | null;
  total_amount: number | null;
  voucher_code: string | null;
  discount_type: string | null;
  discount_value: number | null;
  discount_amount: number | null;
}

// ── Helpers ───────────────────────────────────────────────────
const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const formatDuration = (start: string | null, stop: string | null) => {
  if (!start || !stop) return "-";
  const diff = Math.floor((new Date(stop).getTime() - new Date(start).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
};

const statusStyle: Record<string, string> = {
  Active: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Completed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Invalid: "text-gray-400 bg-gray-700/50 border-gray-600/20",
};

// ── Apply Voucher ─────────────────────────────────────────────
function ApplyVoucherForm({ tx }: { tx: Transaction }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const applyMut = useMutation({
    mutationFn: (voucher_code: string) =>
      api.post("/api/vouchers/apply", { transaction_id: tx.id, voucher_code }),
    onSuccess: () => {
      setError("");
      setSuccess(true);
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err: any) => {
      setSuccess(false);
      setError(err.response?.data?.detail ?? "Gagal menerapkan voucher");
    },
  });

  if (success) {
    return (
      <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">
        <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        <p className="text-xs text-emerald-400">Voucher berhasil diterapkan. Tutup dan buka kembali detail untuk lihat total terbaru.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-xl p-4 space-y-2.5">
      <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
        <Ticket className="w-3.5 h-3.5" /> Pakai Voucher
      </p>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Kode voucher"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
        />
        <button
          onClick={() => code && applyMut.mutate(code)}
          disabled={!code || applyMut.isPending}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-gray-950 font-semibold text-xs rounded-lg transition-colors flex-shrink-0">
          {applyMut.isPending ? "..." : "Terapkan"}
        </button>
      </div>
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────
function DetailPanel({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const displayTotal = tx.total_amount ?? tx.total_cost;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-md bg-gray-900 border-l border-gray-800 overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-sm font-semibold text-white">Transaksi #{tx.transaction_id}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{tx.charge_point_id} · Konektor {tx.connector_id}</p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Status */}
          <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border ${statusStyle[tx.status] ?? statusStyle.Invalid}`}>
            {tx.status}
          </span>

          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-xl p-3 text-center">
              <Zap className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">
                {tx.energy_consumed_kwh ? `${tx.energy_consumed_kwh}` : "-"}
              </p>
              <p className="text-xs text-gray-500">kWh</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-3 text-center">
              <Receipt className="w-4 h-4 text-amber-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">
                {displayTotal != null ? formatIDR(displayTotal) : "-"}
              </p>
              <p className="text-xs text-gray-500">Total Biaya</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-3 text-center">
              <Clock className="w-4 h-4 text-blue-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">
                {formatDuration(tx.start_timestamp, tx.stop_timestamp)}
              </p>
              <p className="text-xs text-gray-500">Durasi</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-3 text-center">
              <BatteryCharging className="w-4 h-4 text-purple-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">
                {tx.tariff_per_kwh ? formatIDR(tx.tariff_per_kwh) : "-"}
              </p>
              <p className="text-xs text-gray-500">Tarif/kWh</p>
            </div>
          </div>

          {/* Rincian Biaya */}
          {tx.total_amount != null && (
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium text-gray-400 mb-2">Rincian Biaya</p>
              {[
                { label: "Biaya Energi", value: tx.energy_cost },
                { label: `PBJT-TL (${tx.pbjt_rate != null ? (tx.pbjt_rate * 100).toFixed(0) : "-"}%)`, value: tx.pbjt_amount },
                { label: "Service Fee", value: tx.service_fee_amount },
                { label: "Subtotal", value: tx.subtotal, bold: true },
              ].map(({ label, value, bold }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className={`text-xs ${bold ? "font-semibold text-white" : "text-gray-300"}`}>
                    {value != null ? formatIDR(value) : "-"}
                  </span>
                </div>
              ))}

              {tx.voucher_code && (
                <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
                  <span className="text-xs text-emerald-400">
                    Voucher {tx.voucher_code}
                    {tx.discount_type === "percent" && tx.discount_value != null && ` (-${tx.discount_value}%)`}
                  </span>
                  <span className="text-xs text-emerald-400">
                    -{formatIDR(tx.discount_amount ?? 0)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  PPN ({tx.ppn_rate != null ? (tx.ppn_rate * 100).toFixed(0) : "-"}%)
                </span>
                <span className="text-xs text-gray-300">
                  {tx.ppn_amount != null ? formatIDR(tx.ppn_amount) : "-"}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                <span className="text-xs font-semibold text-white">Total Bayar</span>
                <span className="text-sm font-bold text-emerald-400">
                  {formatIDR(tx.total_amount)}
                </span>
              </div>
            </div>
          )}

          {/* Pakai Voucher — hanya untuk transaksi Completed yang belum pakai voucher */}
          {tx.status === "Completed" && !tx.voucher_code && (
            <ApplyVoucherForm tx={tx} />
          )}

          {/* Detail rows */}
          <div className="space-y-3">
            {[
              { label: "Transaction ID", value: String(tx.transaction_id), mono: true },
              { label: "Charge Point", value: tx.charge_point_id, mono: true },
              { label: "Konektor", value: String(tx.connector_id) },
              { label: "ID Tag", value: tx.id_tag ?? "-", mono: true },
              { label: "Mulai", value: formatTime(tx.start_timestamp) },
              { label: "Selesai", value: formatTime(tx.stop_timestamp) },
              { label: "Meter Start", value: tx.meter_start != null ? `${tx.meter_start} Wh` : "-" },
              { label: "Meter Stop", value: tx.meter_stop != null ? `${tx.meter_stop} Wh` : "-" },
              { label: "Stop Reason", value: tx.stop_reason ?? "-" },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <span className="text-xs text-gray-500 flex-shrink-0 w-28">{label}</span>
                <span className={`text-xs text-right break-all ${mono ? "font-mono text-emerald-400" : "text-gray-200"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Export CSV ────────────────────────────────────────────────
function exportCSV(data: Transaction[]) {
  const headers = [
    "ID", "Transaction ID", "Charge Point", "Konektor", "ID Tag",
    "Mulai", "Selesai", "Durasi", "Meter Start (Wh)", "Meter Stop (Wh)",
    "Energi (kWh)", "Tarif (Rp/kWh)",
    "Biaya Energi", "PBJT", "Service Fee", "Subtotal",
    "Voucher", "Diskon", "PPN", "Total (Rp)",
    "Stop Reason", "Status",
  ];
  const rows = data.map((tx) => [
    tx.id, tx.transaction_id, tx.charge_point_id, tx.connector_id,
    tx.id_tag ?? "",
    tx.start_timestamp ? new Date(tx.start_timestamp).toLocaleString("id-ID") : "",
    tx.stop_timestamp ? new Date(tx.stop_timestamp).toLocaleString("id-ID") : "",
    formatDuration(tx.start_timestamp, tx.stop_timestamp),
    tx.meter_start ?? "", tx.meter_stop ?? "",
    tx.energy_consumed_kwh ?? "", tx.tariff_per_kwh ?? "",
    tx.energy_cost ?? "", tx.pbjt_amount ?? "", tx.service_fee_amount ?? "", tx.subtotal ?? "",
    tx.voucher_code ?? "", tx.discount_amount ?? "", tx.ppn_amount ?? "",
    tx.total_amount ?? tx.total_cost ?? "",
    tx.stop_reason ?? "", tx.status,
  ]);

  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transaksi_zeus_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Page ─────────────────────────────────────────────────
export default function TransactionsPage() {
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [statusFilter, setStatus] = useState("all");
  const [cpFilter, setCp] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [limit, setLimit] = useState(50);

  // Build query params
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (cpFilter) params.set("charge_point_id", cpFilter);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);

  const { data: transactions = [], isLoading, refetch } = useQuery<Transaction[]>({
    queryKey: ["transactions", statusFilter, cpFilter, dateFrom, dateTo, limit],
    queryFn: () => api.get(`/api/transactions?${params}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  // Stats
  const total = transactions.length;
  const active = transactions.filter((t) => t.status === "Active").length;
  const completed = transactions.filter((t) => t.status === "Completed").length;
  const totalEnergy = transactions.reduce((s, t) => s + (t.energy_consumed_kwh ?? 0), 0);
  const totalRevenue = transactions.reduce((s, t) => s + (t.total_amount ?? t.total_cost ?? 0), 0);

  const hasFilter = statusFilter !== "all" || cpFilter || dateFrom || dateTo;

  const clearFilters = () => {
    setStatus("all"); setCp(""); setDateFrom(""); setDateTo("");
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Transaksi</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} transaksi ditemukan</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilter(!showFilter)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${showFilter || hasFilter
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
          <button onClick={() => exportCSV(transactions)} disabled={!transactions.length}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 text-sm rounded-lg transition-colors">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Aktif", value: active, color: "text-blue-400" },
          { label: "Selesai", value: completed, color: "text-emerald-400" },
          { label: "Total Energi", value: `${totalEnergy.toFixed(1)} kWh`, color: "text-amber-400" },
          { label: "Total Pendapatan", value: formatIDR(totalRevenue), color: "text-purple-400" },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-400">Filter Transaksi</p>
            {hasFilter && (
              <button onClick={clearFilters}
                className="text-xs text-red-400 hover:text-red-300 transition-colors">
                Reset filter
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Status</label>
              <select value={statusFilter} onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors">
                <option value="all">Semua</option>
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
                <option value="Invalid">Invalid</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Charge Point ID</label>
              <input value={cpFilter} onChange={(e) => setCp(e.target.value)}
                placeholder="CP001"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
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
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
        </div>
      ) : transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-gray-900 border border-gray-800 rounded-xl">
          <Receipt className="w-10 h-10 text-gray-700 mb-3" />
          <p className="text-sm text-gray-500">Belum ada transaksi</p>
          <p className="text-xs text-gray-600 mt-1">Transaksi akan muncul saat charge point mulai digunakan</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">ID</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Charge Point</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">ID Tag</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Mulai</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Durasi</th>
                  <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Energi</th>
                  <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Biaya</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}
                    onClick={() => setSelected(tx)}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors group">
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">#{tx.transaction_id}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-xs font-medium text-white">{tx.charge_point_id}</p>
                        <p className="text-xs text-gray-500">Konektor {tx.connector_id}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-emerald-400/80">
                      {tx.id_tag ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {formatTime(tx.start_timestamp)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {formatDuration(tx.start_timestamp, tx.stop_timestamp)}
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-white">
                      {tx.energy_consumed_kwh != null ? `${tx.energy_consumed_kwh} kWh` : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-white">
                      {(tx.total_amount ?? tx.total_cost) != null ? formatIDR(tx.total_amount ?? tx.total_cost!) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle[tx.status] ?? statusStyle.Invalid}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
            <p className="text-xs text-gray-500">Menampilkan {transactions.length} transaksi</p>
            {transactions.length >= limit && (
              <button onClick={() => setLimit(limit + 50)}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                Muat lebih banyak →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && <DetailPanel tx={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}