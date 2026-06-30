"""
ZEUS CSMS — Customer + Charging Limit Endpoints

Customers:
  GET    /api/customers                        — list semua customer
  POST   /api/customers                        — tambah customer baru
  GET    /api/customers/{id}                   — detail satu customer
  PUT    /api/customers/{id}                   — update customer
  DELETE /api/customers/{id}                   — hapus customer
  GET    /api/customers/{id}/transactions      — riwayat transaksi customer
  PUT    /api/customers/{id}/limit             — set override limit per customer

Charging Limit:
  GET  /api/charging-limit/config              — baca konfigurasi global (dari settings)
  PUT  /api/charging-limit/config              — update limit global (Admin+)
  GET  /api/charging-limit/usage              — pemakaian semua customer bulan ini
  GET  /api/charging-limit/usage/{id}         — pemakaian 1 customer
  GET  /api/charging-limit/check/{id_tag}     — cek apakah id_tag boleh charging

  GET  /api/charging-limit/requests            — list request akses sementara
  POST /api/charging-limit/requests            — buat request
  PUT  /api/charging-limit/requests/{id}/approve
  PUT  /api/charging-limit/requests/{id}/reject
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import (
    ChargeLimitRequest,
    Customer,
    IdTag,
    Setting,
    Transaction,
    User,
)
from app.schemas.schemas import (
    CustomerCreate,
    CustomerResponse,
    CustomerUpdate,
    IdTagCreate,
    IdTagResponse,
    IdTagUpdate,
    TransactionResponse,
)

router = APIRouter(tags=["Customers & Charging Limit"])


# ════════════════════════════════════════════════════════════
#  SCHEMAS (lokal — tidak perlu masuk schemas.py global)
# ════════════════════════════════════════════════════════════


class LimitConfigResponse(BaseModel):
    monthly_limit: int
    is_enabled: bool
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LimitConfigUpdate(BaseModel):
    monthly_limit: int
    is_enabled: bool


class UsageResponse(BaseModel):
    customer_id: int
    customer_name: str
    id_tag: Optional[str]
    effective_limit: Optional[int]
    limit_enabled: bool
    used_this_month: int
    remaining: Optional[int]
    is_over_limit: bool
    has_extra_sessions: int
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
    id_tag: Optional[str]
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


class CustomerLimitUpdate(BaseModel):
    monthly_charge_limit: Optional[int] = None  # None = ikut global
    charge_limit_enabled: bool = True


# ════════════════════════════════════════════════════════════
#  HELPERS
# ════════════════════════════════════════════════════════════


def _get_global_config(db: Session) -> dict:
    """
    Baca konfigurasi limit dari tabel settings (v0.5).
    Return dict: {monthly_limit, is_enabled, updated_at}
    """
    row_limit = (
        db.query(Setting).filter(Setting.key_name == "monthly_charge_limit").first()
    )
    row_enabled = (
        db.query(Setting).filter(Setting.key_name == "charge_limit_enabled").first()
    )

    # Auto-seed jika belum ada
    if not row_limit:
        row_limit = Setting(
            key_name="monthly_charge_limit",
            value="15",
            description="Batas sesi pengisian per bulan (global)",
        )
        db.add(row_limit)
        db.commit()
        db.refresh(row_limit)
    if not row_enabled:
        row_enabled = Setting(
            key_name="charge_limit_enabled",
            value="1",
            description="1 = limit aktif, 0 = limit dinonaktifkan",
        )
        db.add(row_enabled)
        db.commit()
        db.refresh(row_enabled)

    return {
        "monthly_limit": int(row_limit.value),
        "is_enabled": bool(int(row_enabled.value)),
        "updated_at": row_limit.updated_at,
    }


def _set_global_config(db: Session, monthly_limit: int, is_enabled: bool):
    """Update konfigurasi limit ke tabel settings."""
    for key, val in [
        ("monthly_charge_limit", str(monthly_limit)),
        ("charge_limit_enabled", str(int(is_enabled))),
    ]:
        row = db.query(Setting).filter(Setting.key_name == key).first()
        if row:
            row.value = val
        else:
            db.add(Setting(key_name=key, value=val))
    db.commit()


def _get_customer_id_tag(db: Session, customer: Customer) -> Optional[str]:
    """Ambil id_tag aktif dari tabel id_tags untuk customer ini."""
    tag = (
        db.query(IdTag)
        .filter(IdTag.customer_id == customer.id, IdTag.status == "Accepted")
        .first()
    )
    return tag.id_tag if tag else None


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


def _build_usage(db: Session, customer: Customer, cfg: dict) -> UsageResponse:
    now = datetime.utcnow()
    id_tag = _get_customer_id_tag(db, customer)
    used = _count_this_month(db, id_tag) if id_tag else 0
    extra = _extra_sessions(db, customer.id)

    limit_on = customer.charge_limit_enabled and cfg["is_enabled"]
    eff_limit = None
    remaining = None
    over = False

    if limit_on:
        raw_limit = (
            customer.monthly_charge_limit
            if customer.monthly_charge_limit is not None
            else cfg["monthly_limit"]
        )
        eff_limit = raw_limit + extra
        remaining = max(0, eff_limit - used)
        over = used >= eff_limit

    return UsageResponse(
        customer_id=customer.id,
        customer_name=customer.name,
        id_tag=id_tag,
        effective_limit=eff_limit,
        limit_enabled=limit_on,
        used_this_month=used,
        remaining=remaining,
        is_over_limit=over,
        has_extra_sessions=extra,
        month=now.month,
        year=now.year,
    )


# ════════════════════════════════════════════════════════════
#  CUSTOMER ENDPOINTS
# ════════════════════════════════════════════════════════════

customer_router = APIRouter(prefix="/api/customers", tags=["Customers"])


@customer_router.get("", response_model=List[CustomerResponse])
def list_customers(
    search: Optional[str] = Query(None, description="Cari by nama, email, atau id tag"),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Customer).options(joinedload(Customer.id_tags))
    if search:
        q = q.outerjoin(IdTag).filter(
            Customer.name.ilike(f"%{search}%")
            | Customer.email.ilike(f"%{search}%")
            | IdTag.id_tag.ilike(f"%{search}%")
        )
    return q.order_by(Customer.name).distinct().offset(offset).limit(limit).all()


@customer_router.post("", response_model=CustomerResponse, status_code=201)
def create_customer(
    body: CustomerCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if db.query(Customer).filter(Customer.email == body.email).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email sudah terdaftar",
        )

    id_tag_value = body.id_tag
    if id_tag_value:
        if db.query(IdTag).filter(IdTag.id_tag == id_tag_value).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"ID Tag '{id_tag_value}' sudah digunakan",
            )

    payload = body.model_dump(exclude={"id_tag"})
    customer = Customer(**payload)
    db.add(customer)
    db.commit()
    db.refresh(customer)

    if id_tag_value:
        tag = IdTag(id_tag=id_tag_value, customer_id=customer.id, status="Accepted")
        db.add(tag)
        db.commit()
        db.refresh(customer)

    return customer


@customer_router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.id_tags))
        .filter(Customer.id == customer_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    return customer


@customer_router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


@customer_router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    db.delete(customer)
    db.commit()


@customer_router.get(
    "/{customer_id}/transactions", response_model=List[TransactionResponse]
)
def customer_transactions(
    customer_id: int,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(Transaction)
        .filter(Transaction.customer_id == customer_id)
        .order_by(Transaction.start_timestamp.desc())
        .limit(limit)
        .all()
    )


@customer_router.put("/{customer_id}/limit", response_model=UsageResponse)
def update_customer_limit(
    customer_id: int,
    body: CustomerLimitUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Set override limit pengisian per customer."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    customer.monthly_charge_limit = body.monthly_charge_limit
    customer.charge_limit_enabled = body.charge_limit_enabled
    db.commit()
    db.refresh(customer)
    cfg = _get_global_config(db)
    return _build_usage(db, customer, cfg)


# ════════════════════════════════════════════════════════════
#  CHARGING LIMIT ENDPOINTS
# ════════════════════════════════════════════════════════════

limit_router = APIRouter(prefix="/api/charging-limit", tags=["Charging Limit"])


# ── Config ────────────────────────────────────────────────────


@limit_router.get("/config", response_model=LimitConfigResponse)
def get_config(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return LimitConfigResponse(**_get_global_config(db))


@limit_router.put("/config", response_model=LimitConfigResponse)
def update_config(
    body: LimitConfigUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    _set_global_config(db, body.monthly_limit, body.is_enabled)
    return LimitConfigResponse(**_get_global_config(db))


# ── Usage ─────────────────────────────────────────────────────


@limit_router.get("/usage", response_model=List[UsageResponse])
def list_usage(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cfg = _get_global_config(db)
    customers = db.query(Customer).all()
    return [_build_usage(db, c, cfg) for c in customers]


@limit_router.get("/usage/{customer_id}", response_model=UsageResponse)
def get_usage(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    cfg = _get_global_config(db)
    return _build_usage(db, customer, cfg)


# ── Check (tanpa auth — dipanggil OCPP Authorize) ─────────────


@limit_router.get("/check/{id_tag}", response_model=LimitCheckResponse)
def check_limit(
    id_tag: str,
    db: Session = Depends(get_db),
):
    tag = db.query(IdTag).filter(IdTag.id_tag == id_tag).first()
    if not tag:
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=False,
            reason="not_found",
            used_this_month=0,
            effective_limit=None,
            remaining=None,
        )

    if tag.status == "Blocked":
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=False,
            reason="blocked",
            used_this_month=0,
            effective_limit=None,
            remaining=None,
        )

    if not tag.customer_id:
        # Tag valid tapi tidak punya akun customer — izinkan tanpa limit check
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=True,
            reason="ok",
            used_this_month=0,
            effective_limit=None,
            remaining=None,
        )

    customer = db.query(Customer).filter(Customer.id == tag.customer_id).first()
    if not customer:
        return LimitCheckResponse(
            id_tag=id_tag,
            allowed=False,
            reason="not_found",
            used_this_month=0,
            effective_limit=None,
            remaining=None,
        )

    cfg = _get_global_config(db)
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


# ── Requests ──────────────────────────────────────────────────


@limit_router.get("/requests", response_model=List[RequestResponse])
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

    return [
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
        for req, cname in rows
    ]


@limit_router.post("/requests", response_model=RequestResponse, status_code=201)
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


@limit_router.put("/requests/{request_id}/approve", response_model=RequestResponse)
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
    req.resolved_by_user_id = current_user.id
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


@limit_router.put("/requests/{request_id}/reject", response_model=RequestResponse)
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
    req.resolved_by_user_id = current_user.id
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


# ════════════════════════════════════════════════════════════
#  ID TAG ENDPOINTS  (RFID — relasi 1 customer → N id_tag)
# ════════════════════════════════════════════════════════════


@customer_router.get("/{customer_id}/id-tags", response_model=List[IdTagResponse])
def list_customer_id_tags(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    return (
        db.query(IdTag)
        .filter(IdTag.customer_id == customer_id)
        .order_by(IdTag.created_at.desc())
        .all()
    )


@customer_router.post(
    "/{customer_id}/id-tags", response_model=IdTagResponse, status_code=201
)
def create_customer_id_tag(
    customer_id: int,
    body: IdTagCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    if db.query(IdTag).filter(IdTag.id_tag == body.id_tag).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"ID Tag '{body.id_tag}' sudah digunakan",
        )
    tag = IdTag(
        id_tag=body.id_tag,
        customer_id=customer_id,
        expiry_date=body.expiry_date,
        status=body.status,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


id_tag_router = APIRouter(prefix="/api/id-tags", tags=["ID Tags"])


@id_tag_router.put("/{id_tag_pk}", response_model=IdTagResponse)
def update_id_tag(
    id_tag_pk: int,
    body: IdTagUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = db.query(IdTag).filter(IdTag.id == id_tag_pk).first()
    if not tag:
        raise HTTPException(status_code=404, detail="ID Tag tidak ditemukan")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tag, field, value)
    db.commit()
    db.refresh(tag)
    return tag


@id_tag_router.delete("/{id_tag_pk}", status_code=204)
def delete_id_tag(
    id_tag_pk: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = db.query(IdTag).filter(IdTag.id == id_tag_pk).first()
    if not tag:
        raise HTTPException(status_code=404, detail="ID Tag tidak ditemukan")
    db.delete(tag)
    db.commit()


# ── Ekspor router ───────────────────────────────────────────
router = customer_router  # backward compat jika main.py import `router`
