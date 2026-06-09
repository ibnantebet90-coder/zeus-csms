"""
ZEUS CSMS — Charging Limit Endpoints

GET  /api/charging-limit/config              — baca konfigurasi global
PUT  /api/charging-limit/config              — update limit global (Admin+)
GET  /api/charging-limit/usage/{customer_id} — pemakaian bulan ini 1 customer
GET  /api/charging-limit/usage               — pemakaian semua customer bulan ini

GET  /api/charging-limit/requests            — list request akses sementara
POST /api/charging-limit/requests            — buat request (dari OCPP/internal)
PUT  /api/charging-limit/requests/{id}/approve — approve (Admin+)
PUT  /api/charging-limit/requests/{id}/reject  — reject (Admin+)

GET  /api/charging-limit/check/{id_tag}      — cek apakah id_tag boleh charging
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import (
    ChargeLimitRequest,
    ChargingLimitConfig,
    Customer,
    Transaction,
    User,
)

router = APIRouter(prefix="/api/charging-limit", tags=["Charging Limit"])


# ── Schemas ───────────────────────────────────────────────────


class LimitConfigResponse(BaseModel):
    monthly_limit: int
    is_enabled: bool
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class LimitConfigUpdate(BaseModel):
    monthly_limit: int
    is_enabled: bool


class UsageResponse(BaseModel):
    customer_id: int
    customer_name: str
    id_tag: str
    effective_limit: Optional[int]  # None jika limit dinonaktifkan untuk customer ini
    limit_enabled: bool
    used_this_month: int
    remaining: Optional[int]  # None jika tidak ada limit
    is_over_limit: bool
    has_extra_sessions: int  # sesi tambahan dari approved request
    month: int
    year: int


class LimitCheckResponse(BaseModel):
    id_tag: str
    allowed: bool
    reason: str  # "ok" / "over_limit" / "not_found" / "blocked"
    used_this_month: int
    effective_limit: Optional[int]
    remaining: Optional[int]


class RequestCreate(BaseModel):
    customer_id: int
    id_tag: str
    charge_point_id: Optional[str] = None
    reason: Optional[str] = None


class RequestResponse(BaseModel):
    id: int
    customer_id: int
    customer_name: str
    id_tag: str
    charge_point_id: Optional[str]
    reason: Optional[str]
    status: str
    extra_sessions: int
    requested_at: datetime
    resolved_at: Optional[datetime]

    class Config:
        from_attributes = True


class RequestApprove(BaseModel):
    extra_sessions: int = 1


# ── Helpers ───────────────────────────────────────────────────


def _get_config(db: Session) -> ChargingLimitConfig:
    cfg = db.query(ChargingLimitConfig).filter(ChargingLimitConfig.id == 1).first()
    if not cfg:
        # Auto-create jika belum ada
        cfg = ChargingLimitConfig(id=1, monthly_limit=15, is_enabled=True)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _count_this_month(db: Session, id_tag: str) -> int:
    """Hitung transaksi Completed bulan kalender ini untuk id_tag."""
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    return (
        db.query(func.count(Transaction.id))
        .filter(
            Transaction.id_tag == id_tag,
            Transaction.status == "Completed",
            Transaction.start_timestamp >= month_start,
        )
        .scalar()
        or 0
    )


def _extra_sessions(db: Session, customer_id: int) -> int:
    """Jumlah sesi tambahan dari request Approved bulan ini."""
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    result = (
        db.query(func.coalesce(func.sum(ChargeLimitRequest.extra_sessions), 0))
        .filter(
            ChargeLimitRequest.customer_id == customer_id,
            ChargeLimitRequest.status == "Approved",
            ChargeLimitRequest.resolved_at >= month_start,
        )
        .scalar()
    )
    return int(result or 0)


def _build_usage(
    db: Session, customer: Customer, cfg: ChargingLimitConfig
) -> UsageResponse:
    now = datetime.utcnow()
    used = _count_this_month(db, customer.id_tag_token)
    extra = _extra_sessions(db, customer.id)

    # Limit efektif: override per customer > global
    limit_on = customer.charge_limit_enabled and cfg.is_enabled
    eff_limit = None
    remaining = None
    over = False

    if limit_on:
        raw_limit = (
            customer.monthly_charge_limit
            if customer.monthly_charge_limit is not None
            else cfg.monthly_limit
        )
        eff_limit = raw_limit + extra
        remaining = max(0, eff_limit - used)
        over = used >= eff_limit

    return UsageResponse(
        customer_id=customer.id,
        customer_name=customer.name,
        id_tag=customer.id_tag_token,
        effective_limit=eff_limit,
        limit_enabled=limit_on,
        used_this_month=used,
        remaining=remaining,
        is_over_limit=over,
        has_extra_sessions=extra,
        month=now.month,
        year=now.year,
    )


# ── Config Endpoints ──────────────────────────────────────────


@router.get("/config", response_model=LimitConfigResponse)
def get_config(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return _get_config(db)


@router.put("/config", response_model=LimitConfigResponse)
def update_config(
    body: LimitConfigUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cfg = _get_config(db)
    cfg.monthly_limit = body.monthly_limit
    cfg.is_enabled = body.is_enabled
    db.commit()
    db.refresh(cfg)
    return cfg


# ── Usage Endpoints ───────────────────────────────────────────


@router.get("/usage", response_model=List[UsageResponse])
def list_usage(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Pemakaian semua customer bulan ini — untuk tabel di dashboard."""
    cfg = _get_config(db)
    customers = db.query(Customer).filter(Customer.status != "Invalid").all()
    return [_build_usage(db, c, cfg) for c in customers]


