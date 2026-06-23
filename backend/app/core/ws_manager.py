"""
ZEUS CSMS — WebSocket Manager
Broadcast real-time status charge point ke semua client frontend.
"""

import asyncio
import json
import logging
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger("zeus.ws")


class ConnectionManager:
    """
    Mengelola semua koneksi WebSocket dari frontend.
    Broadcast pesan ke semua client yang terhubung.
    """

    def __init__(self):
        # Set semua active connections
        self.active: Set[WebSocket] = set()
        # State terkini tiap charge point — disimpan in-memory
        self.state: Dict[str, dict] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.add(websocket)
        logger.info("Frontend client terhubung. Total: %d", len(self.active))
        if self.state:
            try:
                # Pastikan websocket masih dalam state connected
                if websocket.client_state.value == 1:  # CONNECTED
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "snapshot",
                                "data": self.state,
                            }
                        )
                    )
            except Exception as e:
                logger.error("WebSocket error: %s", e)
                self.active.discard(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active.discard(websocket)
        logger.info("Frontend client terputus. Total: %d", len(self.active))

    async def broadcast(self, message: dict):
        """Kirim pesan ke semua client yang terhubung."""
        if not self.active:
            return
        text = json.dumps(message)
        dead = set()
        for ws in self.active.copy():
            try:
                await ws.send_text(text)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active.discard(ws)

    async def update_cp_status(self, charge_point_id: str, update: dict):
        """Update state CP dan broadcast ke semua frontend client."""
        if charge_point_id not in self.state:
            self.state[charge_point_id] = {}
        # Hapus key None/null agar tidak override status yang valid
        clean = {k: v for k, v in update.items() if v is not None and str(v) != "None"}
        self.state[charge_point_id].update(clean)
        await self.broadcast(
            {
                "type": "cp_update",
                "charge_point_id": charge_point_id,
                "data": self.state[charge_point_id],
            }
        )

    async def update_connector(
        self, charge_point_id: str, connector_id: int, status: str
    ):
        """Update status konektor spesifik, hitung cp_status, dan broadcast."""
        if charge_point_id not in self.state:
            self.state[charge_point_id] = {}
        if "connectors" not in self.state[charge_point_id]:
            self.state[charge_point_id]["connectors"] = {}
        self.state[charge_point_id]["connectors"][str(connector_id)] = status

        # Hitung cp_status dari semua konektor (kecuali connector_id=0)
        all_statuses = [
            v for k, v in self.state[charge_point_id]["connectors"].items() if k != "0"
        ]
        if "Charging" in all_statuses:
            cp_status = "Charging"
        elif "Faulted" in all_statuses:
            cp_status = "Faulted"
        elif "Preparing" in all_statuses:
            cp_status = "Preparing"
        elif "Finishing" in all_statuses:
            cp_status = "Finishing"
        elif "Reserved" in all_statuses:
            cp_status = "Reserved"
        elif "SuspendedEV" in all_statuses or "SuspendedEVSE" in all_statuses:
            cp_status = "Suspended"
        elif all_statuses and all(s == "Available" for s in all_statuses):
            cp_status = "Available"
        elif "Unavailable" in all_statuses:
            cp_status = "Unavailable"
        else:
            cp_status = self.state[charge_point_id].get("cp_status", "Unknown")

        self.state[charge_point_id]["cp_status"] = cp_status

        await self.broadcast(
            {
                "type": "connector_update",
                "charge_point_id": charge_point_id,
                "connector_id": connector_id,
                "status": status,
                "cp_status": cp_status,
            }
        )

    async def update_transaction(self, charge_point_id: str, transaction: dict):
        """Broadcast event transaksi baru."""
        await self.broadcast(
            {
                "type": "transaction_update",
                "charge_point_id": charge_point_id,
                "data": transaction,
            }
        )

    async def update_meter_value(self, charge_point_id: str, data: dict):
        """Broadcast update meter value real-time ke frontend."""
        await self.broadcast(
            {
                "type": "meter_value_update",
                "charge_point_id": charge_point_id,
                "data": data,
            }
        )


# ── Singleton instance — dipakai oleh OCPP server & FastAPI ──
ws_manager = ConnectionManager()

# ── External Subscriber Manager — Energy Monitoring & Forecasting ──


class ExternalWSManager:
    """
    Mengelola koneksi WebSocket dari proyek eksternal
    (Energy Monitoring + Forecasting). Terpisah dari frontend.
    """

    def __init__(self):
        self.active: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.add(websocket)
        logger.info("External client terhubung. Total: %d", len(self.active))

    def disconnect(self, websocket: WebSocket):
        self.active.discard(websocket)
        logger.info("External client terputus. Total: %d", len(self.active))

    async def broadcast(self, data: dict):
        if not self.active:
            return
        text = json.dumps(data)
        dead = set()
        for ws in self.active.copy():
            try:
                await ws.send_text(text)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active.discard(ws)


# Singleton — dipakai oleh OCPP server & endpoint WebSocket eksternal
ext_manager = ExternalWSManager()
