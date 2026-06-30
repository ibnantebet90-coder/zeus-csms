"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";

interface DownloadMenuProps {
  onDownloadCsv: () => void;
  onDownloadExcel: () => void;
  disabled?: boolean;
}

export default function DownloadMenu({ onDownloadCsv, onDownloadExcel, disabled }: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-cyan-600 hover:text-cyan-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Download className="w-3.5 h-3.5" />
        Unduh
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
          <button
            type="button"
            onClick={() => { onDownloadCsv(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" /> CSV (.csv)
          </button>
          <button
            type="button"
            onClick={() => { onDownloadExcel(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors border-t border-gray-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" /> Excel (.xlsx)
          </button>
        </div>
      )}
    </div>
  );
}
