"""
ZEUS CSMS — OCPP 1.6 Central System
Handler lengkap dengan broadcast WebSocket real-time ke frontend.
"""

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TZ_JAKARTA = ZoneInfo("Asia/Jakarta")


def parse_timestamp(ts_str) -> datetime:
    """Konversi timestamp string dari CS ke datetime WIB (naive)."""
    if not ts_str:
        return datetime.now(TZ_JAKARTA).replace(tzinfo=None)
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.astimezone(TZ_JAKARTA).replace(tzinfo=None)
    except Exception:
        return datetime.now(TZ_JAKARTA).replace(tzinfo=None)


import pymysql
from dotenv import load_dotenv

try:
    import websockets
except ModuleNotFoundError:
    print("Install websockets dulu: pip install websockets")
    sys.exit(1)

from ocpp.routing import on
from ocpp.v16 import ChargePoint as cp
from ocpp.v16 import call_result
from ocpp.v16.enums import (
    Action,
    AuthorizationStatus,
    RegistrationStatus,
)

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s WIB [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.Formatter.converter = lambda *args: datetime.now(TZ_JAKARTA).timetuple()
logger = logging.getLogger("zeus.ocpp")

# ── Load .env ─────────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "zeus_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "zeus_password")
DB_NAME = os.getenv("DB_NAME", "zeus_csms")
OCPP_HOST = os.getenv("OCPP_HOST", "10.10.204.205")
OCPP_PORT = int(os.getenv("OCPP_PORT", "9000"))
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "30"))

# ── CP Registry — singleton di-share dengan remote_commands ──
from ocpp_server._cp_registry import _cp_registry

# ── Import ws_manager (lazy — agar tidak crash jika dijalankan standalone) ──
try:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app.core.ws_manager import ws_manager, ext_manager

    WS_ENABLED = True
    logger.info("WebSocket manager loaded — real-time broadcast aktif.")
except ImportError:
    WS_ENABLED = False
    logger.warning("WebSocket manager tidak ditemukan — broadcast dinonaktifkan.")


# ════════════════════════════════════════════════════════════
#  DATABASE HELPER
# ════════════════════════════════════════════════════════════


def get_db():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        init_command="SET time_zone='+07:00'",
    )


def db_execute(sql: str, params: tuple = ()):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.lastrowid
    except Exception as e:
        logger.error("DB execute error: %s | SQL: %s | Params: %s", e, sql, params)
    finally:
        conn.close()


def db_fetchone(sql: str, params: tuple = ()):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()
    finally:
        conn.close()


def db_fetchall(sql: str, params: tuple = ()):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()


async def broadcast(method: str, *args, **kwargs):
    """Helper — broadcast ke WebSocket jika enabled."""
    if WS_ENABLED:
        try:
            await getattr(ws_manager, method)(*args, **kwargs)
        except Exception as e:
            logger.debug("WS broadcast error: %s", e)


async def ext_broadcast(data: dict):
    """Broadcast ke proyek eksternal (Energy Monitoring & Forecasting)."""
    if WS_ENABLED:
        try:
            await ext_manager.broadcast(data)
        except Exception as e:
            logger.debug("Ext WS broadcast error: %s", e)


async def auto_complete_stale_transactions():
    """Background task — auto-complete transaksi Active yang sudah tidak ada MeterValues > 15 menit."""
    while True:
        await asyncio.sleep(60)  # Cek setiap 1 menit
        try:
            stale = db_fetchall(
                """SELECT t.transaction_id, t.charge_point_id, t.connector_id,
                        t.meter_start, t.tariff_per_kwh,
                        mv.last_meter, mv.mv_timestamp as last_mv_time
                    FROM transactions t
                    LEFT JOIN (
                        SELECT transaction_id,
                            MAX(value) as last_meter,
                            MAX(timestamp) as mv_timestamp
                        FROM meter_values
                        WHERE measurand='Energy.Active.Import.Register'
                        GROUP BY transaction_id
                    ) mv ON mv.transaction_id = t.transaction_id
                    WHERE t.status='Active'
                    AND (
                        (
                            mv.mv_timestamp IS NULL
                            AND t.start_timestamp < NOW() - INTERVAL 15 MINUTE
                        )
                        OR mv.mv_timestamp < NOW() - INTERVAL 15 MINUTE
                    )""",
            )
            if not stale:
                continue

            for tx in stale:
                transaction_id = tx["transaction_id"]
                charge_point_id = tx["charge_point_id"]
                meter_stop = (
                    int(tx["last_meter"]) if tx["last_meter"] else tx["meter_start"]
                )
                energy_kwh = None
                total_cost = None

                if tx["meter_start"] and meter_stop:
                    energy_kwh = round((meter_stop - tx["meter_start"]) / 1000, 3)
                    if tx["tariff_per_kwh"]:
                        total_cost = round(energy_kwh * float(tx["tariff_per_kwh"]), 2)

                db_execute(
                    """UPDATE transactions SET
                        meter_stop=%s, stop_timestamp=NOW(), stop_reason='AutoCompleted',
                        energy_consumed_kwh=%s, total_cost=%s,
                        status='Completed', updated_at=NOW()
                        WHERE transaction_id=%s AND status='Active'""",
                    (meter_stop, energy_kwh, total_cost, transaction_id),
                )

                cp = db_fetchone(
                    "SELECT is_online FROM charge_points WHERE charge_point_id=%s",
                    (charge_point_id,),
                )
                db_execute(
                    """UPDATE charge_points SET cp_status='Available', updated_at=NOW()
                        WHERE charge_point_id=%s""",
                    (charge_point_id,),
                )

                logger.warning(
                    "AutoComplete — transaksi %s (%s) di-complete otomatis. "
                    "Energi: %s kWh, meter_stop: %s",
                    transaction_id,
                    charge_point_id,
                    energy_kwh,
                    meter_stop,
                )

                await broadcast(
                    "update_cp_status",
                    charge_point_id,
                    {
                        "cp_status": "Available",
                        "is_online": cp["is_online"] if cp else False,
                    },
                )
                await broadcast(
                    "update_transaction",
                    charge_point_id,
                    {
                        "event": "stop",
                        "transaction_id": transaction_id,
                        "meter_stop": meter_stop,
                        "energy_kwh": energy_kwh,
                        "total_cost": total_cost,
                        "status": "Completed",
                    },
                )

        except Exception as e:
            logger.error("AutoComplete job error: %s", e)


