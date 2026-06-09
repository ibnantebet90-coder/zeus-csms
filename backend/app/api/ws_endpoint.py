"""
ZEUS CSMS — WebSocket Endpoint
GET /ws/monitor — frontend subscribe ke real-time updates
"""

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.ws_manager import ws_manager

logger = logging.getLogger("zeus.ws")
router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/monitor")
async def monitor(websocket: WebSocket):
    """
    Frontend connect ke sini untuk terima update real-time:
    - cp_update      : status online/offline charge point berubah
    - connector_update: status konektor berubah
    - transaction_update: transaksi baru dimulai atau selesai
    - snapshot       : state lengkap semua CP saat pertama connect
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep-alive — terima ping dari client
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error("WebSocket error: %s", e)
        ws_manager.disconnect(websocket)
