
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useRealtimeSync() {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:8000"}/ws/monitor`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25000);
      };

      ws.onclose = () => {
        if (pingRef.current) clearInterval(pingRef.current);
        if (!destroyed) setTimeout(connect, 3000);
      };

      ws.onerror = () => { };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch { }
      };
    }

    function updateCPInList(queryKey: any[], charge_point_id: string, data: any) {
      qc.setQueryData<any[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((cp) =>
          cp.charge_point_id === charge_point_id ? { ...cp, ...data } : cp
        );
      });
    }

    function updateConnectorInList(queryKey: any[], charge_point_id: string, connector_id: number, status: string) {
      qc.setQueryData<any[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((cp) => {
          if (cp.charge_point_id !== charge_point_id) return cp;
          const connectors = [...(cp.connectors ?? [])];
          const idx = connectors.findIndex((c: any) => c.connector_id === connector_id);
          if (idx >= 0) connectors[idx] = { ...connectors[idx], status };
          else connectors.push({ connector_id, status, error_code: null });

          // Tentukan cp_status dari semua konektor
          let cpStatus = cp.cp_status;
          const allStatuses = connectors.map((c: any) => c.status);
          if (allStatuses.includes("Charging")) cpStatus = "Charging";
          else if (allStatuses.includes("Faulted")) cpStatus = "Faulted";
          else if (allStatuses.every((s: string) => s === "Available")) cpStatus = "Available";
          else if (allStatuses.includes("Unavailable")) cpStatus = "Unavailable";

          return { ...cp, connectors, cp_status: cpStatus };
        });
      });
    }

    function handleMessage(msg: any) {
      const cpId = msg.charge_point_id;

      switch (msg.type) {

        case "cp_update": {
          const patch: any = {};
          if (msg.data.is_online !== undefined) patch.is_online = msg.data.is_online;
          if (msg.data.cp_status && msg.data.cp_status !== "null") patch.cp_status = msg.data.cp_status;
          if (msg.data.last_heartbeat) patch.last_heartbeat = msg.data.last_heartbeat;
          if (msg.data.vendor_name) patch.vendor_name = msg.data.vendor_name;
          if (msg.data.model) patch.model = msg.data.model;

          // Update semua query key yang mungkin dipakai
          updateCPInList(["charge-points"], cpId, patch);
          updateCPInList(["charge-points-map"], cpId, patch);
          updateCPInList(["cp-list-simple"], cpId, patch);

          // Invalidate dashboard
          qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          break;
        }

        case "connector_update": {
          const { connector_id, status } = msg;

          updateConnectorInList(["charge-points"], cpId, connector_id, status);
          updateConnectorInList(["charge-points-map"], cpId, connector_id, status);
          updateConnectorInList(["cp-list-simple"], cpId, connector_id, status);

          // Invalidate semua query yang menampilkan status
          qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          qc.invalidateQueries({ queryKey: ["alerts-all"] });
          break;
        }

        case "transaction_update": {
          const { data } = msg;

          if (data.event === "start") {
            qc.setQueryData<any[]>(["transactions-recent"], (old) => {
              const newTx = {
                id: Date.now(),
                transaction_id: data.transaction_id,
                charge_point_id: cpId,
                connector_id: data.connector_id,
                id_tag: data.id_tag,
                start_timestamp: data.timestamp,
                stop_timestamp: null,
                energy_consumed_kwh: null,
                total_cost: null,
                status: "Active",
              };
              return [newTx, ...(old ?? [])].slice(0, 10);
            });
          } else if (data.event === "stop") {
            qc.setQueryData<any[]>(["transactions-recent"], (old) => {
              if (!old) return old;
              return old.map((tx) =>
                tx.transaction_id === data.transaction_id
                  ? { ...tx, status: "Completed", energy_consumed_kwh: data.energy_kwh, total_cost: data.total_cost }
                  : tx
              );
            });
          }

          // Invalidate semua query transaksi
          qc.invalidateQueries({ queryKey: ["transactions"] });
          qc.invalidateQueries({ queryKey: ["transactions-recent"] });
          qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
          qc.invalidateQueries({ queryKey: ["customer-transactions"] });
          break;
        }

        case "meter_value":
          qc.invalidateQueries({ queryKey: ["meter-values"] });
          break;
      }
    }

    connect();
    return () => {
      destroyed = true;
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [qc]);
}
