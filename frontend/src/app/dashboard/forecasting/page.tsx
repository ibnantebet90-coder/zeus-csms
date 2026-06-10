"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp, RefreshCw, BarChart2, Activity,
  Info, CheckCircle, AlertCircle,
} from "lucide-react";
import api from "@/lib/axios";
import ImportExportPanel from "@/components/ImportExportPanel";

// ── Types ─────────────────────────────────────────────────
interface Metrics { mape: number; mae: number; mse: number; rmse: number; r2: number; }
interface ForecastResponse {
  method: string; split_ratio: number; look_back: number;
  dates_all: string[]; actual: number[];
  train_predicted: number[]; test_predicted: number[];
  forecast_values: number[]; forecast_dates: string[];
  train_size: number; test_size: number;
  metrics_train: Metrics; metrics_test: Metrics;
  error?: string; unit: string;
}
interface Summary {
  period_days: number; total_sessions: number;
  total_energy_kwh: number; total_revenue_idr: number;
  avg_energy_kwh: number; avg_duration_min: number;
}
interface CP { charge_point_id: string; name: string; }

// ── Constants ──────────────────────────────────────────────
const METHODS = [
  { value: "arima", label: "ARIMA", desc: "AutoRegressive Integrated Moving Average — cocok untuk data stasioner dengan musiman" },
  { value: "ls", label: "LS", desc: "Least Squares / Linear Regression — baseline sederhana dan cepat" },
  { value: "svr", label: "SVR", desc: "Support Vector Regression — kuat untuk data nonlinear dengan noise" },
  { value: "xgboost", label: "XGBoost", desc: "Gradient Boosting — performa tinggi untuk data tabular dengan fitur kompleks" },
  { value: "ann", label: "ANN", desc: "Artificial Neural Network — fleksibel untuk pola nonlinear" },
  { value: "lstm", label: "LSTM", desc: "Long Short-Term Memory — terbaik untuk dependensi jangka panjang dalam time series" },
];

const SPLITS = [
  { value: 0.9, label: "90 : 10" },
  { value: 0.8, label: "80 : 20" },
  { value: 0.7, label: "70 : 30" },
  { value: 0.6, label: "60 : 40" },
];

const CHART_VIEWS = [
  { value: "actual", label: "Actual Dataset" },
  { value: "train_test", label: "Train vs Test" },
  { value: "test_forecast", label: "Test + Forecast" },
];

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

// ── Custom Tooltip ─────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl min-w-[140px]">
      <p className="text-gray-400 mb-2 font-medium border-b border-gray-800 pb-1">{label}</p>
      {payload.filter((p: any) => p.value != null && p.value !== 0).map((p: any) => (
        <div key={p.name} className="flex items-center justify-between gap-3 mb-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-400">{p.name}</span>
          </div>
          <span className="font-semibold text-white">{typeof p.value === "number" ? p.value.toFixed(2) : p.value} kWh</span>
        </div>
      ))}
    </div>
  );
};

