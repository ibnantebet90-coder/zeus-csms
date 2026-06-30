"""
ZEUS CSMS — FastAPI Main App
OCPP server dijalankan sebagai background task dalam proses yang sama
sehingga ws_manager bisa di-share untuk real-time broadcast.
"""

import asyncio
import logging
import os
from dotenv import load_dotenv
from ocpp_server.central_system import auto_complete_stale_transactions
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from app.api import (
    auth,
    charge_points,
    transactions,
    alerts,
    users,
    tariffs,
    ws_endpoint,
    forecasting,
    forecasting_io,
    energy_monitoring,
    remote_commands,
    report,
    external_ws,
    vouchers,
)

# [v0.5] customers dan charging_limit digabung dalam satu file
from app.api.customers import customer_router, id_tag_router, limit_router

logger = logging.getLogger("zeus.main")

app = FastAPI(
    title="ZEUS CSMS API",
    description="Charging Station Management System — OCPP 1.6",
    version="0.5.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(charge_points.router)
app.include_router(customer_router)
app.include_router(id_tag_router)
app.include_router(limit_router)
app.include_router(transactions.router)
app.include_router(alerts.router)
app.include_router(users.router)
app.include_router(tariffs.router)
app.include_router(ws_endpoint.router)
app.include_router(forecasting.router)
app.include_router(forecasting_io.router)
app.include_router(energy_monitoring.router)
app.include_router(remote_commands.router)
app.include_router(report.router)
app.include_router(external_ws.router)
app.include_router(vouchers.router)


# ── Background task — jalankan OCPP server dalam proses yang sama ──
@app.on_event("startup")
async def start_ocpp_server():
    """
    Jalankan OCPP WebSocket server sebagai asyncio background task.
    Dengan cara ini ws_manager di-share antara OCPP server dan FastAPI.
    """
    try:
        import websockets
        from ocpp_server.central_system import on_connect

        ocpp_host = os.getenv("OCPP_HOST", "0.0.0.0")
        ocpp_port = int(os.getenv("OCPP_PORT", "8887"))

        server = await websockets.serve(
            on_connect,
            ocpp_host,
            ocpp_port,
            subprotocols=["ocpp1.6"],  # type: ignore
            ping_interval=None,
        )

        logger.info("OCPP server berjalan di ws://%s:%s", ocpp_host, ocpp_port)

        app.state.ocpp_server = server

        asyncio.create_task(auto_complete_stale_transactions())

    except Exception as e:
        logger.error("Gagal menjalankan OCPP server: %s", e)


@app.on_event("shutdown")
async def stop_ocpp_server():
    if hasattr(app.state, "ocpp_server"):
        app.state.ocpp_server.close()
        await app.state.ocpp_server.wait_closed()
        logger.info("OCPP server dihentikan.")


@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "app": "ZEUS CSMS", "version": "0.5.0"}


@app.get("/health", tags=["Health"])
def health():
    return {"status": "healthy"}
