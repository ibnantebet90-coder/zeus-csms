"use client";

/**
 * EvChargerIcon
 * ─────────────────────────────────────────────────────────────
 * Ikon SVG stasiun pengisian EV yang beranimasi sesuai status
 * OCPP (Available / Charging / Preparing / Faulted / Unavailable
 * / Unknown). Dipakai di Dashboard, Monitor, dan Charge Points
 * agar identitas visual EVCS konsisten di semua halaman.
 *
 * - Charging  : kabel "plug-in", aliran energi animasi, badan charger glow
 * - Preparing : kabel plug-in tanpa aliran energi (menunggu mulai)
 * - Available : indikator siap (titik hijau) berdenyut halus
 * - Faulted   : ikon spark merah berkedip di badan charger
 * - Unavailable/Unknown : statis, redup
 *
 * Semua animasi otomatis nonaktif jika prefers-reduced-motion
 * aktif (lihat globals.css).
 */

export type EvChargerStatus =
  | "Available"
  | "Charging"
  | "Preparing"
  | "Faulted"
  | "Unavailable"
  | "Finishing"
  | "Reserved"
  | "Unknown";

const STATUS_THEME: Record<
  EvChargerStatus,
  { stroke: string; glow: string; cable: string }
> = {
  Available: { stroke: "#34d399", glow: "#34d399", cable: "#374151" },
  Charging: { stroke: "#60a5fa", glow: "#60a5fa", cable: "#60a5fa" },
  Preparing: { stroke: "#fbbf24", glow: "#fbbf24", cable: "#fbbf24" },
  Finishing: { stroke: "#a78bfa", glow: "#a78bfa", cable: "#a78bfa" },
  Reserved: { stroke: "#22d3ee", glow: "#22d3ee", cable: "#22d3ee" },
  Faulted: { stroke: "#f87171", glow: "#f87171", cable: "#374151" },
  Unavailable: { stroke: "#6b7280", glow: "#6b7280", cable: "#374151" },
  Unknown: { stroke: "#6b7280", glow: "#6b7280", cable: "#374151" },
};

interface EvChargerIconProps {
  status?: EvChargerStatus | string;
  size?: number;
  className?: string;
}

export default function EvChargerIcon({
  status = "Unknown",
  size = 40,
  className = "",
}: EvChargerIconProps) {
  const theme = STATUS_THEME[(status as EvChargerStatus)] ?? STATUS_THEME.Unknown;
  const isCharging = status === "Charging";
  const isPreparing = status === "Preparing";
  const isFaulted = status === "Faulted";
  const isActive = isCharging || isPreparing;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label={`Status charger: ${status}`}
    >
      {/* Badan charger (pedestal) */}
      <rect
        x="6"
        y="8"
        width="20"
        height="32"
        rx="4"
        stroke={theme.stroke}
        strokeWidth="2"
        className={isCharging ? "animate-status-glow" : ""}
        style={{ color: theme.glow }}
      />
      {/* Layar / indikator status */}
      <rect x="10" y="13" width="12" height="7" rx="1.5" fill={theme.stroke} opacity={isActive ? 0.9 : 0.35} />
      {/* Titik status (Available = berdenyut hijau) */}
      <circle
        cx="16"
        cy="29"
        r="3"
        fill={theme.stroke}
        className={status === "Available" ? "animate-pulse" : ""}
      />

      {/* Kabel charging — melengkung dari badan ke kendaraan */}
      <path
        d="M26 26 C 32 26, 32 34, 38 34"
        stroke={theme.cable}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        className={isActive ? "animate-plug-in" : ""}
      />

      {/* Aliran energi di sepanjang kabel (hanya saat Charging) */}
      {isCharging && (
        <path
          d="M26 26 C 32 26, 32 34, 38 34"
          stroke="#bfdbfe"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          strokeDasharray="4 8"
          className="animate-energy-flow"
        />
      )}

      {/* Konektor plug di ujung kabel */}
      <rect
        x="37"
        y="31"
        width="6"
        height="6"
        rx="1.5"
        fill={theme.cable}
        className={isActive ? "animate-plug-in" : ""}
      />

      {/* Petir kecil di badan charger = sedang charging */}
      {isCharging && (
        <path
          d="M17.5 22 L14.5 27 L16.5 27 L15.5 31 L19 26 L17 26 Z"
          fill="#fde047"
          className="animate-spark-pop"
        />
      )}

      {/* Tanda spark merah untuk Faulted */}
      {isFaulted && (
        <path
          d="M17.5 22 L14.5 27 L16.5 27 L15.5 31 L19 26 L17 26 Z"
          fill="#f87171"
          className="animate-status-glow"
          style={{ color: "#f87171" }}
        />
      )}
    </svg>
  );
}
