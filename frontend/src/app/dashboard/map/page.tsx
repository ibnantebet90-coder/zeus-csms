"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin, Zap, Wifi, WifiOff, RefreshCw,
  BatteryCharging, X, Navigation,
} from "lucide-react";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────
interface ChargePoint {
  id: number;
  charge_point_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  number_of_connectors: number;
  tariff_per_kwh: number;
  cp_status: string;
  is_online: boolean;
  last_heartbeat: string | null;
  vendor_name: string | null;
  model: string | null;
  connectors: { connector_id: number; status: string }[];
}

// ── Helpers ───────────────────────────────────────────────────
const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(n);

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";

const statusColor: Record<string, string> = {
  Available: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Charging: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Faulted: "text-red-400 bg-red-500/10 border-red-500/20",
  Unavailable: "text-gray-400 bg-gray-700/50 border-gray-600",
  Preparing: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Unknown: "text-gray-500 bg-gray-800 border-gray-700",
};

// Warna marker berdasarkan status
const markerColor = (cp: ChargePoint) => {
  if (!cp.is_online) return "#6b7280";
  if (cp.cp_status === "Available") return "#10b981";
  if (cp.cp_status === "Charging") return "#3b82f6";
  if (cp.cp_status === "Faulted") return "#ef4444";
  if (cp.cp_status === "Unavailable") return "#9ca3af";
  return "#f59e0b";
};

// SVG marker icon
const createMarkerSVG = (color: string, online: boolean) => `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
  <filter id="shadow">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.4)"/>
  </filter>
  <path d="M18 2C10.268 2 4 8.268 4 16c0 10 14 26 14 26s14-16 14-26C32 8.268 25.732 2 18 2z"
    fill="${color}" filter="url(#shadow)" opacity="${online ? 1 : 0.5}"/>
  <circle cx="18" cy="16" r="7" fill="white" opacity="0.9"/>
  <path d="M20 10l-4 7h3l-1 7 4-7h-3l1-7z" fill="${color}"/>
</svg>`;

