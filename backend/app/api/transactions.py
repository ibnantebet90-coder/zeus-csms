"""
ZEUS CSMS — Transaction & Dashboard Endpoints
GET /api/transactions          — list transaksi dengan filter
GET /api/transactions/{id}     — detail transaksi
GET /api/dashboard/summary     — ringkasan statistik dashboard
"""

from datetime import datetime, date
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import ChargePoint, Transaction, User
from app.schemas.schemas import DashboardSummary, TransactionResponse

router = APIRouter(tags=["Transactions & Dashboard"])


# ── Transactions ─────────────────────────────────────────────

@router.get("/api/transactions", response_model=List[TransactionResponse])
def list_transactions(
    charge_point_id: Optional[str] = Query(None),
    status: Optional[str]          = Query(None),
    date_from: Optional[date]      = Query(None),
    date_to: Optional[date]        = Query(None),
    limit: int                     = Query(50, le=500),
    offset: int                    = Query(0),
    db: Session                    = Depends(get_db),
    _: User                        = Depends(get_current_user),
):
    q = db.query(Transaction)
    if charge_point_id:
        q = q.filter(Transaction.charge_point_id == charge_point_id)
    if status:
        q = q.filter(Transaction.status == status)
    if date_from:
        q = q.filter(Transaction.start_timestamp >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Transaction.start_timestamp <= datetime.combine(date_to, datetime.max.time()))
    return q.order_by(Transaction.start_timestamp.desc()).offset(offset).limit(limit).all()


@router.get("/api/transactions/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    _: User     = Depends(get_current_user),
):
    tx = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not tx:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    return tx


# ── Dashboard Summary ────────────────────────────────────────

@router.get("/api/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(
    db: Session = Depends(get_db),
    _: User     = Depends(get_current_user),
):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    total_cp  = db.query(func.count(ChargePoint.id)).scalar() or 0
    online_cp = db.query(func.count(ChargePoint.id)).filter(
        ChargePoint.is_online == True
    ).scalar() or 0

    active_tx = db.query(func.count(Transaction.id)).filter(
        Transaction.status == "Active"
    ).scalar() or 0

    today_tx = db.query(func.count(Transaction.id)).filter(
        Transaction.start_timestamp >= today_start
    ).scalar() or 0

    today_energy = db.query(
        func.coalesce(func.sum(Transaction.energy_consumed_kwh), 0)
    ).filter(
        Transaction.start_timestamp >= today_start,
        Transaction.status == "Completed",
    ).scalar() or 0

    today_revenue = db.query(
        func.coalesce(func.sum(Transaction.total_cost), 0)
    ).filter(
        Transaction.start_timestamp >= today_start,
        Transaction.status == "Completed",
    ).scalar() or 0

    return DashboardSummary(
        total_charge_points=total_cp,
        online_charge_points=online_cp,
        active_transactions=active_tx,
        total_transactions_today=today_tx,
        total_energy_today_kwh=float(today_energy),
        total_revenue_today=float(today_revenue),
    )
