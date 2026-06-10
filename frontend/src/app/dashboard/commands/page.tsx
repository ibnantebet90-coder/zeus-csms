"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Terminal, Send, RefreshCw, CheckCircle,
  XCircle, Clock, ChevronDown, Zap, RotateCcw,
  PowerOff, Unlock, Settings, Radio, Trash2, AlertCircle,
} from "lucide-react";
import api from "@/lib/axios";
import { payloadSearcher } from "recharts/types/chart/SunburstChart";

// ── Types ─────────────────────────────────────────────────
interface CP {
  charge_point_id: string;
  name: string;
  is_online: boolean;
  connectors: any[];
}

interface CommandLog {
  id: number;
  charge_point_id: string;
  command: string;
  payload: any;
  response: any;
  status: string;
  sent_at: string;
}

interface CommandResult {
  success: boolean;
  command: string;
  charge_point_id: string;
  result?: any;
  error?: string;
  log_id?: number;
}

// [BARU] Tipe untuk transaksi aktif dari endpoint /active-transactions
interface ActiveTransaction {
  transaction_id: number;
  connector_id: number;
  id_tag: string | null;
  customer_name: string | null;
  start_timestamp: string | null;
  meter_start: number | null;
}

// ── Command Definitions ───────────────────────────────────
const COMMANDS = [
  {
    group: "Kontrol Dasar",
    items: [
      { id: "Reset", label: "Reset", icon: RotateCcw, desc: "Restart charge point (Soft/Hard)", color: "text-amber-400" },
      { id: "ClearCache", label: "Clear Cache", icon: Trash2, desc: "Hapus cache authorization di CP", color: "text-red-400" },
      { id: "ChangeAvailability", label: "Change Availability", icon: PowerOff, desc: "Ubah status konektor (Operative/Inoperative)", color: "text-orange-400" },
      { id: "UnlockConnector", label: "Unlock Connector", icon: Unlock, desc: "Buka kunci konektor secara remote", color: "text-blue-400" },
    ]
  },
  {
    group: "Transaksi",
    items: [
      { id: "RemoteStartTransaction", label: "Remote Start", icon: Zap, desc: "Mulai pengisian dari dashboard", color: "text-emerald-400" },
      { id: "RemoteStopTransaction", label: "Remote Stop", icon: PowerOff, desc: "Hentikan pengisian yang sedang berjalan", color: "text-red-400" },
    ]
  },
  {
    group: "Konfigurasi",
    items: [
      { id: "GetConfiguration", label: "Get Configuration", icon: Settings, desc: "Baca konfigurasi CP", color: "text-purple-400" },
      { id: "ChangeConfiguration", label: "Change Configuration", icon: Settings, desc: "Ubah nilai konfigurasi CP", color: "text-purple-400" },
      { id: "TriggerMessage", label: "Trigger Message", icon: Radio, desc: "Paksa CP kirim message tertentu", color: "text-cyan-400" },
    ]
  },
];

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" });

// [BARU] Format timestamp transaksi untuk tampilan di dropdown
const fmtTxTime = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
};