// ── Info Card (popup di peta) ─────────────────────────────────
function InfoCard({ cp, onClose, onFocus }: {
  cp: ChargePoint;
  onClose: () => void;
  onFocus: () => void;
}) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] w-80">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cp.is_online ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-gray-600"
              }`} />
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{cp.name}</p>
              <p className="text-xs font-mono text-gray-500">{cp.charge_point_id}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
              {cp.cp_status}
            </span>
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${cp.is_online
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-gray-500 bg-gray-800 border-gray-700"
              }`}>
              {cp.is_online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {cp.is_online ? "Online" : "Offline"}
            </span>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-800 rounded-lg p-2 text-center">
              <p className="text-gray-500 mb-0.5">Konektor</p>
              <p className="text-white font-semibold">{cp.number_of_connectors}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-2 text-center">
              <p className="text-gray-500 mb-0.5">Tarif</p>
              <p className="text-white font-semibold text-[10px]">{formatIDR(cp.tariff_per_kwh)}/kWh</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-2 text-center">
              <p className="text-gray-500 mb-0.5">Heartbeat</p>
              <p className="text-white font-semibold text-[10px]">{formatTime(cp.last_heartbeat)}</p>
            </div>
          </div>

          {/* Connectors */}
          {cp.connectors?.length > 0 && (
            <div className="space-y-1">
              {cp.connectors.map((c) => (
                <div key={c.connector_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-400">Konektor {c.connector_id}</span>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${statusColor[c.status] ?? statusColor.Unknown}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Alamat */}
          {cp.address && (
            <div className="flex items-start gap-2 pt-1 border-t border-gray-800">
              <MapPin className="w-3 h-3 text-gray-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500">{cp.address}</p>
            </div>
          )}

          {/* Focus button */}
          <button onClick={onFocus}
            className="w-full flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs rounded-lg transition-colors">
            <Navigation className="w-3 h-3" /> Fokus ke lokasi ini
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Map Component ─────────────────────────────────────────────
function LeafletMap({ chargePoints, selected, onSelect }: {
  chargePoints: ChargePoint[];
  selected: ChargePoint | null;
  onSelect: (cp: ChargePoint) => void;
}) {
  const mapRef = useRef<any>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current) return;

    // Dynamic import Leaflet (avoid SSR issues)
    import("leaflet").then((L) => {
      // Fix default icon path
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "",
        iconUrl: "",
        shadowUrl: "",
      });

      if (!mapElRef.current || mapRef.current) return;

      // Center ke Indonesia jika tidak ada CP dengan koordinat
      const withCoords = chargePoints.filter((cp) => cp.latitude && cp.longitude);
      const center: [number, number] = withCoords.length
        ? [withCoords[0].latitude!, withCoords[0].longitude!]
        : [-2.5, 118.0];

      const map = L.map(mapElRef.current, {
        center,
        zoom: withCoords.length ? 13 : 5,
        zoomControl: true,
      });

      mapRef.current = map;

      // Tile layer OpenStreetMap
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Tambah marker per charge point
      withCoords.forEach((cp) => {
        const color = markerColor(cp);
        const svg = createMarkerSVG(color, cp.is_online);
        const icon = L.divIcon({
          html: svg,
          className: "",
          iconSize: [36, 44],
          iconAnchor: [18, 44],
          popupAnchor: [0, -44],
        });

        const marker = L.marker([cp.latitude!, cp.longitude!], { icon })
          .addTo(map)
          .on("click", () => onSelect(cp));

        markersRef.current[cp.charge_point_id] = marker;
      });

      // Fit bounds jika ada beberapa CP
      if (withCoords.length > 1) {
        const bounds = L.latLngBounds(withCoords.map((cp) => [cp.latitude!, cp.longitude!]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [chargePoints]);

  // Focus ke selected CP
  useEffect(() => {
    if (!mapRef.current || !selected?.latitude || !selected?.longitude) return;
    mapRef.current.flyTo([selected.latitude, selected.longitude], 16, { duration: 0.8 });
  }, [selected]);

  return (
    <div ref={mapElRef} className="w-full h-full rounded-xl overflow-hidden" />
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function MapPage() {
  const [selected, setSelected] = useState<ChargePoint | null>(null);

  const { data: chargePoints = [], isLoading, refetch } = useQuery<ChargePoint[]>({
    queryKey: ["charge-points-map"],
    queryFn: () => api.get("/api/charge-points").then((r) => r.data),
    refetchInterval: 15000,
  });

  const withCoords = chargePoints.filter((cp) => cp.latitude && cp.longitude);
  const noCoords = chargePoints.filter((cp) => !cp.latitude || !cp.longitude);
  const online = chargePoints.filter((cp) => cp.is_online).length;
  const available = chargePoints.filter((cp) => cp.cp_status === "Available").length;
  const charging = chargePoints.filter((cp) => cp.cp_status === "Charging").length;

  return (
    <div className="flex flex-col h-[calc(100vh-0px)]">
      {/* Top bar */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-950 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Peta Lokasi</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {withCoords.length} dari {chargePoints.length} CP memiliki koordinat
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="hidden xl:flex items-center gap-4 text-xs text-gray-400">
            {[
              { color: "bg-emerald-400", label: `Available (${available})` },
              { color: "bg-blue-400", label: `Charging (${charging})` },
              { color: "bg-red-400", label: "Faulted" },
              { color: "bg-gray-500", label: "Offline" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                {label}
              </div>
            ))}
          </div>
          <button onClick={() => refetch()}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar list */}
        <div className="w-72 border-r border-gray-800 flex flex-col bg-gray-950 flex-shrink-0">
          {/* Stats */}
          <div className="px-4 py-3 border-b border-gray-800 grid grid-cols-3 gap-2">
            {[
              { label: "Total", value: chargePoints.length, color: "text-white" },
              { label: "Online", value: online, color: "text-emerald-400" },
              { label: "Aktif", value: charging, color: "text-blue-400" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-600">{s.label}</p>
              </div>
            ))}
          </div>

          {/* CP List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />
              </div>
            ) : chargePoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                <BatteryCharging className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-500">Belum ada charge point</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {chargePoints.map((cp) => (
                  <button key={cp.id}
                    onClick={() => setSelected(selected?.id === cp.id ? null : cp)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all ${selected?.id === cp.id
                        ? "bg-gray-800 border border-gray-700"
                        : "hover:bg-gray-800/50 border border-transparent"
                      }`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cp.is_online ? "bg-emerald-400" : "bg-gray-600"
                        }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">{cp.name}</p>
                        <p className="text-xs font-mono text-gray-500 truncate">{cp.charge_point_id}</p>
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded border flex-shrink-0 ${statusColor[cp.cp_status] ?? statusColor.Unknown}`}>
                        {cp.cp_status}
                      </span>
                    </div>
                    {cp.address && (
                      <p className="text-xs text-gray-600 mt-1 pl-4.5 truncate">{cp.address}</p>
                    )}
                    {!cp.latitude && (
                      <p className="text-xs text-amber-500/70 mt-1 pl-4.5 flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5" /> Belum ada koordinat
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* No coords warning */}
          {noCoords.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-800">
              <p className="text-xs text-amber-400/70">
                ⚠ {noCoords.length} CP belum memiliki koordinat — tambahkan latitude & longitude di halaman Charge Points
              </p>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          {isLoading ? (
            <div className="flex items-center justify-center h-full bg-gray-900">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : (
            <div className="h-full p-3">
              <LeafletMap
                chargePoints={withCoords}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          )}

          {/* Info card popup */}
          {selected && (
            <InfoCard
              cp={selected}
              onClose={() => setSelected(null)}
              onFocus={() => {
                if (selected.latitude && selected.longitude) {
                  // Trigger flyTo via selected state change
                  setSelected({ ...selected });
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
