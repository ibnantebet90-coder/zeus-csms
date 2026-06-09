"""
ZEUS CSMS — External WebSocket Endpoint
Endpoint untuk proyek eksternal (Energy Monitoring & Forecasting).
"""

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from app.core.ws_manager import ext_manager
from app.core.security import decode_access_token

logger = logging.getLogger("zeus.ws.ext")
router = APIRouter()


@router.websocket("/ws/ext")
async def external_ws_endpoint(websocket: WebSocket, token: str = Query(...)):
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ext_manager.connect(websocket)
    logger.info("External client authenticated: %s", payload.get("sub"))

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ext_manager.disconnect(websocket)