@router.get("/usage/{customer_id}", response_model=UsageResponse)
def get_usage(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    cfg = _get_config(db)
    return _build_usage(db, customer, cfg)


# ── Check Endpoint (dipakai OCPP Authorize) ───────────────────


@router.get("/check/{id_tag}", response_model=LimitCheckResponse)
def check_limit(
    id_tag: str,
    db: Session = Depends(get_db),
):
    """
    Tidak memerlukan auth — dipanggil dari central_system.py.
    Kembalikan: allowed=True/False + alasan.
    """
    customer = db.query(Customer).filter(Customer.customer_id == id_tag).first()
    # Coba cari via id_tag_token
    customer = db.query(Customer).filter(Customer.id_tag_token == id_tag).first()
    if not customer:
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=False,
            reason="not_found",
            used_this_month=0,
            effective_limit=None,
            remaining=None,
        )

    if customer.status == "Blocked":
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=False,
            reason="blocked",
            used_this_month=0,
            effective_limit=None,
            remaining=None,
        )

    cfg = _get_config(db)
    usage = _build_usage(db, customer, cfg)

    if usage.is_over_limit:
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=False,
            reason="over_limit",
            used_this_month=usage.used_this_month,
            effective_limit=usage.effective_limit,
            remaining=0,
        )

    return LimitCheckResponse(
        id_tag=id_tag,
        allowed=True,
        reason="ok",
        used_this_month=usage.used_this_month,
        effective_limit=usage.effective_limit,
        remaining=usage.remaining,
    )


# ── Request Endpoints ─────────────────────────────────────────


@router.get("/requests", response_model=List[RequestResponse])
def list_requests(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(ChargeLimitRequest, Customer.name.label("customer_name")).join(
        Customer, ChargeLimitRequest.customer_id == Customer.id
    )
    if status:
        q = q.filter(ChargeLimitRequest.status == status)
    rows = q.order_by(ChargeLimitRequest.requested_at.desc()).all()

    result = []
    for req, cname in rows:
        result.append(
            RequestResponse(
                id=req.id,
                customer_id=req.customer_id,
                customer_name=cname,
                id_tag=req.id_tag,
                charge_point_id=req.charge_point_id,
                reason=req.reason,
                status=req.status,
                extra_sessions=req.extra_sessions,
                requested_at=req.requested_at,
                resolved_at=req.resolved_at,
            )
        )
    return result


@router.post("/requests", response_model=RequestResponse, status_code=201)
def create_request(
    body: RequestCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == body.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")

    req = ChargeLimitRequest(
        customer_id=body.customer_id,
        id_tag=body.id_tag,
        charge_point_id=body.charge_point_id,
        reason=body.reason,
        status="Pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    return RequestResponse(
        id=req.id,
        customer_id=req.customer_id,
        customer_name=customer.name,
        id_tag=req.id_tag,
        charge_point_id=req.charge_point_id,
        reason=req.reason,
        status=req.status,
        extra_sessions=req.extra_sessions,
        requested_at=req.requested_at,
        resolved_at=req.resolved_at,
    )


@router.put("/requests/{request_id}/approve", response_model=RequestResponse)
def approve_request(
    request_id: int,
    body: RequestApprove,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    req = (
        db.query(ChargeLimitRequest).filter(ChargeLimitRequest.id == request_id).first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request tidak ditemukan")
    if req.status != "Pending":
        raise HTTPException(status_code=400, detail="Request sudah diproses")

    req.status = "Approved"
    req.extra_sessions = body.extra_sessions
    req.approved_by = current_user.id
    req.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(req)

    customer = db.query(Customer).filter(Customer.id == req.customer_id).first()
    return RequestResponse(
        id=req.id,
        customer_id=req.customer_id,
        customer_name=customer.name if customer else "-",
        id_tag=req.id_tag,
        charge_point_id=req.charge_point_id,
        reason=req.reason,
        status=req.status,
        extra_sessions=req.extra_sessions,
        requested_at=req.requested_at,
        resolved_at=req.resolved_at,
    )


@router.put("/requests/{request_id}/reject", response_model=RequestResponse)
def reject_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    req = (
        db.query(ChargeLimitRequest).filter(ChargeLimitRequest.id == request_id).first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request tidak ditemukan")
    if req.status != "Pending":
        raise HTTPException(status_code=400, detail="Request sudah diproses")

    req.status = "Rejected"
    req.approved_by = current_user.id
    req.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(req)

    customer = db.query(Customer).filter(Customer.id == req.customer_id).first()
    return RequestResponse(
        id=req.id,
        customer_id=req.customer_id,
        customer_name=customer.name if customer else "-",
        id_tag=req.id_tag,
        charge_point_id=req.charge_point_id,
        reason=req.reason,
        status=req.status,
        extra_sessions=req.extra_sessions,
        requested_at=req.requested_at,
        resolved_at=req.resolved_at,
    )


# ── Customer Override Endpoints ───────────────────────────────


class CustomerLimitUpdate(BaseModel):
    monthly_charge_limit: Optional[int] = None  # None = ikut global
    charge_limit_enabled: bool = True


@router.put("/customer/{customer_id}", response_model=UsageResponse)
def update_customer_limit(
    customer_id: int,
    body: CustomerLimitUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Set override limit per customer."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")

    customer.monthly_charge_limit = body.monthly_charge_limit
    customer.charge_limit_enabled = body.charge_limit_enabled
    db.commit()
    db.refresh(customer)

    cfg = _get_config(db)
    return _build_usage(db, customer, cfg)
