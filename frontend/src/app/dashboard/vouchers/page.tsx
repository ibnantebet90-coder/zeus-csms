"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Ticket, Plus, RefreshCw, Trash2, X, Percent, Tag,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────
interface Voucher {
    id: number;
    code: string;
    description: string | null;
    discount_type: "percent" | "fixed";
    discount_value: number;
    applies_to: string;
    valid_from: string | null;
    valid_until: string | null;
    max_usage: number | null;
    used_count: number;
    is_active: boolean;
    created_at: string;
}

interface VoucherForm {
    code: string;
    description: string;
    discount_type: "percent" | "fixed";
    discount_value: string;
    valid_from: string;
    valid_until: string;
    max_usage: string;
}

const emptyForm: VoucherForm = {
    code: "",
    description: "",
    discount_type: "percent",
    discount_value: "",
    valid_from: "",
    valid_until: "",
    max_usage: "",
};

// ── Helpers ───────────────────────────────────────────────────
const formatIDR = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "-";

const formatDiscount = (v: Voucher) =>
    v.discount_type === "percent" ? `${v.discount_value}%` : formatIDR(v.discount_value);

const isExpired = (v: Voucher) => v.valid_until && new Date(v.valid_until) < new Date();
const isMaxedOut = (v: Voucher) => v.max_usage != null && v.used_count >= v.max_usage;

const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
                {label} {required && <span className="text-red-400">*</span>}
            </label>
            {children}
        </div>
    );
}