# ════════════════════════════════════════════════════════════
#  CHARGE POINT CLASS
# ════════════════════════════════════════════════════════════


class ChargePoint(cp):

    # ── 1. BootNotification ──────────────────────────────────
    @on(Action.boot_notification)
    async def on_boot_notification(
        self, charge_point_vendor, charge_point_model, **kwargs
    ):
        try:
            now = datetime.now(TZ_JAKARTA)
            logger.info("[%s] BootNotification DITERIMA! (Bypass mode aktif)", self.id)
            return call_result.BootNotification(
                current_time=now.isoformat(),
                interval=30,  # Hardcode dulu sementara
                status=RegistrationStatus.accepted,
            )
        except Exception as e:
            logger.error(f"Gagal membalas BootNotification: {e}")

    # ── 2. Heartbeat ─────────────────────────────────────────
    @on(Action.heartbeat)
    async def on_heartbeat(self, **kwargs):
        now = datetime.now(TZ_JAKARTA)
        logger.info("[%s] Heartbeat", self.id)
        db_execute(
            "UPDATE charge_points SET last_heartbeat=%s, is_online=1, updated_at=%s WHERE charge_point_id=%s",
            (now, now, self.id),
        )
        await broadcast(
            "update_cp_status",
            self.id,
            {
                "is_online": True,
                "last_heartbeat": now.isoformat(),
                # Tidak update cp_status di heartbeat — biarkan StatusNotification yang kontrol
            },
        )
        return call_result.Heartbeat(current_time=now.isoformat())

    # ── 3. Authorize ─────────────────────────────────────────
    @on(Action.authorize)
    async def on_authorize(self, id_tag, **kwargs):
        logger.info("[%s] Authorize — id_tag: %s", self.id, id_tag)
        now = datetime.now(TZ_JAKARTA)

        # 1. Cek customer dasar (status, expiry)
        row = db_fetchone(
            """SELECT c.status, c.expiry_date_time as expiry_date,
                c.id as customer_id, c.charge_limit_enabled,
                c.monthly_charge_limit
                FROM customers c
                WHERE c.id_tag_token = %s""",
            (id_tag,),
        )

        if not row:
            logger.warning("[%s] id_tag tidak ditemukan: %s", self.id, id_tag)
            return call_result.Authorize(
                id_tag_info={"status": AuthorizationStatus.invalid}  # type: ignore
            )

        if row["status"] == "Blocked":
            return call_result.Authorize(
                id_tag_info={"status": AuthorizationStatus.blocked}  # type: ignore
            )

        if row["status"] == "Expired" or (
            row["expiry_date"] and row["expiry_date"] < now.replace(tzinfo=None)
        ):
            return call_result.Authorize(
                id_tag_info={"status": AuthorizationStatus.expired}  # type: ignore
            )

        # 2. Cek charging limit
        auth_status = AuthorizationStatus.accepted

        if row.get("charge_limit_enabled", True):
            # Ambil config global
            cfg = db_fetchone(
                "SELECT monthly_limit, is_enabled FROM charging_limit_config WHERE id=1"
            )
            global_enabled = cfg["is_enabled"] if cfg else True
            global_limit = cfg["monthly_limit"] if cfg else 15

            if global_enabled:
                # Limit efektif: override per customer atau global
                raw_limit = (
                    row["monthly_charge_limit"]
                    if row["monthly_charge_limit"] is not None
                    else global_limit
                )

                # Hitung pemakaian bulan ini
                now_dt = now.replace(tzinfo=None)
                month_start = now_dt.replace(
                    day=1, hour=0, minute=0, second=0, microsecond=0
                )

                used_row = db_fetchone(
                    """SELECT COUNT(*) as cnt FROM transactions
                        WHERE id_tag = %s
                        AND status = 'Completed'
                        AND start_timestamp >= %s""",
                    (id_tag, month_start),
                )
                used = used_row["cnt"] if used_row else 0

                # Cek extra sessions dari request yang di-approve bulan ini
                extra_row = db_fetchone(
                    """SELECT COALESCE(SUM(extra_sessions), 0) as extra
                        FROM charge_limit_requests
                        WHERE customer_id = %s
                        AND status = 'Approved'
                        AND resolved_at >= %s""",
                    (row["customer_id"], month_start),
                )
                extra = int(extra_row["extra"]) if extra_row else 0

                effective_limit = raw_limit + extra

                if used >= effective_limit:
                    logger.warning(
                        "[%s] Authorize DITOLAK — over limit: %s (%d/%d sesi bulan ini)",
                        self.id,
                        id_tag,
                        used,
                        effective_limit,
                    )
                    # Auto-buat request sementara jika belum ada Pending
                    pending = db_fetchone(
                        """SELECT id FROM charge_limit_requests
                            WHERE customer_id = %s AND status = 'Pending'""",
                        (row["customer_id"],),
                    )
                    if not pending:
                        db_execute(
                            """INSERT INTO charge_limit_requests
                                (customer_id, id_tag, charge_point_id, reason, status, requested_at)
                                VALUES (%s, %s, %s, %s, 'Pending', NOW())""",
                            (
                                row["customer_id"],
                                id_tag,
                                self.id,
                                f"Auto-request: limit bulanan ({effective_limit}x) tercapai",
                            ),
                        )
                        logger.info(
                            "[%s] Auto-created limit request untuk customer_id=%s",
                            self.id,
                            row["customer_id"],
                        )

                    auth_status = AuthorizationStatus.blocked

        logger.info("[%s] Authorize result — %s: %s", self.id, id_tag, auth_status)
        result = call_result.Authorize(id_tag_info={"status": auth_status})  # type: ignore
        if auth_status == AuthorizationStatus.accepted:
            asyncio.ensure_future(
                broadcast("update_connector", self.id, 1, "Preparing")
            )
        return result

    # ── 4. StatusNotification ────────────────────────────────
    @on(Action.status_notification)
    async def on_status_notification(self, connector_id, error_code, status, **kwargs):
        now = parse_timestamp(kwargs.get("timestamp"))
        vendor_id = kwargs.get("vendor_id")
        vendor_error_code = kwargs.get("vendor_error_code")
        info = kwargs.get("info")

        logger.info(
            "[%s] StatusNotification — connector: %s, status: %s, error: %s",
            self.id,
            connector_id,
            status,
            error_code,
        )

        existing = db_fetchone(
            "SELECT id FROM connectors WHERE charge_point_id=%s AND connector_id=%s",
            (self.id, connector_id),
        )

        if existing:
            db_execute(
                """UPDATE connectors SET status=%s, error_code=%s, vendor_id=%s,
                    vendor_error_code=%s, info=%s, timestamp=%s, updated_at=NOW()
                    WHERE charge_point_id=%s AND connector_id=%s""",
                (
                    status,
                    error_code,
                    vendor_id,
                    vendor_error_code,
                    info,
                    now,
                    self.id,
                    connector_id,
                ),
            )
        else:
            db_execute(
                """INSERT INTO connectors
                    (charge_point_id, connector_id, status, error_code,
                    vendor_id, vendor_error_code, info, timestamp)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    self.id,
                    connector_id,
                    status,
                    error_code,
                    vendor_id,
                    vendor_error_code,
                    info,
                    now,
                ),
            )

        db_execute(
            "UPDATE charge_points SET cp_status=%s WHERE charge_point_id=%s",
            (status, self.id),
        )

        if error_code and error_code != "NoError":
            db_execute(
                """INSERT INTO alerts
                    (charge_point_id, connector_id, timestamp, status,
                    error_code, vendor_id, vendor_error_code, info)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    self.id,
                    connector_id,
                    now,
                    status,
                    error_code,
                    vendor_id,
                    vendor_error_code,
                    info,
                ),
            )
            logger.warning(
                "[%s] ALERT — connector: %s, error: %s",
                self.id,
                connector_id,
                error_code,
            )

        # Broadcast connector status ke frontend
        await broadcast("update_connector", self.id, connector_id, status)
        await broadcast(
            "update_cp_status",
            self.id,
            {"cp_status": status},
        )

        # Auto-complete transaksi jika connector melaporkan Available saat masih ada transaksi Active
        # Ini menangani kasus middleware tidak meneruskan StopTransaction ke Zeus
        if status == "Available" and connector_id == 1:
            active_tx = db_fetchone(
                """SELECT transaction_id, meter_start, tariff_per_kwh
                    FROM transactions
                    WHERE charge_point_id=%s AND connector_id=%s AND status='Active'
                    ORDER BY id DESC LIMIT 1""",
                (self.id, connector_id),
            )
            if active_tx:
                last_mv = db_fetchone(
                    """SELECT MAX(value) as last_meter FROM meter_values
                        WHERE transaction_id=%s
                        AND measurand='Energy.Active.Import.Register'""",
                    (active_tx["transaction_id"],),
                )
                meter_stop = (
                    int(last_mv["last_meter"])
                    if last_mv and last_mv["last_meter"]
                    else active_tx["meter_start"]
                )
                energy_kwh = None
                total_cost = None
                if active_tx["meter_start"] is not None:
                    energy_kwh = round(
                        (meter_stop - active_tx["meter_start"]) / 1000, 3
                    )
                    if active_tx["tariff_per_kwh"]:
                        total_cost = round(
                            energy_kwh * float(active_tx["tariff_per_kwh"]), 2
                        )

                db_execute(
                    """UPDATE transactions SET meter_stop=%s, stop_timestamp=NOW(),
                        stop_reason='StatusNotification', energy_consumed_kwh=%s,
                        total_cost=%s, status='Completed', updated_at=NOW()
                        WHERE transaction_id=%s AND status='Active'""",
                    (meter_stop, energy_kwh, total_cost, active_tx["transaction_id"]),
                )
                db_execute(
                    "UPDATE charge_points SET cp_status='Available', updated_at=NOW() WHERE charge_point_id=%s",
                    (self.id,),
                )
                await broadcast(
                    "update_transaction",
                    self.id,
                    {
                        "event": "stop",
                        "transaction_id": active_tx["transaction_id"],
                        "meter_stop": meter_stop,
                        "energy_kwh": energy_kwh,
                        "total_cost": total_cost,
                        "status": "Completed",
                    },
                )
                await broadcast(
                    "update_cp_status",
                    self.id,
                    {"cp_status": "Available", "is_online": True},
                )
                logger.info(
                    "[%s] Transaksi %s di-complete via StatusNotification Available. "
                    "Energi: %s kWh, meter_stop: %s",
                    self.id,
                    active_tx["transaction_id"],
                    energy_kwh,
                    meter_stop,
                )

        return call_result.StatusNotification()

    # ── 5. StartTransaction ──────────────────────────────────
    @on(Action.start_transaction)
    async def on_start_transaction(
        self, connector_id, id_tag, meter_start, timestamp, **kwargs
    ):
        logger.info(
            "[%s] StartTransaction — connector: %s, id_tag: %s, meter_start: %s Wh",
            self.id,
            connector_id,
            id_tag,
            meter_start,
        )

        row = db_fetchone(
            "SELECT id, status FROM customers WHERE id_tag_token = %s", (id_tag,)
        )
        id_tag_status = (
            AuthorizationStatus.accepted
            if (row and row["status"] == "Accepted")
            else AuthorizationStatus.invalid
        )
        customer_id = row["id"] if row else None

        tariff_row = db_fetchone(
            "SELECT cost_per_kwh FROM tariffs WHERE charge_point_id=%s AND is_active=1 ORDER BY created_at DESC LIMIT 1",
            (self.id,),
        )
        tariff = tariff_row["cost_per_kwh"] if tariff_row else None

        existing = db_fetchone(
            """SELECT transaction_id FROM transactions
                WHERE charge_point_id=%s AND connector_id=%s
                AND status='Active'""",
            (self.id, connector_id),
        )
        if existing:
            logger.warning(
                "[%s] Duplikat StartTransaction diabaikan — meter_start=%s sudah ada (transaction_id=%s)",
                self.id,
                meter_start,
                existing["transaction_id"],
            )
            asyncio.create_task(self._trigger_status_after_reconnect(connector_id))
            return call_result.StartTransaction(
                transaction_id=existing["transaction_id"],
                id_tag_info={"status": AuthorizationStatus.accepted},  # type: ignore
            )

        transaction_id = (
            int(datetime.now().timestamp() * 10 + connector_id) % 2147483647
        )

        db_execute(
            """INSERT INTO transactions
                (transaction_id, charge_point_id, connector_id, id_tag,
                customer_id, start_timestamp, meter_start, tariff_per_kwh, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'Active')""",
            (
                transaction_id,
                self.id,
                connector_id,
                id_tag,
                customer_id,
                parse_timestamp(timestamp),
                meter_start,
                tariff,
            ),
        )

        logger.info(
            "[%s] Transaksi dimulai — transaction_id: %s", self.id, transaction_id
        )

        # Broadcast ke frontend
        await broadcast(
            "update_transaction",
            self.id,
            {
                "event": "start",
                "transaction_id": transaction_id,
                "connector_id": connector_id,
                "id_tag": id_tag,
                "meter_start": meter_start,
                "timestamp": timestamp,
                "status": "Active",
            },
        )
        await broadcast("update_connector", self.id, connector_id, "Charging")

        await ext_broadcast(
            {
                "event": "transaction_start",
                "cp_id": self.id,
                "connector_id": connector_id,
                "id_tag": id_tag,
                "meter_start_wh": meter_start,
                "timestamp": timestamp,
                "transaction_id": transaction_id,
            }
        )

        return call_result.StartTransaction(
            transaction_id=transaction_id,
            id_tag_info={"status": id_tag_status},  # type: ignore
        )

    # ── 6. StopTransaction ───────────────────────────────────
    @on(Action.stop_transaction)
    async def on_stop_transaction(
        self, meter_stop, timestamp, transaction_id, **kwargs
    ):
        reason = kwargs.get("reason", "Local")
        logger.info(
            "[%s] StopTransaction — transaction_id: %s, meter_stop: %s Wh, reason: %s",
            self.id,
            transaction_id,
            meter_stop,
            reason,
        )

        # Cari transaksi — coba dengan transaction_id dulu (harus Active)
        tx = db_fetchone(
            """SELECT meter_start, tariff_per_kwh, connector_id, transaction_id
                FROM transactions
                WHERE transaction_id=%s AND charge_point_id=%s AND status='Active'""",
            (transaction_id, self.id),
        )

        # Fallback: charger reconnect bisa kirim transaction_id lama atau -1
        if not tx:
            tx = db_fetchone(
                """SELECT meter_start, tariff_per_kwh, connector_id, transaction_id
                    FROM transactions
                    WHERE charge_point_id=%s AND status='Active'
                    ORDER BY id DESC LIMIT 1""",
                (self.id,),
            )
            if tx:
                logger.warning(
                    "[%s] StopTransaction — transaction_id=%s tidak cocok, "
                    "fallback ke transaksi aktif: %s",
                    self.id,
                    transaction_id,
                    tx["transaction_id"],
                )
                transaction_id = tx["transaction_id"]

        if not tx:
            logger.warning(
                "[%s] StopTransaction — tidak ada transaksi Active (transaction_id=%s). Diabaikan.",
                self.id,
                transaction_id,
            )
            return call_result.StopTransaction()

        energy_kwh = None
        total_cost = None

        if tx["meter_start"] is not None:
            energy_wh = meter_stop - tx["meter_start"]
            energy_kwh = round(energy_wh / 1000, 3)
            if tx["tariff_per_kwh"]:
                total_cost = round(energy_kwh * float(tx["tariff_per_kwh"]), 2)
            logger.info(
                "[%s] Energi: %s kWh, biaya: %s", self.id, energy_kwh, total_cost
            )

        db_execute(
            """UPDATE transactions SET meter_stop=%s, stop_timestamp=%s, stop_reason=%s,
                energy_consumed_kwh=%s, total_cost=%s, status='Completed', updated_at=NOW()
                WHERE transaction_id=%s AND charge_point_id=%s""",
            (
                meter_stop,
                parse_timestamp(timestamp),
                reason,
                energy_kwh,
                total_cost,
                transaction_id,
                self.id,
            ),
        )

        connector_id = tx["connector_id"]

        db_execute(
            "UPDATE charge_points SET cp_status='Available', updated_at=NOW() WHERE charge_point_id=%s",
            (self.id,),
        )

        await broadcast(
            "update_transaction",
            self.id,
            {
                "event": "stop",
                "transaction_id": transaction_id,
                "meter_stop": meter_stop,
                "energy_kwh": energy_kwh,
                "total_cost": total_cost,
                "status": "Completed",
            },
        )

        await ext_broadcast(
            {
                "event": "transaction_stop",
                "cp_id": self.id,
                "transaction_id": transaction_id,
                "connector_id": connector_id,
                "meter_stop_wh": meter_stop,
                "energy_kwh": energy_kwh,
                "total_cost": total_cost,
                "timestamp": timestamp,
            }
        )

        await broadcast(
            "update_cp_status",
            self.id,
            {"cp_status": "Available", "is_online": True},
        )

        return call_result.StopTransaction()

    # ── 7. MeterValues ───────────────────────────────────────
    @on(Action.meter_values)
    async def on_meter_values(self, connector_id, meter_value, **kwargs):
        transaction_id = kwargs.get("transaction_id")

        # Cari transaction_id aktif jika tidak dikirim CS
        if transaction_id is None or transaction_id < 0:
            active_tx = db_fetchone(
                """SELECT transaction_id FROM transactions 
                    WHERE charge_point_id=%s AND connector_id=%s 
                    AND status='Active' ORDER BY id DESC LIMIT 1""",
                (self.id, connector_id),
            )
            if active_tx:
                transaction_id = active_tx["transaction_id"]
                logger.debug(
                    "[%s] MeterValues — transaction_id=%s ditemukan dari DB (connector=%s)",
                    self.id,
                    transaction_id,
                    connector_id,
                )
            else:
                logger.debug(
                    "[%s] MeterValues diabaikan — tidak ada transaksi aktif (transaction_id=%s)",
                    self.id,
                    transaction_id,
                )
                return call_result.MeterValues()

        for mv in meter_value:
            timestamp = parse_timestamp(mv.get("timestamp"))
            for sv in mv.get("sampled_value", []):
                value = sv.get("value")
                measurand = sv.get("measurand", "Energy.Active.Import.Register")
                unit = sv.get("unit")
                context = sv.get("context")
                fmt = sv.get("format")
                phase = sv.get("phase")
                location = sv.get("location")

                logger.debug(
                    "[%s] MeterValue — %s: %s %s", self.id, measurand, value, unit
                )

                existing_mv = db_fetchone(
                    """SELECT id FROM meter_values 
                        WHERE transaction_id=%s AND timestamp=%s 
                        AND measurand=%s AND charge_point_id=%s""",
                    (transaction_id, timestamp, measurand, self.id),
                )
                if existing_mv:
                    logger.debug(
                        "[%s] MeterValue duplikat diabaikan — %s @ %s",
                        self.id,
                        measurand,
                        timestamp,
                    )
                    continue

                db_execute(
                    """INSERT INTO meter_values
                        (transaction_id, charge_point_id, connector_id, timestamp,
                        measurand, value, unit, context, format, phase, location)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        transaction_id,
                        self.id,
                        connector_id,
                        timestamp,
                        measurand,
                        value,
                        unit,
                        context,
                        fmt,
                        phase,
                        location,
                    ),
                )

                await broadcast(
                    "update_meter_value",
                    self.id,
                    {
                        "connector_id": connector_id,
                        "transaction_id": transaction_id,
                        "measurand": measurand,
                        "value": value,
                        "unit": unit,
                        "timestamp": str(timestamp),
                    },
                )

                if measurand == "Energy.Active.Import.Register":
                    try:
                        energy_kwh = round(float(value) / 1000, 3)
                    except (TypeError, ValueError):
                        energy_kwh = None
                    await ext_broadcast(
                        {
                            "event": "meter_values",
                            "cp_id": self.id,
                            "connector_id": connector_id,
                            "transaction_id": transaction_id,
                            "energy_kwh": energy_kwh,
                            "unit": unit,
                            "timestamp": str(timestamp),
                        }
                    )

        return call_result.MeterValues()

    # ════════════════════════════════════════════════════════
    #  REMOTE COMMAND METHODS — dipanggil oleh remote_commands.py
    # ════════════════════════════════════════════════════════

    @staticmethod
    def _normalize_status(resp) -> str:
        """Ekstrak status string dari response OCPP (enum atau string)."""
        if resp is None:
            return "NoResponse"
        status = getattr(resp, "status", None)
        if status is None:
            return "NoResponse"
        return status.value if hasattr(status, "value") else str(status)

    async def cmd_reset(self, reset_type: str) -> dict:
        from ocpp.v16 import call as ocpp_call
        from ocpp.v16.enums import ResetType

        type_enum = ResetType.soft if reset_type == "Soft" else ResetType.hard
        logger.info("[%s] >> Reset(%s)", self.id, reset_type)
        try:
            resp = await asyncio.wait_for(
                self.call(ocpp_call.Reset(type=type_enum)), timeout=10.0
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << Reset: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout Reset", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ Reset error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_remote_start(
        self, id_tag: str, connector_id: int | None = None
    ) -> dict:
        from ocpp.v16 import call as ocpp_call

        logger.info(
            "[%s] >> RemoteStartTransaction(id_tag=%s, connector=%s)",
            self.id,
            id_tag,
            connector_id,
        )
        try:
            resp = await asyncio.wait_for(
                self.call(
                    ocpp_call.RemoteStartTransaction(
                        id_tag=id_tag, connector_id=connector_id
                    )
                ),
                timeout=10.0,
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << RemoteStartTransaction: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout RemoteStartTransaction", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ RemoteStartTransaction error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_remote_stop(self, transaction_id: int) -> dict:
        from ocpp.v16 import call as ocpp_call

        logger.info(
            "[%s] >> RemoteStopTransaction(transaction_id=%s)", self.id, transaction_id
        )
        try:
            resp = await asyncio.wait_for(
                self.call(
                    ocpp_call.RemoteStopTransaction(transaction_id=transaction_id)
                ),
                timeout=10.0,
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << RemoteStopTransaction: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout RemoteStopTransaction", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ RemoteStopTransaction error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_change_availability(
        self, connector_id: int, availability: str
    ) -> dict:
        from ocpp.v16 import call as ocpp_call
        from ocpp.v16.enums import AvailabilityType

        type_enum = (
            AvailabilityType.operative
            if availability == "Operative"
            else AvailabilityType.inoperative
        )
        logger.info(
            "[%s] >> ChangeAvailability(connector=%s, type=%s)",
            self.id,
            connector_id,
            availability,
        )
        try:
            resp = await asyncio.wait_for(
                self.call(
                    ocpp_call.ChangeAvailability(
                        connector_id=connector_id, type=type_enum
                    )
                ),
                timeout=10.0,
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << ChangeAvailability: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout ChangeAvailability", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ ChangeAvailability error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_unlock_connector(self, connector_id: int) -> dict:
        from ocpp.v16 import call as ocpp_call

        logger.info("[%s] >> UnlockConnector(connector=%s)", self.id, connector_id)
        try:
            resp = await asyncio.wait_for(
                self.call(ocpp_call.UnlockConnector(connector_id=connector_id)),
                timeout=10.0,
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << UnlockConnector: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout UnlockConnector", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ UnlockConnector error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_clear_cache(self) -> dict:
        from ocpp.v16 import call as ocpp_call

        logger.info("[%s] >> ClearCache", self.id)
        try:
            resp = await asyncio.wait_for(
                self.call(ocpp_call.ClearCache()), timeout=10.0
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << ClearCache: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout ClearCache", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ ClearCache error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_get_configuration(self, key: str | None = None) -> dict:
        from ocpp.v16 import call as ocpp_call

        keys = [key] if key else None
        logger.info("[%s] >> GetConfiguration(keys=%s)", self.id, keys)
        try:
            resp = await asyncio.wait_for(
                self.call(ocpp_call.GetConfiguration(key=keys)), timeout=10.0
            )
            if resp is None:
                return {"status": "Rejected", "error": "NoResponse"}
            config_keys = [
                vars(k) if hasattr(k, "__dict__") else k
                for k in (resp.configuration_key or [])
            ]
            logger.info("[%s] << GetConfiguration: %d keys", self.id, len(config_keys))
            return {
                "status": "Accepted",
                "configuration_key": config_keys,
                "unknown_key": resp.unknown_key or [],
            }
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout GetConfiguration", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ GetConfiguration error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_change_configuration(self, key: str, value: str) -> dict:
        from ocpp.v16 import call as ocpp_call

        logger.info("[%s] >> ChangeConfiguration(%s=%s)", self.id, key, value)
        try:
            resp = await asyncio.wait_for(
                self.call(ocpp_call.ChangeConfiguration(key=key, value=value)),
                timeout=10.0,
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << ChangeConfiguration: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout ChangeConfiguration", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ ChangeConfiguration error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def cmd_trigger_message(
        self, requested_message: str, connector_id: int | None = None
    ) -> dict:
        from ocpp.v16 import call as ocpp_call
        from ocpp.v16.enums import MessageTrigger

        msg_map = {
            "BootNotification": MessageTrigger.boot_notification,
            "Heartbeat": MessageTrigger.heartbeat,
            "StatusNotification": MessageTrigger.status_notification,
        }
        trigger = msg_map.get(requested_message, MessageTrigger.heartbeat)
        logger.info(
            "[%s] >> TriggerMessage(%s, connector=%s)",
            self.id,
            requested_message,
            connector_id,
        )
        try:
            resp = await asyncio.wait_for(
                self.call(
                    ocpp_call.TriggerMessage(
                        requested_message=trigger, connector_id=connector_id
                    )
                ),
                timeout=10.0,
            )
            status = self._normalize_status(resp)
            logger.info("[%s] << TriggerMessage: %s", self.id, status)
            return {"status": status}
        except asyncio.TimeoutError:
            logger.error("[%s] ⏱ Timeout TriggerMessage", self.id)
            return {"status": "Rejected", "error": "Timeout"}
        except Exception as e:
            logger.exception("[%s] ❌ TriggerMessage error: %s", self.id, e)
            return {"status": "Failed", "error": str(e)}

    async def _trigger_status_after_reconnect(self, connector_id: int):
        """Setelah deduplikat StartTransaction, trigger charger refresh status."""
        await asyncio.sleep(1)
        try:
            from ocpp.v16 import call as ocpp_call
            from ocpp.v16.enums import MessageTrigger

            await self.call(
                ocpp_call.TriggerMessage(
                    requested_message=MessageTrigger.status_notification,
                    connector_id=connector_id,
                )
            )
            logger.info(
                "[%s] TriggerMessage StatusNotification dikirim setelah reconnect (connector %s)",
                self.id,
                connector_id,
            )
        except Exception as e:
            logger.debug("[%s] TriggerMessage gagal: %s", self.id, e)


# ════════════════════════════════════════════════════════════
#  WEBSOCKET CONNECTION HANDLER
# ════════════════════════════════════════════════════════════


async def on_connect(websocket, path=None):
    # 1. Cek Subprotocol
    if not websocket.subprotocol:
        logger.warning(
            "[%s] Tidak ada subprotocol — melanjutkan sebagai ocpp1.6 (charger non-standard).",
            getattr(websocket, "path", "unknown"),
        )

    # 2. Ambil Charge Point ID dari URL
    # Menggunakan getattr sebagai pengaman jika atribut path berpindah lokasi
    raw_path = path if path else getattr(websocket, "path", "/")
    charge_point_id = raw_path.strip("/")

    if not charge_point_id or charge_point_id == "":
        logger.error("Koneksi ditolak: ID Charge Point tidak ditemukan di URL.")
        return await websocket.close()

    logger.info(
        f"Charge point terhubung: {charge_point_id} | Protocol: {websocket.subprotocol}"
    )

    # 3. Update Database Status Online
    try:
        # Cek apakah ada transaksi aktif sebelum override status
        active_tx_on_connect = db_fetchone(
            """SELECT transaction_id FROM transactions
                WHERE charge_point_id=%s AND status='Active'
                ORDER BY id DESC LIMIT 1""",
            (charge_point_id,),
        )
        reconnect_status = "Charging" if active_tx_on_connect else "Available"
        if active_tx_on_connect:
            logger.info(
                "Charge point %s reconnect — transaksi %s masih Active, "
                "status dipertahankan: Charging",
                charge_point_id,
                active_tx_on_connect["transaction_id"],
            )
        db_execute(
            "UPDATE charge_points SET is_online=1, updated_at=NOW() WHERE charge_point_id=%s",
            (charge_point_id,),
        )
        await broadcast(
            "update_cp_status",
            charge_point_id,
            {
                "is_online": True,
                "cp_status": reconnect_status,
            },
        )
    except Exception as e:
        logger.warning(f"Gagal update status database untuk {charge_point_id}: {e}")

    # 4. Registrasi ke Registry Global
    charge_point = ChargePoint(charge_point_id, websocket)
    _cp_registry[charge_point_id] = charge_point
    logger.info(f"Registry updated: {list(_cp_registry.keys())}")

    try:
        # Menjalankan loop utama OCPP (Mendengarkan BootNotification, dll)
        await charge_point.start()
    except Exception as e:
        logger.error(f"Error pada koneksi {charge_point_id}: {e}")
    finally:
        # 5. Cleanup saat terputus
        _cp_registry.pop(charge_point_id, None)
        logger.info(f"Charge point terputus: {charge_point_id}")

        try:
            # Cek transaksi Active — jika ada, charger akan reconnect, jangan set Unavailable
            active_tx = db_fetchone(
                "SELECT transaction_id FROM transactions "
                "WHERE charge_point_id=%s AND status='Active' ORDER BY id DESC LIMIT 1",
                (charge_point_id,),
            )
            if active_tx:
                logger.warning(
                    "Charge point %s terputus saat transaksi %s masih Active. Menunggu reconnect...",
                    charge_point_id,
                    active_tx["transaction_id"],
                )
                db_execute(
                    "UPDATE charge_points SET is_online=0, updated_at=NOW() WHERE charge_point_id=%s",
                    (charge_point_id,),
                )
                await broadcast(
                    "update_cp_status",
                    charge_point_id,
                    {"is_online": False, "cp_status": "Charging"},
                )
            else:
                db_execute(
                    "UPDATE charge_points SET is_online=0, cp_status='Unavailable', "
                    "updated_at=NOW() WHERE charge_point_id=%s",
                    (charge_point_id,),
                )
                await broadcast(
                    "update_cp_status",
                    charge_point_id,
                    {"is_online": False, "cp_status": "Unavailable"},
                )
        except Exception as e:
            logger.error(f"Gagal cleanup database untuk {charge_point_id}: {e}")


# ════════════════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════════════════


async def main():
    try:
        conn = get_db()
        conn.close()
        logger.info("Koneksi database MySQL berhasil.")
    except Exception as e:
        logger.error("Gagal koneksi ke database: %s", e)
        return

    server = await websockets.serve(
        on_connect,
        OCPP_HOST,
        OCPP_PORT,
        subprotocols=["ocpp1.6"],  # type: ignore
        ping_interval=None,  # Disable WebSocket ping — charger menggunakan Heartbeat OCPP
    )

    logger.info(
        "ZEUS OCPP Server berjalan di ws://%s:%s — menunggu koneksi...",
        OCPP_HOST,
        OCPP_PORT,
    )
    await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
