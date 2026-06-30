"use client";

/**
 * EvChargerHud
 * ─────────────────────────────────────────────────────────────
 * Versi "hero" dari EvChargerIcon — dibuat besar dan jadi
 * elemen visual utama kartu HUD di halaman Monitor. Berbeda
 * dari EvChargerIcon (versi kecil untuk tabel/list), komponen
 * ini punya:
 *   - radial glow di belakang charger
 *   - ring rotasi di sekeliling ikon saat Charging
 *   - aliran energi yang lebih panjang & jelas dari charger ke
 *     "kendaraan" (kotak di sisi kanan)
 *   - efek spark/petir lebih besar
 *
 * Semua animasi tunduk pada prefers-reduced-motion (globals.css).
 */

export type HudStatus =
  | "Available"
  | "Charging"
  | "Preparing"
  | "Faulted"
  | "Unavailable"
  | "Finishing"
  | "Reserved"
  | "Unknown";

const THEME: Record<HudStatus, { neon: string; soft: string; ring: string }> = {
  Available: { neon: "#34d399", soft: "rgba(52,211,153,0.18)", ring: "#34d399" },
  Charging: { neon: "#22d3ee", soft: "rgba(34,211,238,0.22)", ring: "#60a5fa" },
  Preparing: { neon: "#fbbf24", soft: "rgba(251,191,36,0.18)", ring: "#fbbf24" },
  Finishing: { neon: "#a78bfa", soft: "rgba(167,139,250,0.18)", ring: "#a78bfa" },
  Reserved: { neon: "#22d3ee", soft: "rgba(34,211,238,0.18)", ring: "#22d3ee" },
  Faulted: { neon: "#f87171", soft: "rgba(248,113,113,0.22)", ring: "#f87171" },
  Unavailable: { neon: "#64748b", soft: "rgba(100,116,139,0.12)", ring: "#64748b" },
  Unknown: { neon: "#64748b", soft: "rgba(100,116,139,0.12)", ring: "#64748b" },
};

interface EvChargerHudProps {
  status?: HudStatus | string;
  size?: number;
  className?: string;
}

export default function EvChargerHud({ status = "Unknown", size = 120, className = "" }: EvChargerHudProps) {
  const theme = THEME[(status as HudStatus)] ?? THEME.Unknown;
  const isCharging = status === "Charging";
  const isPreparing = status === "Preparing";
  const isFaulted = status === "Faulted";
  const isActive = isCharging || isPreparing;

  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      {/* Radial glow belakang */}
      <div
        className="absolute inset-0 rounded-full blur-2xl"
        style={{ background: theme.soft }}
      />

      {/* Ring rotasi (hanya saat charging/preparing) */}
      {isActive && (
        <svg
          viewBox="0 0 120 120"
          className={`absolute inset-0 ${isCharging ? "animate-ring-spin-fast" : "animate-ring-spin"}`}
          style={{ width: size, height: size }}
        >
          <circle
            cx="60" cy="60" r="54"
            fill="none"
            stroke={theme.ring}
            strokeWidth="1.5"
            strokeDasharray="6 10"
            opacity="0.6"
          />
        </svg>
      )}

      <svg
        viewBox="0 0 120 120"
        style={{ width: size * 0.78, height: size * 0.78, color: theme.neon }}
        className="relative z-10"
        role="img"
        aria-label={`Status charger: ${status}`}
      >
        {/* Badan charger */}
        <rect
          x="18" y="22" width="46" height="76" rx="8"
          fill="rgba(15,23,42,0.7)"
          stroke="currentColor"
          strokeWidth="2"
          className={isCharging ? "animate-status-glow" : ""}
        />

        {/* Layar status */}
        <rect x="26" y="32" width="30" height="18" rx="3" fill="currentColor" opacity={isActive ? 0.9 : 0.3} />
        <text x="41" y="45" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#0f172a" opacity={isActive ? 1 : 0}>
          {isCharging ? "ON" : isPreparing ? "RDY" : ""}
        </text>

        {/* Indikator titik */}
        <circle cx="41" cy="62" r="5" fill="currentColor" className={status === "Available" ? "animate-blink-dot" : ""} />
        <rect x="26" y="72" width="30" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
        <rect x="26" y="79" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.25" />

        {/* Kabel dari charger ke "kendaraan" */}
        <path
          d="M64 70 C 80 70, 80 95, 100 95"
          stroke="#475569"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          className={isActive ? "animate-plug-in" : ""}
        />
        {isCharging && (
          <path
            d="M64 70 C 80 70, 80 95, 100 95"
            stroke={theme.neon}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            strokeDasharray="5 9"
            className="animate-energy-flow-fast"
          />
        )}

        {/* Ikon "kendaraan" sederhana (siluet kotak + roda) */}
        <rect x="96" y="86" width="20" height="10" rx="2" fill="rgba(71,85,105,0.5)" stroke="#475569" strokeWidth="1.5" />
        <circle cx="100" cy="97" r="2.5" fill="#1e293b" stroke="#475569" />
        <circle cx="112" cy="97" r="2.5" fill="#1e293b" stroke="#475569" />

        {/* Konektor plug */}
        <rect x="97" y="91" width="6" height="6" rx="1.5" fill={isActive ? theme.neon : "#475569"} className={isActive ? "animate-plug-in" : ""} />

        {/* Petir besar saat charging */}
        {isCharging && (
          <path
            d="M44 50 L36 64 L40 64 L37 76 L52 58 L46 58 Z"
            fill="#fde047"
            className="animate-spark-pop"
          />
        )}

        {/* Tanda fault */}
        {isFaulted && (
          <g className="animate-status-glow" style={{ color: "#f87171" }}>
            <line x1="30" y1="32" x2="52" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <line x1="52" y1="32" x2="30" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </g>
        )}
      </svg>
    </div>
  );
}
