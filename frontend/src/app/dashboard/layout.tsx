"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Sidebar from "@/components/Sidebar";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket("ws://127.0.0.1:8000/ws/monitor");
      wsRef.current = ws;
      ws.onopen = () => console.log("[ZEUS] WS open");
      ws.onclose = () => { if (!destroyed) setTimeout(connect, 3000); };
      ws.onerror = () => { };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const cpId = msg.charge_point_id;
          if (msg.type === "connector_update") {
            const { connector_id, status, cp_status: newCpStatus } = msg;
            const updater = (prev: any[]) => {
              if (!prev) return prev;
              return prev.map((cp: any) => {
                if (cp.charge_point_id !== cpId) return cp;
                const connectors = [...(cp.connectors ?? [])];
                const idx = connectors.findIndex((c: any) => c.connector_id === connector_id);
                if (idx >= 0) connectors[idx] = { ...connectors[idx], status };
                else connectors.push({ connector_id, status, error_code: null });
                const isCharging = connectors.some((c: any) => c.status === "Charging");
                return { ...cp, connectors, cp_status: newCpStatus || (isCharging ? "Charging" : cp.cp_status) };
              });
            };
            qc.setQueryData<any[]>(["charge-points"], updater);
            qc.setQueryData<any[]>(["charge-points-map"], updater);
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }
          if (msg.type === "snapshot") {
            Object.entries(msg.data).forEach(([snapCpId, data]: [string, any]) => {
              const connectors = Object.entries(data.connectors || {})
                .filter(([id]) => id !== "0")
                .map(([id, s]) => ({ connector_id: parseInt(id), status: s, error_code: null }));
              const patch = { ...data, connectors, cp_status: connectors.some((c: any) => c.status === "Charging") ? "Charging" : data.cp_status || "Unknown" };
              qc.setQueryData<any[]>(["charge-points"], (old) => old ? old.map((cp: any) => cp.charge_point_id === snapCpId ? { ...cp, ...patch } : cp) : old);
              qc.setQueryData<any[]>(["charge-points-map"], (old) => old ? old.map((cp: any) => cp.charge_point_id === snapCpId ? { ...cp, ...patch } : cp) : old);
            });
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }
          if (msg.type === "cp_update") {
            const patch: any = {};
            if (msg.data.is_online !== undefined) patch.is_online = msg.data.is_online;
            if (msg.data.last_heartbeat) patch.last_heartbeat = msg.data.last_heartbeat;
            const updater = (prev: any[]) => prev ? prev.map((cp: any) => {
              if (cp.charge_point_id !== cpId) return cp;
              const isCharging = (cp.connectors ?? []).some((c: any) => c.status === "Charging");
              const cpStatus = isCharging ? cp.cp_status : (msg.data.cp_status && msg.data.cp_status !== "null" ? msg.data.cp_status : cp.cp_status);
              return { ...cp, ...patch, cp_status: cpStatus };
            }) : prev;
            qc.setQueryData<any[]>(["charge-points"], updater);
            qc.setQueryData<any[]>(["charge-points-map"], updater);
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }
          if (msg.type === "transaction_update") {
            qc.invalidateQueries({ queryKey: ["transactions"] });
            qc.invalidateQueries({ queryKey: ["transactions-recent"] });
            qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }
        } catch { }
      };
    }
    connect();
    return () => { destroyed = true; wsRef.current?.close(); };
  }, [user, qc]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-gray-950 relative">
      {/* Background image subtle overlay */}
      <div className="fixed inset-0 z-0 pointer-events-none"
        style={{ backgroundImage: "url('/bg-2.jpg')", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.04 }} />
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative z-10">{children}</main>
    </div>
  );
}