// ── Status Badge ──────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    Accepted: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    Rejected: "text-red-400 bg-red-500/10 border-red-500/20",
    Failed: "text-red-400 bg-red-500/10 border-red-500/20",
    Pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    Sent: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${cfg[status] ?? cfg.Pending}`}>
      {status}
    </span>
  );
}

// ── Command Form ──────────────────────────────────────────
function CommandForm({ command, cp, onSubmit, loading }: {
  command: string;
  cp: CP | null;
  onSubmit: (payload: any) => void;
  loading: boolean;
}) {
  const [resetType, setResetType] = useState("Soft");
  const [availability, setAvailability] = useState("Operative");
  const [connectorId, setConnectorId] = useState("1");
  const [idTag, setIdTag] = useState("");
  const [configKey, setConfigKey] = useState("");
  const [configValue, setConfigValue] = useState("");
  const [triggerMsg, setTriggerMsg] = useState("Heartbeat");

  // [BARU] State untuk transaksi yang dipilih (RemoteStopTransaction)
  const [selectedTxId, setSelectedTxId] = useState<string>("");

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors";

  // [BARU] Fetch transaksi aktif — hanya aktif saat command RemoteStop dan CP sudah dipilih
  const {
    data: activeTransactions = [],
    isLoading: txLoading,
    isError: txError,
  } = useQuery<ActiveTransaction[]>({
    queryKey: ["active-transactions", cp?.charge_point_id],
    queryFn: () =>
      api
        .get(`/api/commands/active-transactions?charge_point_id=${cp!.charge_point_id}`)
        .then((r) => r.data),
    enabled: command === "RemoteStopTransaction" && !!cp?.charge_point_id,
    // Refresh setiap 15 detik agar daftar selalu terkini
    refetchInterval: 15000,
  });

  const handleSend = () => {
    const base = { command, charge_point_id: cp?.charge_point_id };
    let extra = {};

    if (command === "Reset") extra = { reset_type: resetType };
    if (command === "ChangeAvailability") extra = { connector_id: parseInt(connectorId), availability };
    if (command === "UnlockConnector") extra = { connector_id: parseInt(connectorId) };
    if (command === "RemoteStartTransaction") extra = { id_tag: idTag, connector_id: parseInt(connectorId) };

    // [FIX] Kirim transaction_id (bukan connector_id) sesuai yang dipilih dari dropdown
    if (command === "RemoteStopTransaction") extra = { transaction_id: parseInt(selectedTxId) };

    if (command === "GetConfiguration") extra = { key: configKey || null };
    if (command === "ChangeConfiguration") extra = { key: configKey, value: configValue };
    if (command === "TriggerMessage") extra = { requested_message: triggerMsg, connector_id: parseInt(connectorId) };

    onSubmit({ ...base, ...extra });
  };

  // Disable tombol kirim jika transaksi belum dipilih
  const isRemoteStopReady = command !== "RemoteStopTransaction" || !!selectedTxId;
  const isDisabled = loading || (command === "RemoteStartTransaction" && !idTag) || !isRemoteStopReady;

  return (
    <div className="space-y-3">

      {/* Connector ID (untuk sebagian besar command kecuali RemoteStop) */}
      {["ChangeAvailability", "UnlockConnector", "RemoteStartTransaction", "TriggerMessage"].includes(command) && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Konektor ID</label>
          <select value={connectorId} onChange={e => setConnectorId(e.target.value)} className={inputCls}>
            {command !== "RemoteStartTransaction" && (
              <option value="0">0 (Semua)</option>
            )}
            {cp?.connectors?.filter(c => c.connector_id !== 0).map(c => (
              <option key={c.connector_id} value={c.connector_id}>
                Konektor {c.connector_id} — {c.status}
              </option>
            ))}
            {(!cp?.connectors?.length) && <option value="1">Konektor 1</option>}
          </select>
        </div>
      )}

      {/* Reset type */}
      {command === "Reset" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Tipe Reset</label>
          <div className="flex gap-2">
            {["Soft", "Hard"].map(t => (
              <button key={t} onClick={() => setResetType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${resetType === t
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  : "bg-gray-800 text-gray-400 hover:text-white border border-transparent"
                  }`}>
                {t}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {resetType === "Soft" ? "Soft: tunggu transaksi selesai dulu" : "Hard: langsung restart sekarang"}
          </p>
        </div>
      )}

      {/* Availability */}
      {command === "ChangeAvailability" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Status</label>
          <div className="flex gap-2">
            {["Operative", "Inoperative"].map(t => (
              <button key={t} onClick={() => setAvailability(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${availability === t
                  ? t === "Operative"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-red-500/10 text-red-400 border border-red-500/30"
                  : "bg-gray-800 text-gray-400 hover:text-white border border-transparent"
                  }`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ID Tag untuk remote start */}
      {command === "RemoteStartTransaction" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            ID Tag <span className="text-red-400">*</span>
          </label>
          <input value={idTag} onChange={e => setIdTag(e.target.value)}
            placeholder="Masukkan id_tag customer" className={inputCls} />
          <p className="text-xs text-gray-600 mt-1">ID Tag harus terdaftar di tabel Customers</p>
        </div>
      )}

      {/* [BARU] Dropdown transaksi aktif untuk RemoteStopTransaction */}
      {command === "RemoteStopTransaction" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            Transaksi Aktif <span className="text-red-400">*</span>
          </label>

          {/* Loading state */}
          {txLoading && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg">
              <RefreshCw className="w-3.5 h-3.5 text-gray-500 animate-spin" />
              <span className="text-xs text-gray-500">Memuat transaksi aktif...</span>
            </div>
          )}

          {/* Error state */}
          {txError && !txLoading && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-red-400">Gagal memuat transaksi. Coba refresh.</span>
            </div>
          )}

          {/* Tidak ada transaksi aktif */}
          {!txLoading && !txError && activeTransactions.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-800/50 border border-dashed border-gray-700 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-xs text-gray-500">
                Tidak ada transaksi aktif di charge point ini
              </span>
            </div>
          )}

          {/* Dropdown transaksi */}
          {!txLoading && !txError && activeTransactions.length > 0 && (
            <>
              <select
                value={selectedTxId}
                onChange={e => setSelectedTxId(e.target.value)}
                className={inputCls}
              >
                <option value="">— Pilih transaksi —</option>
                {activeTransactions.map(tx => (
                  <option key={tx.transaction_id} value={tx.transaction_id}>
                    #{tx.transaction_id} · Konektor {tx.connector_id}
                    {tx.customer_name ? ` · ${tx.customer_name}` : tx.id_tag ? ` · ${tx.id_tag}` : ""}
                    {tx.start_timestamp ? ` · Mulai ${fmtTxTime(tx.start_timestamp)}` : ""}
                  </option>
                ))}
              </select>

              {/* Detail transaksi yang dipilih */}
              {selectedTxId && (() => {
                const tx = activeTransactions.find(t => t.transaction_id === parseInt(selectedTxId));
                if (!tx) return null;
                return (
                  <div className="mt-2 p-3 bg-gray-800/60 border border-gray-700 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Transaction ID</span>
                      <span className="text-xs font-mono text-white font-semibold">#{tx.transaction_id}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Konektor</span>
                      <span className="text-xs text-gray-300">{tx.connector_id}</span>
                    </div>
                    {tx.customer_name && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Pelanggan</span>
                        <span className="text-xs text-gray-300">{tx.customer_name}</span>
                      </div>
                    )}
                    {tx.id_tag && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">ID Tag</span>
                        <span className="text-xs font-mono text-gray-300">{tx.id_tag}</span>
                      </div>
                    )}
                    {tx.start_timestamp && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Mulai</span>
                        <span className="text-xs text-gray-300">{fmtTxTime(tx.start_timestamp)}</span>
                      </div>
                    )}
                    {tx.meter_start != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Meter Start</span>
                        <span className="text-xs text-gray-300">{tx.meter_start} Wh</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Config key/value */}
      {["GetConfiguration", "ChangeConfiguration"].includes(command) && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            Key {command === "GetConfiguration" ? "(kosong = semua)" : <span className="text-red-400">*</span>}
          </label>
          <input value={configKey} onChange={e => setConfigKey(e.target.value)}
            placeholder="Contoh: HeartbeatInterval" className={inputCls} />
        </div>
      )}
      {command === "ChangeConfiguration" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            Value <span className="text-red-400">*</span>
          </label>
          <input value={configValue} onChange={e => setConfigValue(e.target.value)}
            placeholder="Contoh: 60" className={inputCls} />
        </div>
      )}

      {/* Trigger message */}
      {command === "TriggerMessage" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Message</label>
          <select value={triggerMsg} onChange={e => setTriggerMsg(e.target.value)} className={inputCls}>
            {["BootNotification", "Heartbeat", "MeterValues", "StatusNotification"].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={isDisabled}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-950 font-semibold text-sm rounded-lg transition-colors"
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {loading ? "Mengirim..." : "Kirim Perintah"}
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────
export default function RemoteCommandPage() {
  const [selectedCp, setSelectedCp] = useState("");
  const [selectedCmd, setSelectedCmd] = useState("Reset");
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);

  const { data: chargePoints = [] } = useQuery<CP[]>({
    queryKey: ["charge-points"],
    queryFn: () => api.get("/api/charge-points").then(r => r.data),
    refetchInterval: 15000,
  });

  const { data: logs = [], refetch: refetchLogs } = useQuery<CommandLog[]>({
    queryKey: ["command-logs", selectedCp],
    queryFn: () =>
      api
        .get(`/api/commands/logs${selectedCp ? `?charge_point_id=${selectedCp}` : ""}`)
        .then(r => r.data),
    refetchInterval: 10000,
  });

  const sendMut = useMutation({
    mutationFn: (payload: any) =>
      api.post("/api/commands/send", payload).then(r => r.data),
    onSuccess: (data) => {
      setLastResult(data);
      refetchLogs();
    },
    onError: (err: any) => {
      setLastResult({
        success: false,
        command: selectedCmd,
        charge_point_id: selectedCp,
        error: err.response?.data?.detail ?? "Error",
      });
    },
  });

  const selectedCpData = chargePoints.find(cp => cp.charge_point_id === selectedCp) ?? null;
  const selectedCmdDef = COMMANDS.flatMap(g => g.items).find(c => c.id === selectedCmd);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Remote Command</h1>
        <p className="text-sm text-gray-500 mt-0.5">Kirim perintah OCPP ke charge point dari dashboard</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* ── Sidebar kiri: pilih CP + command ── */}
        <div className="space-y-4">
          {/* Pilih CP */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Charge Point</p>
            <div className="space-y-1.5">
              {chargePoints.length === 0 ? (
                <p className="text-xs text-gray-600 py-2">Belum ada charge point</p>
              ) : (
                chargePoints.map(cp => (
                  <button
                    key={cp.charge_point_id}
                    onClick={() => setSelectedCp(cp.charge_point_id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors border ${selectedCp === cp.charge_point_id
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "border-transparent hover:bg-gray-800 text-gray-400 hover:text-white"
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cp.is_online ? "bg-emerald-400" : "bg-gray-600"}`} />
                      <div>
                        <p className="text-sm font-medium">{cp.name}</p>
                        <p className="text-xs font-mono opacity-60">{cp.charge_point_id}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Pilih command */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Perintah</p>
            {COMMANDS.map(group => (
              <div key={group.group}>
                <p className="text-xs text-gray-600 mb-1.5 font-medium">{group.group}</p>
                <div className="space-y-1">
                  {group.items.map(cmd => (
                    <button
                      key={cmd.id}
                      onClick={() => setSelectedCmd(cmd.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors border flex items-center gap-2 ${selectedCmd === cmd.id
                        ? "bg-gray-800 border-gray-700 text-white"
                        : "border-transparent hover:bg-gray-800/50 text-gray-400 hover:text-white"
                        }`}
                    >
                      <cmd.icon className={`w-3.5 h-3.5 flex-shrink-0 ${selectedCmd === cmd.id ? cmd.color : ""}`} />
                      <span className="text-xs font-medium">{cmd.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Panel tengah: form + hasil ── */}
        <div className="space-y-4">
          {/* Command panel */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            {selectedCmdDef && (
              <div className="flex items-start gap-3 mb-4 pb-4 border-b border-gray-800">
                <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                  <selectedCmdDef.icon className={`w-4 h-4 ${selectedCmdDef.color}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{selectedCmdDef.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{selectedCmdDef.desc}</p>
                </div>
              </div>
            )}

            {!selectedCp ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Terminal className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-sm text-gray-500">Pilih charge point dulu</p>
              </div>
            ) : (
              <>
                {/* CP status */}
                <div className="flex items-center gap-2 mb-4 p-3 bg-gray-800 rounded-lg">
                  <div className={`w-2 h-2 rounded-full ${selectedCpData?.is_online ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
                  <span className="text-xs text-gray-300 font-medium">{selectedCpData?.name}</span>
                  <span className="text-xs font-mono text-gray-500">{selectedCp}</span>
                  {!selectedCpData?.is_online && (
                    <span className="ml-auto text-xs text-amber-400">⚠ Offline</span>
                  )}
                </div>

                <CommandForm
                  command={selectedCmd}
                  cp={selectedCpData}
                  onSubmit={(payload: any) => sendMut.mutate(payload as any)}
                  loading={sendMut.isPending}
                />
              </>
            )}
          </div>

          {/* Hasil command */}
          {lastResult && (
            <div className={`rounded-xl p-4 border ${lastResult.success
              ? "bg-emerald-500/10 border-emerald-500/20"
              : "bg-red-500/10 border-red-500/20"
              }`}>
              <div className="flex items-center gap-2 mb-2">
                {lastResult.success
                  ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />}
                <span className={`text-sm font-semibold ${lastResult.success ? "text-emerald-400" : "text-red-400"}`}>
                  {lastResult.success ? "Berhasil" : "Gagal"}
                </span>
                <span className="text-xs text-gray-500 ml-auto">{lastResult.command}</span>
              </div>
              {lastResult.result && (
                <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 overflow-x-auto mt-2">
                  {JSON.stringify(lastResult.result, null, 2)}
                </pre>
              )}
              {lastResult.error && (
                <p className="text-xs text-red-400 mt-1">{lastResult.error}</p>
              )}
            </div>
          )}
        </div>

        {/* ── Log history ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Riwayat Command</h2>
            <span className="text-xs text-gray-500">{logs.length} log</span>
          </div>
          <div className="overflow-y-auto max-h-[600px]">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-600">Belum ada riwayat</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {logs.map(log => (
                  <div key={log.id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-white">{log.command}</span>
                      <StatusBadge status={log.status} />
                    </div>
                    <p className="text-xs font-mono text-gray-500">{log.charge_point_id}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{fmtTime(log.sent_at)}</p>
                    {log.response && Object.keys(log.response).length > 0 && (
                      <pre className="text-xs text-gray-500 bg-gray-900 rounded p-2 mt-1.5 overflow-x-auto">
                        {JSON.stringify(log.response, null, 1)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
