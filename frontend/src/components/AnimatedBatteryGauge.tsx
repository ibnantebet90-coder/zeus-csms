"use client";

/**
 * AnimatedBatteryGauge
 * ─────────────────────────────────────────────────────────────
 * Indikator baterai vertikal kecil dengan animasi "mengisi"
 * untuk dipasang di samping kartu transaksi aktif / connector
 * yang sedang Charging. Murni dekoratif-fungsional: progres
 * sebenarnya tetap ditampilkan sebagai teks (lihat valueLabel),
 * animasi hanya memperkuat persepsi "sedang berjalan".
 *
 * Saat status bukan "Charging", baterai ditampilkan statis
 * (tanpa animasi) sesuai level yang diberikan.
 */

interface AnimatedBatteryGaugeProps {
  isCharging: boolean;
  /** Level statis 0-100 saat tidak charging (opsional) */
  levelPercent?: number;
  valueLabel?: string;
  size?: "sm" | "md";
}

export default function AnimatedBatteryGauge({
  isCharging,
  levelPercent = 60,
  valueLabel,
  size = "sm",
}: AnimatedBatteryGaugeProps) {
  const dims = size === "sm" ? { w: "w-5", h: "h-8" } : { w: "w-6", h: "h-10" };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative ${dims.w} ${dims.h} rounded-[3px] border-2 border-gray-600 bg-gray-800/60 overflow-hidden`}
        role="img"
        aria-label={isCharging ? "Baterai sedang mengisi" : `Level baterai ${levelPercent}%`}
      >
        {/* "Kutub" baterai di atas */}
        <span className="absolute -top-[5px] left-1/2 -translate-x-1/2 w-2 h-[3px] bg-gray-600 rounded-t-sm" />

        {isCharging ? (
          <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-500 to-emerald-400 animate-battery-fill" />
        ) : (
          <span
            className="absolute bottom-0 left-0 right-0 bg-emerald-500/70 transition-[height] duration-500"
            style={{ height: `${Math.max(4, Math.min(100, levelPercent))}%` }}
          />
        )}
      </div>
      {valueLabel && (
        <span className="text-xs font-medium text-gray-300">{valueLabel}</span>
      )}
    </div>
  );
}
