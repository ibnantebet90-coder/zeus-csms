"""
ZEUS CSMS — Charge Point Endpoints
GET    /api/charge-points          — list semua charge point
POST   /api/charge-points          — tambah charge point baru
GET    /api/charge-points/{cp_id}  — detail satu charge point
PUT    /api/charge-points/{cp_id}  — update data charge point
DELETE /api/charge-points/{cp_id}  — hapus charge point
GET    /api/charge-points/{cp_id}/connectors  — list konektor
GET    /api/charge-points/{cp_id}/alerts      — list alert
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import Alert, ChargePoint, Connector, User
from app.schemas.schemas import (
    AlertResponse,
    ChargePointCreate,
    ChargePointResponse,
    ChargePointUpdate,
    ConnectorOut,
)

router = APIRouter(prefix="/api/charge-points", tags=["Charge Points"])


@router.get("", response_model=List[ChargePointResponse])
def list_charge_points(
    status: Optional[str] = Query(None, description="Filter by cp_status"),
    online: Optional[bool] = Query(None, description="Filter by is_online"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(ChargePoint)
    if status:
        q = q.filter(ChargePoint.cp_status == status)
    if online is not None:
        q = q.filter(ChargePoint.is_online == online)
    return q.order_by(ChargePoint.name).all()


@router.post("", response_model=ChargePointResponse, status_code=201)
def create_charge_point(
    body: ChargePointCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if (
        db.query(ChargePoint)
        .filter(ChargePoint.charge_point_id == body.charge_point_id)
        .first()
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="charge_point_id sudah terdaftar",
        )
    cp = ChargePoint(**body.model_dump())
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return cp


@router.get("/{cp_id}", response_model=ChargePointResponse)
def get_charge_point(
    cp_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cp = db.query(ChargePoint).filter(ChargePoint.charge_point_id == cp_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Charge point tidak ditemukan")
    return cp


@router.put("/{cp_id}", response_model=ChargePointResponse)
def update_charge_point(
    cp_id: str,
    body: ChargePointUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cp = db.query(ChargePoint).filter(ChargePoint.charge_point_id == cp_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Charge point tidak ditemukan")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cp, field, value)
    db.commit()
    db.refresh(cp)
    return cp


@router.delete("/{cp_id}", status_code=204)
def delete_charge_point(
    cp_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    cp = db.query(ChargePoint).filter(ChargePoint.charge_point_id == cp_id).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Charge point tidak ditemukan")
    db.delete(cp)
    db.commit()


@router.get("/{cp_id}/connectors", response_model=List[ConnectorOut])
def list_connectors(
    cp_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(Connector)
        .filter(Connector.charge_point_id == cp_id)
        .order_by(Connector.connector_id)
        .all()
    )


@router.get("/{cp_id}/alerts", response_model=List[AlertResponse])
def list_alerts(
    cp_id: str,
    resolved: Optional[bool] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Alert).filter(Alert.charge_point_id == cp_id)
    if resolved is not None:
        q = q.filter(Alert.is_resolved == resolved)
    return q.order_by(Alert.timestamp.desc()).limit(limit).all()