// ── Metrics Card ───────────────────────────────────────────
function MetricsCard({ title, metrics, color }: { title: string; metrics: Metrics; color: string }) {
  const items = [
    { label: "MAPE", value: `${metrics.mape.toFixed(2)}%`, good: metrics.mape < 10 },
    { label: "MAE", value: metrics.mae.toFixed(4), good: true },
    { label: "MSE", value: metrics.mse.toFixed(4), good: true },
    { label: "RMSE", value: metrics.rmse.toFixed(4), good: true },
    { label: "R²", value: metrics.r2.toFixed(4), good: metrics.r2 > 0.8 },
  ];
  return (
    <div className={`bg-gray-900 border rounded-xl overflow-hidden ${color}`}>
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-xs font-semibold text-white">{title}</p>
      </div>
      <div className="p-3 space-y-1.5">
        {items.map(({ label, value, good }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-xs text-gray-500 w-12">{label}</span>
            <div className="flex items-center gap-1.5">
              {good
                ? <CheckCircle className="w-3 h-3 text-emerald-400" />
                : <AlertCircle className="w-3 h-3 text-amber-400" />}
              <span className="text-xs font-mono font-medium text-white">{value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function ForecastingPage() {
  const [method, setMethod] = useState("arima");
  const [cpFilter, setCp] = useState("");
  const [histDays, setHist] = useState(60);
  const [forecastDays, setForecast] = useState(7);
  const [splitRatio, setSplit] = useState(0.8);
  const [lookBack, setLookBack] = useState(7);
  const [chartView, setChartView] = useState("train_test");
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [submitted, setSubmitted] = useState(false);
  const [importedData, setImportedData] = useState<{ date: string; value: number }[] | null>(null);

  const { data: chargePoints = [] } = useQuery<CP[]>({
    queryKey: ["charge-points"],
    queryFn: () => api.get("/api/charge-points").then(r => r.data),
  });

  const params = new URLSearchParams({
    method, history_days: String(histDays),
    forecast_days: String(forecastDays),
    split_ratio: String(splitRatio),
    look_back: String(lookBack),
    ...(cpFilter && { charge_point_id: cpFilter }),
  });

  const { data, isLoading, refetch, isFetching } = useQuery<ForecastResponse>({
    queryKey: ["forecast-v2", method, cpFilter, histDays, forecastDays, splitRatio, lookBack, importedData],
    queryFn: async () => {
      const res = await api.get(`/api/forecasting/energy?${params}`);
      return res.data;
    },
    enabled: submitted,
    staleTime: 0,
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ["forecast-summary", cpFilter, histDays],
    queryFn: () => api.get(`/api/forecasting/summary?days=${histDays}${cpFilter ? `&charge_point_id=${cpFilter}` : ""}`).then(r => r.data),
  });

  // Build chart data
  const buildChartData = () => {
    if (importedData) {
      return importedData.map((d) => ({
        date: fmtDate(d.date),
        Actual: d.value,
        fullDate: d.date,
      }));
    }
    if (!data) return [];
    const allDates = [...data.dates_all, ...data.forecast_dates];

    return allDates.map((date, i) => {
      const isForecast = i >= data.dates_all.length;
      const actualIdx = i;
      const isTrainIdx = !isForecast && actualIdx < data.train_size;
      const isTestIdx = !isForecast && actualIdx >= data.train_size;

      const point: any = { date: fmtDate(date), fullDate: date };

      if (chartView === "actual") {
        if (!isForecast) point.Actual = data.actual[actualIdx];
      } else if (chartView === "train_test") {
        if (!isForecast) {
          point.Actual = data.actual[actualIdx];
          if (isTrainIdx && data.train_predicted[actualIdx] > 0)
            point.Train = data.train_predicted[actualIdx];
          if (isTestIdx && data.test_predicted[actualIdx] > 0)
            point.Test = data.test_predicted[actualIdx];
        }
      } else if (chartView === "test_forecast") {
        if (isTestIdx) {
          point.Actual = data.actual[actualIdx];
          if (data.test_predicted[actualIdx] > 0)
            point["Test Pred"] = data.test_predicted[actualIdx];
        }
        if (isForecast) {
          point.Forecast = data.forecast_values[i - data.dates_all.length];
        }
      }
      return point;
    });
  };

  const chartData = buildChartData();
  const trainBoundaryDate = data ? fmtDate(data.dates_all[data.train_size - 1] ?? "") : "";
  const testBoundaryDate = data ? fmtDate(data.dates_all[data.dates_all.length - 1] ?? "") : "";

  const lineColors: Record<string, string> = {
    "Actual": "#6b7280",
    "Train": "#10b981",
    "Test": "#3b82f6",
    "Test Pred": "#f59e0b",
    "Forecast": "#a855f7",
  };

  const selectedMethod = METHODS.find(m => m.value === method);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Forecasting Energi</h1>
          <p className="text-sm text-gray-500 mt-0.5">Prediksi konsumsi energi dengan Machine Learning</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        {/* ── Sidebar Konfigurasi ── */}
        <div className="xl:col-span-1 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Konfigurasi</p>

            {/* Charge Point */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Charge Point
                <select id="cp_select" name="charge_point_id" value={cpFilter} onChange={e => setCp(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 mt-1.5">

                  <option value="">Semua CP</option>
                  {chargePoints.map(cp => (
                    <option key={cp.charge_point_id} value={cp.charge_point_id}>{cp.charge_point_id}</option>
                  ))}

                </select>
              </label>
            </div>

            {/* Model */}
            <div>
              <p className="block text-xs text-gray-500 mb-1.5 font-medium">Model</p>
              <div className="space-y-1">
                {METHODS.map(m => (
                  <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${method === m.value
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white border border-transparent"
                      }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Train/Test Split */}
            <div>
              <p className="block text-xs text-gray-500 mb-1.5 font-medium">Train / Test Split</p>
              <div className="grid grid-cols-2 gap-1.5">
                {SPLITS.map(s => (
                  <button key={s.value} type="button" onClick={() => setSplit(s.value)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${splitRatio === s.value
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                      : "bg-gray-800 text-gray-400 hover:text-white border border-transparent"
                      }`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* History Days */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Data Historis <span className="text-white font-medium">{histDays} hari</span>
                <input id="hist_days_range" name="history_days" type="range" min={14} max={180} step={7} value={histDays} onChange={e => setHist(Number(e.target.value))} className="w-full accent-emerald-500 mt-1.5" />
              </label>
            </div>

            {/* Forecast Days */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Day to Forecast <span className="text-white font-medium">{forecastDays} hari</span>
                <input id="forecast_days_range" name="forecast_days" type="range" min={1} max={60} step={1} value={forecastDays} onChange={e => setForecast(Number(e.target.value))} className="w-full accent-purple-500 mt-1.5" />
              </label>
            </div>

            {/* Look Back */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Look Back <span className="text-white font-medium">{lookBack} hari</span>
                <input id="lookback_range" name="look_back" type="range" min={3} max={30} step={1} value={lookBack} onChange={e => setLookBack(Number(e.target.value))} className="w-full accent-blue-500 mt-1.5" />
              </label>
            </div>

            {/* Import / Export */}
            <ImportExportPanel
              onImport={(data) => setImportedData(data)}
              cpFilter={cpFilter}
              histDays={histDays}
              method={method}
              forecastDays={forecastDays}
              splitRatio={splitRatio}
              lookBack={lookBack}
            />

            {/* Run Button */}
            <button
              onClick={() => { setSubmitted(true); refetch(); }}
              disabled={isLoading || isFetching}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
              {(isLoading || isFetching)
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Memproses...</>
                : <><TrendingUp className="w-4 h-4" /> Jalankan Model</>}
            </button>
          </div>

          {/* Method description */}
          {selectedMethod && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-xs font-semibold text-white">{selectedMethod.label}</p>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{selectedMethod.desc}</p>
            </div>
          )}
        </div>

        {/* ── Main Content ── */}
        <div className="xl:col-span-3 space-y-4">

          {/* Chart View Selector */}
          {data && !data.error && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    {data.method.toUpperCase()} — Visualisasi Hasil
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Split {Math.round(data.split_ratio * 100)}:{Math.round((1 - data.split_ratio) * 100)} ·
                    Train: {data.train_size} hari · Test: {data.test_size} hari · LB: {data.look_back}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Chart type toggle */}
                  <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                    <button onClick={() => setChartType("line")}
                      className={`p-1.5 rounded-md transition-colors ${chartType === "line" ? "bg-gray-700 text-white" : "text-gray-500"}`}>
                      <Activity className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setChartType("bar")}
                      className={`p-1.5 rounded-md transition-colors ${chartType === "bar" ? "bg-gray-700 text-white" : "text-gray-500"}`}>
                      <BarChart2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* View selector */}
                  <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                    {CHART_VIEWS.map(v => (
                      <button key={v.value} onClick={() => setChartView(v.value)}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${chartView === v.value ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                          }`}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    interval={Math.floor(chartData.length / 10)} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend formatter={(v) => <span style={{ color: lineColors[v] || "#9ca3af", fontSize: 11 }}>{v}</span>} />

                  {/* Reference lines */}
                  {chartView === "train_test" && trainBoundaryDate && (
                    <ReferenceLine x={trainBoundaryDate} stroke="#374151" strokeDasharray="4 4"
                      label={{ value: "Train|Test", fill: "#6b7280", fontSize: 9 }} />
                  )}
                  {chartView === "test_forecast" && testBoundaryDate && (
                    <ReferenceLine x={testBoundaryDate} stroke="#374151" strokeDasharray="4 4"
                      label={{ value: "Today", fill: "#6b7280", fontSize: 9 }} />
                  )}

                  {Object.keys(lineColors).map(key => {
                    const hasKey = chartData.some((d: any) => d[key] != null);
                    if (!hasKey) return null;
                    if (chartType === "bar") {
                      return <Bar key={key} dataKey={key} fill={lineColors[key]}
                        fillOpacity={0.7} radius={[2, 2, 0, 0]} />;
                    }
                    return <Line key={key} type="monotone" dataKey={key}
                      stroke={lineColors[key]} strokeWidth={key === "Actual" ? 1.5 : 2}
                      strokeDasharray={key === "Forecast" ? "6 3" : undefined}
                      dot={false} connectNulls={false} />;
                  })}
                </ComposedChart>
              </ResponsiveContainer>

              {/* Color legend */}
              <div className="flex flex-wrap gap-4 mt-3 justify-center">
                {[
                  { color: "#6b7280", label: "Actual" },
                  { color: "#10b981", label: "Train Pred" },
                  { color: "#3b82f6", label: "Test Pred" },
                  { color: "#f59e0b", label: "Test Pred (view)" },
                  { color: "#a855f7", label: "Forecast", dash: true },
                ].map(({ color, label, dash }) => (
                  <div key={label} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <div className="w-6 h-0.5" style={{
                      background: color,
                      borderTop: dash ? `2px dashed ${color}` : `2px solid ${color}`,
                    }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metrics */}
          {data && !data.error && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <MetricsCard
                title={`In-Sample Metrics (Train · ${data.train_size} data)`}
                metrics={data.metrics_train}
                color="border-emerald-500/20"
              />
              <MetricsCard
                title={`Out-of-Sample Metrics (Test · ${data.test_size} data)`}
                metrics={data.metrics_test}
                color="border-blue-500/20"
              />
            </div>
          )}

          {/* Forecast table */}
          {data && !data.error && data.forecast_values.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-white">
                  Nilai Prediksi — {forecastDays} Hari ke Depan
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Hari ke-</th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Tanggal</th>
                      <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Prediksi (kWh)</th>
                      <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Visualisasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.forecast_values.map((v, i) => {
                      const max = Math.max(...data.forecast_values);
                      const pct = max > 0 ? (v / max) * 100 : 0;
                      return (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-2.5 text-gray-400">+{i + 1}</td>
                          <td className="px-4 py-2.5 text-gray-300">{data.forecast_dates[i]}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-purple-400 font-semibold">{v.toFixed(3)}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-24 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                <div className="h-full bg-purple-500 rounded-full"
                                  style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-gray-600 w-8 text-right">{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-700 bg-gray-800/30">
                      <td colSpan={2} className="px-4 py-2.5 text-gray-400 font-medium">Total</td>
                      <td className="px-4 py-2.5 text-right font-mono text-white font-bold">
                        {data.forecast_values.reduce((s, v) => s + v, 0).toFixed(3)} kWh
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Error */}
          {data?.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
              <strong>Error:</strong> {data.error}
              <p className="text-xs mt-1 text-red-300">Pastikan library sudah terinstall: pip install statsmodels xgboost tensorflow</p>
            </div>
          )}

          {/* Empty state */}
          {!submitted && !importedData && (
            <div className="flex flex-col items-center justify-center h-64 bg-gray-900 border border-gray-800 rounded-xl">
              <TrendingUp className="w-12 h-12 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Pilih model dan konfigurasi di sebelah kiri</p>
              <p className="text-xs text-gray-600 mt-1">lalu klik <strong className="text-gray-400">Jalankan Model</strong></p>
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-white">Statistik {histDays} Hari Terakhir</h2>
              </div>
              <div className="grid grid-cols-3 divide-x divide-y divide-gray-800">
                {[
                  { label: "Total Sesi", value: String(summary.total_sessions), unit: "sesi" },
                  { label: "Total Energi", value: String(summary.total_energy_kwh), unit: "kWh" },
                  { label: "Pendapatan", value: formatIDR(summary.total_revenue_idr), unit: "" },
                  { label: "Avg Energi", value: String(summary.avg_energy_kwh), unit: "kWh/sesi" },
                  { label: "Avg Durasi", value: String(summary.avg_duration_min), unit: "menit" },
                  { label: "Periode", value: String(summary.period_days), unit: "hari" },
                ].map(s => (
                  <div key={s.label} className="px-5 py-4">
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className="text-base font-bold text-white">
                      {s.value} <span className="text-xs font-normal text-gray-500">{s.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
