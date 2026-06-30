"use client";

/**
 * HudStatRing
 * ─────────────────────────────────────────────────────────────
 * Angka besar bergaya "counter HUD" dengan ring progres di
 * sekelilingnya, dipakai di strip ringkasan atas halaman
 * Monitor (Total CP / Online / Charging). Ring menunjukkan
 * proporsi terhadap total (mis. online/total), dan nilainya
 * sendiri sedikit "tick" setiap kali berubah.
 */

interface HudStatRingProps {
  label: string;
  value: number;
  total?: number;
  color: string; // hex
  pulse?: boolean;
}

export default function HudStatRing({ label, value, total, color, pulse }: HudStatRingProps) {
  const pct = total && total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 100;
  const r = 38;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center justify-center gap-1 px-4 py-3">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 96 96" className="w-24 h-24 -rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="#1f2937" strokeWidth="6" />
          <circle
            cx="48" cy="48" r={r} fill="none"
            stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
            style={{ filter: pulse ? `drop-shadow(0 0 6px ${color})` : undefined }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            key={value}
            className="text-2xl font-bold tabular-nums animate-counter-tick"
            style={{ color }}
          >
            {value}
          </span>
          {pulse && (
            <span className="w-1.5 h-1.5 rounded-full mt-0.5 animate-blink-dot" style={{ background: color }} />
          )}
        </div>
      </div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
    </div>
  );
}
