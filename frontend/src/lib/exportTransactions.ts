/**
 * exportTransactionData
 * ─────────────────────────────────────────────────────────────
 * Util untuk export data satu transaksi (id transaksi + seluruh
 * titik meter value) ke file CSV atau Excel (.xlsx), dijalankan
 * sepenuhnya di browser (client-side), tidak perlu endpoint
 * backend tambahan.
 *
 * Format file: 1 baris header + N baris data, setiap baris
 * berisi id transaksi (diulang per baris agar file tetap valid
 * dibuka di Excel/Sheets tanpa perlu sheet kedua), measurand,
 * value, unit, dan timestamp.
 */

import * as XLSX from "xlsx";

export interface MeterPointExport {
  timestamp: string;
  measurand: string;
  value: number;
  unit: string | null;
}

export interface TransactionExportMeta {
  id: number;
  ocpp_transaction_id: number;
  charge_point_id: string;
  connector_id: number;
}

function buildRows(tx: TransactionExportMeta, points: MeterPointExport[]) {
  return points.map((p) => ({
    transaction_id: tx.id,
    ocpp_transaction_id: tx.ocpp_transaction_id,
    charge_point_id: tx.charge_point_id,
    connector_id: tx.connector_id,
    timestamp: p.timestamp,
    measurand: p.measurand,
    value: p.value,
    unit: p.unit ?? "",
  }));
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportTransactionToCsv(tx: TransactionExportMeta, points: MeterPointExport[]) {
  const rows = buildRows(tx, points);
  const headers = Object.keys(rows[0] ?? {
    transaction_id: "", ocpp_transaction_id: "", charge_point_id: "",
    connector_id: "", timestamp: "", measurand: "", value: "", unit: "",
  });
  const csvLines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => {
      const val = (r as Record<string, unknown>)[h];
      const str = String(val ?? "");
      // escape koma/quote sederhana
      return str.includes(",") || str.includes('"')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")),
  ];
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `transaksi-${tx.id}-meter-values.csv`);
}

export function exportTransactionToExcel(tx: TransactionExportMeta, points: MeterPointExport[]) {
  const rows = buildRows(tx, points);
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 12 },
    { wch: 22 }, { wch: 28 }, { wch: 12 }, { wch: 8 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Meter Values");
  XLSX.writeFile(wb, `transaksi-${tx.id}-meter-values.xlsx`);
}