// ── Add Modal ─────────────────────────────────────────────────
function AddModal({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const [form, setForm] = useState<VoucherForm>(emptyForm);
    const [error, setError] = useState("");

    const createMut = useMutation({
        mutationFn: (data: VoucherForm) =>
            api.post("/api/vouchers", {
                code: data.code.toUpperCase().trim(),
                description: data.description || null,
                discount_type: data.discount_type,
                discount_value: parseFloat(data.discount_value),
                applies_to: "subtotal",
                valid_from: data.valid_from ? new Date(data.valid_from).toISOString() : null,
                valid_until: data.valid_until ? new Date(data.valid_until).toISOString() : null,
                max_usage: data.max_usage ? parseInt(data.max_usage) : null,
                is_active: true,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["vouchers"] });
            onClose();
        },
        onError: (err: any) => setError(err.response?.data?.detail ?? "Gagal membuat voucher"),
    });

    const valid = form.code.trim().length > 0 && form.discount_value !== "" && !isNaN(parseFloat(form.discount_value));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
                    <h2 className="text-sm font-semibold text-white">Buat Voucher Baru</h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                            <p className="text-xs text-red-400">{error}</p>
                        </div>
                    )}

                    <Field label="Kode Voucher" required>
                        <input className={`${inputCls} font-mono uppercase`} placeholder="LEBARAN2026" value={form.code}
                            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
                    </Field>

                    <Field label="Deskripsi">
                        <input className={inputCls} placeholder="Diskon Lebaran 2026" value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })} />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Tipe Diskon" required>
                            <select className={inputCls} value={form.discount_type}
                                onChange={(e) => setForm({ ...form, discount_type: e.target.value as "percent" | "fixed" })}>
                                <option value="percent">Persen (%)</option>
                                <option value="fixed">Nominal (Rp)</option>
                            </select>
                        </Field>
                        <Field label={form.discount_type === "percent" ? "Nilai (%)" : "Nilai (Rp)"} required>
                            <input type="number" className={inputCls}
                                placeholder={form.discount_type === "percent" ? "10" : "5000"}
                                value={form.discount_value}
                                onChange={(e) => setForm({ ...form, discount_value: e.target.value })} />
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Berlaku Dari">
                            <input type="date" className={inputCls} value={form.valid_from}
                                onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
                        </Field>
                        <Field label="Berlaku Sampai">
                            <input type="date" className={inputCls} value={form.valid_until}
                                onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
                        </Field>
                    </div>

                    <Field label="Batas Pemakaian">
                        <input type="number" className={inputCls} placeholder="Kosongkan jika tanpa batas" value={form.max_usage}
                            onChange={(e) => setForm({ ...form, max_usage: e.target.value })} />
                    </Field>

                    <div className="flex gap-2 pt-2">
                        <button onClick={onClose}
                            className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg hover:bg-gray-700 transition-colors">
                            Batal
                        </button>
                        <button onClick={() => createMut.mutate(form)} disabled={createMut.isPending || !valid}
                            className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
                            {createMut.isPending ? "Menyimpan..." : "Buat Voucher"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────
export default function VouchersPage() {
    const qc = useQueryClient();
    const [showAdd, setShowAdd] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<Voucher | null>(null);

    const { data: vouchers = [], isLoading, refetch } = useQuery<Voucher[]>({
        queryKey: ["vouchers"],
        queryFn: () => api.get("/api/vouchers").then((r) => r.data),
        refetchInterval: 30000,
    });

    const deleteMut = useMutation({
        mutationFn: (code: string) => api.delete(`/api/vouchers/${code}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["vouchers"] });
            setConfirmDelete(null);
        },
    });

    const activeCount = vouchers.filter((v) => v.is_active && !isExpired(v) && !isMaxedOut(v)).length;
    const totalUsage = vouchers.reduce((s, v) => s + v.used_count, 0);

    return (
        <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl font-bold text-white">Voucher</h1>
                    <p className="text-sm text-gray-500 mt-0.5">{vouchers.length} voucher dibuat</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => refetch()}
                        className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button onClick={() => setShowAdd(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
                        <Plus className="w-4 h-4" /> Buat Voucher
                    </button>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                {[
                    { label: "Total Voucher", value: vouchers.length, color: "text-white" },
                    { label: "Aktif & Berlaku", value: activeCount, color: "text-emerald-400" },
                    { label: "Total Dipakai", value: `${totalUsage}x`, color: "text-purple-400" },
                ].map((s) => (
                    <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                    </div>
                ))}
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="flex items-center justify-center h-40">
                    <RefreshCw className="w-5 h-5 animate-spin text-gray-500" />
                </div>
            ) : vouchers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 bg-gray-900 border border-gray-800 rounded-xl">
                    <Ticket className="w-10 h-10 text-gray-700 mb-3" />
                    <p className="text-sm text-gray-500">Belum ada voucher</p>
                    <p className="text-xs text-gray-600 mt-1">Buat voucher pertama untuk memberi diskon ke transaksi customer</p>
                </div>
            ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-800">
                                    <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Kode</th>
                                    <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Deskripsi</th>
                                    <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Diskon</th>
                                    <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Berlaku</th>
                                    <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium">Pemakaian</th>
                                    <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">Status</th>
                                    <th className="w-12" />
                                </tr>
                            </thead>
                            <tbody>
                                {vouchers.map((v) => {
                                    const expired = isExpired(v);
                                    const maxedOut = isMaxedOut(v);
                                    const effectiveActive = v.is_active && !expired && !maxedOut;

                                    let statusLabel = "Aktif";
                                    let statusStyle = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                                    if (!v.is_active) {
                                        statusLabel = "Nonaktif";
                                        statusStyle = "text-gray-400 bg-gray-700/50 border-gray-600/20";
                                    } else if (expired) {
                                        statusLabel = "Kadaluarsa";
                                        statusStyle = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                                    } else if (maxedOut) {
                                        statusLabel = "Limit Tercapai";
                                        statusStyle = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                                    }

                                    return (
                                        <tr key={v.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-400">
                                                    <Tag className="w-3 h-3" /> {v.code}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-gray-300">{v.description ?? "-"}</td>
                                            <td className="px-4 py-3 text-xs text-right text-white font-medium">
                                                <span className="inline-flex items-center gap-1">
                                                    {v.discount_type === "percent" && <Percent className="w-3 h-3 text-gray-500" />}
                                                    {formatDiscount(v)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-gray-400">
                                                {v.valid_from || v.valid_until
                                                    ? `${formatDate(v.valid_from)} – ${formatDate(v.valid_until)}`
                                                    : "Tanpa batas waktu"}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-right text-gray-300">
                                                {v.used_count}{v.max_usage != null ? ` / ${v.max_usage}` : ""}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle}`}>
                                                    {statusLabel}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {v.is_active && (
                                                    <button onClick={() => setConfirmDelete(v)}
                                                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Add modal */}
            {showAdd && <AddModal onClose={() => setShowAdd(false)} />}

            {/* Confirm delete */}
            {confirmDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-5">
                        <h3 className="text-sm font-semibold text-white mb-2">Nonaktifkan Voucher?</h3>
                        <p className="text-xs text-gray-400 mb-4">
                            Voucher <span className="font-mono text-emerald-400">{confirmDelete.code}</span> tidak akan bisa dipakai lagi setelah dinonaktifkan.
                        </p>
                        <div className="flex gap-2">
                            <button onClick={() => setConfirmDelete(null)}
                                className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg hover:bg-gray-700 transition-colors">
                                Batal
                            </button>
                            <button onClick={() => deleteMut.mutate(confirmDelete.code)} disabled={deleteMut.isPending}
                                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-gray-950 font-semibold text-sm rounded-lg transition-colors">
                                {deleteMut.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}