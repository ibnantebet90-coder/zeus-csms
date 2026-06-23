"""
ZEUS CSMS — Remote Command Endpoint
Kirim perintah OCPP ke charge point via method dedicated di ChargePoint class:
- Reset (Soft/Hard)
- RemoteStartTransaction
- RemoteStopTransaction
- ChangeAvailability
- UnlockConnector
- GetConfiguration
- ChangeConfiguration
- ClearCache
- TriggerMessage
"""

import logging
from datetime import datetime
from typing import Optional, Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import User, ChargePoint, SendCommand, Transaction

logger = logging.getLogger("zeus.remote")
router = APIRouter(prefix="/api/commands", tags=["Remote Commands"])


# ── Models ────────────────────────────────────────────────────


class CommandRequest(BaseModel):
    command: str
    charge_point_id: str
    connector_id: Optional[int] = None
    transaction_id: Optional[int] = None  # Khusus RemoteStopTransaction
    id_tag: Optional[str] = None
    reset_type: Optional[str] = "Soft"  # Soft | Hard
    availability: Optional[str] = "Operative"  # Operative | Inoperative
    key: Optional[str] = None
    value: Optional[str] = None
    requested_message: Optional[str] = None


class CommandResponse(BaseModel):
    success: bool
    command: str
    charge_point_id: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    log_id: Optional[int] = None


class ActiveTransactionResponse(BaseModel):
    transaction_id: int
    connector_id: int
    id_tag: Optional[str] = None
    customer_name: Optional[str] = None
    start_timestamp: Optional[str] = None
    meter_start: Optional[int] = None


# ── Helper: ambil CP instance dari registry ───────────────────


def _get_cp_instance(charge_point_id: str):
    from ocpp_server._cp_registry import _cp_registry

    return _cp_registry.get(charge_point_id)


# ── Validasi request ──────────────────────────────────────────


def _validate(req: CommandRequest) -> Optional[str]:
    if req.command == "RemoteStartTransaction" and not req.id_tag:
        return "id_tag wajib untuk RemoteStartTransaction"
    if req.command == "RemoteStopTransaction" and not req.transaction_id:
        return "transaction_id wajib untuk RemoteStopTransaction"
    if req.command == "ChangeConfiguration" and (not req.key or req.value is None):
        return "key dan value wajib untuk ChangeConfiguration"
    return None


# ── Log command ke database ───────────────────────────────────


