"use client";

import { useState, useRef } from "react";
import { Upload, Download, FileText, Table2, FileJson, X, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import api from "@/lib/axios";

interface DataPoint { date: string; value: number; }
interface ImportResponse { success: boolean; rows: number; data: DataPoint[]; errors: string[]; source: string; }

interface Props {
  onImport: (data: DataPoint[]) => void;
  cpFilter: string; histDays: number; method: string;
  forecastDays: number; splitRatio: number; lookBack: number;
}

const SOURCE_LABEL: Record<string, string> = {
  transaction: "Format Transaksi ZEUS",
  daily: "Format Harian",
  custom: "Format Custom",
};

export default function ImportExportPanel({ onImport, cpFilter, histDays, method, forecastDays, splitRatio, lookBack }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [incForecast, setIncForecast] = useState(false);
  const [exportType, setExportType] = useState<"transaction" | "daily">("transaction");
  const [templateType, setTemplateType] = useState<"transaction" | "daily">("transaction");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<ImportResponse>("/api/forecasting/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
      if (res.data.success && res.data.data.length > 0) onImport(res.data.data);
    } catch (err: any) {
      setResult({ success: false, rows: 0, data: [], errors: [err.response?.data?.detail ?? "Gagal upload"], source: "" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleExport = async (format: "csv" | "xlsx" | "json") => {
    setExporting(format);
    try {
      const params = new URLSearchParams({
        format, days: String(histDays), export_type: exportType,
        include_forecast: String(incForecast), method,
        forecast_days: String(forecastDays), split_ratio: String(splitRatio),
        look_back: String(lookBack),
        ...(cpFilter && { charge_point_id: cpFilter }),
      });
      const res = await api.get(`/api/forecasting/export?${params}`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `zeus_${exportType}_${new Date().toISOString().slice(0, 10)}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
    finally { setExporting(""); }
  };

  const handleTemplate = async (format: "csv" | "xlsx") => {
    try {
      const res = await api.get(`/api/forecasting/template?format=${format}&template_type=${templateType}`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `template_${templateType}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Import / Export</p>

      {/* ── IMPORT ── */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium">Import Data</p>
        <div onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-emerald-500/50 rounded-xl p-4 text-center cursor-pointer transition-colors group">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
          {importing ? (
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
              <p className="text-xs text-gray-400">Membaca file...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Upload className="w-5 h-5 text-gray-600 group-hover:text-emerald-400 transition-colors" />
              <p className="text-xs text-gray-500">Klik untuk upload .csv / .xlsx</p>
              <p className="text-xs text-gray-600">Format transaksi ZEUS atau harian</p>
            </div>
          )}
        </div>

        {result && (
          <div className={`rounded-lg p-3 text-xs ${result.success ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
            <div className="flex items-center gap-2 mb-1">
              {result.success ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
              <span className={result.success ? "text-emerald-400" : "text-red-400"}>
                {result.success ? `${result.rows} baris · ${SOURCE_LABEL[result.source] || result.source}` : "Import gagal"}
              </span>
              <button onClick={() => setResult(null)} className="ml-auto text-gray-500 hover:text-gray-300"><X className="w-3 h-3" /></button>
            </div>
            {result.errors.slice(0, 3).map((e, i) => <p key={i} className="text-red-400/70">{e}</p>)}
            {result.errors.length > 3 && <p className="text-gray-500">+{result.errors.length - 3} error</p>}
          </div>
        )}
      </div>

      {/* ── TEMPLATE ── */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium">Download Template</p>
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {(["transaction", "daily"] as const).map(t => (
            <button key={t} onClick={() => setTemplateType(t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${templateType === t ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {t === "transaction" ? "Transaksi" : "Harian"}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600">
          {templateType === "transaction"
            ? "Format: id, transaction_id, start_timestamp, energy_consumed_kwh, status, ..."
            : "Format: date, energy_consumed_kwh, total_sessions, ..."}
        </p>
        <div className="flex gap-2">
          <button onClick={() => handleTemplate("csv")}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs rounded-lg transition-colors">
            <FileText className="w-3 h-3" /> CSV
          </button>
          <button onClick={() => handleTemplate("xlsx")}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs rounded-lg transition-colors">
            <Table2 className="w-3 h-3" /> Excel
          </button>
        </div>
      </div>

      <div className="border-t border-gray-800" />

      {/* ── EXPORT ── */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium">Export Data</p>
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {(["transaction", "daily"] as const).map(t => (
            <button key={t} onClick={() => setExportType(t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${exportType === t ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>
              {t === "transaction" ? "Per Transaksi" : "Per Hari"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <div onClick={() => setIncForecast(!incForecast)}
            className={`w-8 h-4 rounded-full transition-colors relative ${incForecast ? "bg-emerald-500" : "bg-gray-700"}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${incForecast ? "translate-x-4" : "translate-x-0.5"}`} />
          </div>
          <span className="text-xs text-gray-400">Sertakan hasil forecast</span>
        </label>

        <div className="grid grid-cols-3 gap-1.5">
          {(["csv", "xlsx", "json"] as const).map(fmt => (
            <button key={fmt} onClick={() => handleExport(fmt)} disabled={!!exporting}
              className="flex items-center justify-center gap-1.5 px-2 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 text-xs rounded-lg transition-colors uppercase">
              {exporting === fmt ? <RefreshCw className="w-3 h-3 animate-spin" /> : fmt === "csv" ? <FileText className="w-3 h-3" /> : fmt === "xlsx" ? <Table2 className="w-3 h-3" /> : <FileJson className="w-3 h-3" />}
              {fmt}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-600">
          {exportType === "transaction" ? "Format transaksi" : "Format harian"} · {histDays} hari
          {incForecast ? ` + forecast ${forecastDays}h` : ""}
          {cpFilter ? ` · ${cpFilter}` : ""}
        </p>
      </div>
    </div>
  );
}
