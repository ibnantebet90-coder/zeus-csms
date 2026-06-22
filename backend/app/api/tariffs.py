"""
ZEUS CSMS — Tariffs Endpoint
GET    /api/tariffs                — list semua tarif
POST   /api/tariffs                — tambah tarif baru
DELETE /api/tariffs/{id}           — hapus tarif
PUT    /api/tariffs/{id}/activate  — set tarif aktif
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import ChargePoint, Tariff, User
from app.schemas.schemas import TariffCreate, TariffResponse

router = APIRouter(prefix="/api/tariffs", tags=["Tariffs"])


@router.get("", response_model=List[TariffResponse])
def list_tariffs(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(Tariff).order_by(Tariff.created_at.desc()).all()


@router.post("", response_model=TariffResponse, status_code=201)
def create_tariff(
    body: TariffCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    # [v0.5] Lookup charge_point_pk dari charge_point_id string
    cp = (
        db.query(ChargePoint)
        .filter(ChargePoint.charge_point_id == body.charge_point_id)
        .first()
    )
    if not cp:
        raise HTTPException(status_code=404, detail="Charge point tidak ditemukan")

    # Nonaktifkan tarif lama untuk CP yang sama
    db.query(Tariff).filter(
        Tariff.charge_point_pk == cp.id,
        Tariff.is_active == True,
    ).update({"is_active": False})

    tariff = Tariff(
        charge_point_pk=cp.id,
        charge_point_id=body.charge_point_id,
        cost_per_kwh=body.cost_per_kwh,
        currency=body.currency,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        is_active=True,
    )
    db.add(tariff)
    db.commit()
    db.refresh(tariff)
    return tariff


@router.put("/{tariff_id}/activate", response_model=TariffResponse)
def activate_tariff(
    tariff_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tariff = db.query(Tariff).filter(Tariff.id == tariff_id).first()
    if not tariff:
        raise HTTPException(status_code=404, detail="Tarif tidak ditemukan")

    # Nonaktifkan tarif lain untuk CP yang sama
    db.query(Tariff).filter(
        Tariff.charge_point_pk == tariff.charge_point_pk,
        Tariff.is_active == True,
    ).update({"is_active": False})

    tariff.is_active = True
    db.commit()
    db.refresh(tariff)
    return tariff


@router.delete("/{tariff_id}", status_code=204)
def delete_tariff(
    tariff_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tariff = db.query(Tariff).filter(Tariff.id == tariff_id).first()
    if not tariff:
        raise HTTPException(status_code=404, detail="Tarif tidak ditemukan")
    db.delete(tariff)
    db.commit()