def _log_command(
    db: Session,
    charge_point_id: str,
    command: str,
    payload: dict,
    response: dict,
    status: str,
    user_id: int,
) -> int:
    from app.models.models import ChargePoint as CPModel

    cp_row = (
        db.query(CPModel).filter(CPModel.charge_point_id == charge_point_id).first()
    )
    cp_pk = cp_row.id if cp_row else None
    log = SendCommand(
        charge_point_id=charge_point_id,
        command=command,
        payload=payload,
        response=response,
        status=status,
        sent_by_user_id=user_id,
        sent_at=datetime.utcnow(),
        responded_at=datetime.utcnow(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log.id  # type: ignore


# ── Pemetaan status hasil ─────────────────────────────────────

_ACCEPTED_STATUSES = {"Accepted", "Started", "Scheduled", "Unlocked"}


def _is_accepted(result: dict) -> bool:
    return result.get("status") in _ACCEPTED_STATUSES


# ════════════════════════════════════════════════════════════
#  ACTIVE TRANSACTIONS ENDPOINT
# ════════════════════════════════════════════════════════════


@router.get("/active-transactions", response_model=List[ActiveTransactionResponse])
def get_active_transactions(
    charge_point_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Ambil semua transaksi aktif (status='Active') untuk charge point tertentu.
    Digunakan oleh frontend untuk menampilkan dropdown pilihan transaksi
    pada form RemoteStopTransaction.
    """
    from app.models.models import Customer  # import lokal untuk hindari circular

    # Join ke customers untuk tampilkan nama pelanggan di dropdown
    results = (
        db.query(
            Transaction.ocpp_transaction_id,
            Transaction.connector_id,
            Transaction.id_tag,
            Transaction.start_timestamp,
            Transaction.meter_start,
            Customer.name.label("customer_name"),
        )
        .outerjoin(Customer, Transaction.id_tag == Customer.id_tag_token)
        .filter(
            Transaction.charge_point_id == charge_point_id,
            Transaction.status == "Active",
        )
        .order_by(Transaction.start_timestamp.desc())
        .all()
    )

    return [
        ActiveTransactionResponse(
            transaction_id=row.ocpp_transaction_id,
            connector_id=row.connector_id,
            id_tag=row.id_tag,
            customer_name=row.customer_name,
            start_timestamp=(
                row.start_timestamp.isoformat() if row.start_timestamp else None
            ),
            meter_start=row.meter_start,
        )
        for row in results
    ]


# ════════════════════════════════════════════════════════════
#  MAIN COMMAND ENDPOINT
# ════════════════════════════════════════════════════════════


@router.post("/send", response_model=CommandResponse)
async def send_command(
    req: CommandRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Kirim perintah OCPP ke charge point."""

    # Validasi input
    err = _validate(req)
    if err:
        raise HTTPException(status_code=422, detail=err)

    # Cek CP di database
    cp_record = (
        db.query(ChargePoint)
        .filter(ChargePoint.charge_point_id == req.charge_point_id)
        .first()
    )
    if not cp_record:
        raise HTTPException(status_code=404, detail="Charge point tidak ditemukan")

    if not cp_record.is_online:  # type: ignore
        logger.warning(
            "[%s] CP offline saat command %s dikirim", req.charge_point_id, req.command
        )

    # Ambil CP instance dari registry
    cp = _get_cp_instance(req.charge_point_id)
    if not cp:
        log_id = _log_command(
            db,
            req.charge_point_id,
            req.command,
            req.model_dump(),
            {},
            "Failed",
            current_user.id,  # type: ignore
        )
        return CommandResponse(
            success=False,
            command=req.command,
            charge_point_id=req.charge_point_id,
            error="Charge point tidak terhubung ke server OCPP saat ini",
            log_id=log_id,
        )

    # Dispatch ke method dedicated di ChargePoint
    try:
        result = await _dispatch(cp, req)
        status = "Accepted" if _is_accepted(result) else "Rejected"
        log_id = _log_command(
            db,
            req.charge_point_id,
            req.command,
            req.model_dump(),
            result,
            status,
            current_user.id,  # type: ignore
        )
        return CommandResponse(
            success=(status == "Accepted"),
            command=req.command,
            charge_point_id=req.charge_point_id,
            result=result,
            log_id=log_id,
        )
    except Exception as e:
        logger.error(
            "[%s] Command %s unexpected error: %s", req.charge_point_id, req.command, e
        )
        log_id = _log_command(
            db,
            req.charge_point_id,
            req.command,
            req.model_dump(),
            {},
            "Failed",
            current_user.id,  # type: ignore
        )
        return CommandResponse(
            success=False,
            command=req.command,
            charge_point_id=req.charge_point_id,
            error=str(e),
            log_id=log_id,
        )


async def _dispatch(cp, req: CommandRequest) -> dict:
    """
    Routing ke method dedicated di class ChargePoint.
    Setiap command punya method sendiri dengan logging >> dan << seperti contoh.
    """
    cmd = req.command

    if cmd == "Reset":
        return await cp.cmd_reset(req.reset_type or "Soft")

    elif cmd == "RemoteStartTransaction":
        return await cp.cmd_remote_start(req.id_tag, req.connector_id)

    elif cmd == "RemoteStopTransaction":
        return await cp.cmd_remote_stop(req.transaction_id)

    elif cmd == "ChangeAvailability":
        return await cp.cmd_change_availability(
            req.connector_id or 0, req.availability or "Operative"
        )

    elif cmd == "UnlockConnector":
        return await cp.cmd_unlock_connector(req.connector_id or 1)

    elif cmd == "ClearCache":
        return await cp.cmd_clear_cache()

    elif cmd == "GetConfiguration":
        return await cp.cmd_get_configuration(req.key)

    elif cmd == "ChangeConfiguration":
        return await cp.cmd_change_configuration(req.key, req.value)

    elif cmd == "TriggerMessage":
        return await cp.cmd_trigger_message(
            req.requested_message or "Heartbeat", req.connector_id
        )

    else:
        raise ValueError(f"Command tidak dikenal: {cmd}")


# ════════════════════════════════════════════════════════════
#  LIST COMMAND LOGS
# ════════════════════════════════════════════════════════════


@router.get("/logs")
def get_command_logs(
    charge_point_id: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(SendCommand)
    if charge_point_id:
        q = q.filter(SendCommand.charge_point_id == charge_point_id)
    logs = q.order_by(SendCommand.sent_at.desc()).limit(limit).all()
    return [
        {
            "id": log.id,
            "charge_point_id": log.charge_point_id,
            "command": log.command,
            "payload": log.payload,
            "response": log.response,
            "status": log.status,
            "sent_at": str(log.sent_at),
        }
        for log in logs
    ]
