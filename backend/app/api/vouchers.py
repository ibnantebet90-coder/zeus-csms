"""
ZEUS CSMS — Voucher API
Endpoint untuk validasi dan aplikasi voucher ke transaksi
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.api.deps import get_current_user
from app.core.billing_calculator import calculate_billing

router = APIRouter(prefix="/api/vouchers", tags=["Vouchers"])


class VoucherApplyRequest(BaseModel):
    transaction_id: int  # tx_pk (bukan ocpp_transaction_id)
    voucher_code: str


class VoucherCreate(BaseModel):
    code: str
    description: Optional[str] = None
    discount_type: str  # 'percent' atau 'fixed'
    discount_value: float
    applies_to: str = "subtotal"
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    max_usage: Optional[int] = None
    is_active: bool = True


# ── Validasi voucher tanpa apply ──────────────────────────
@router.get("/validate/{code}")
def validate_voucher(
    code: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    voucher = (
        db.execute(text("SELECT * FROM vouchers WHERE code = :code"), {"code": code})
        .mappings()
        .first()
    )

    if not voucher:
        raise HTTPException(404, "Voucher tidak ditemukan")
    if not voucher["is_active"]:
        raise HTTPException(400, "Voucher tidak aktif")
    if voucher["valid_from"] and datetime.now() < voucher["valid_from"]:
        raise HTTPException(400, "Voucher belum berlaku")
    if voucher["valid_until"] and datetime.now() > voucher["valid_until"]:
        raise HTTPException(400, "Voucher sudah kadaluarsa")
    if voucher["max_usage"] and voucher["used_count"] >= voucher["max_usage"]:
        raise HTTPException(400, "Voucher sudah mencapai batas penggunaan")

    return {
        "code": voucher["code"],
        "description": voucher["description"],
        "discount_type": voucher["discount_type"],
        "discount_value": float(voucher["discount_value"]),
        "applies_to": voucher["applies_to"],
        "valid_until": voucher["valid_until"],
        "is_valid": True,
    }


# ── Apply voucher ke transaksi yang sudah Completed ───────
@router.post("/apply")
def apply_voucher(
    req: VoucherApplyRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Ambil transaksi
    tx = (
        db.execute(
            text("""SELECT t.*, tr.pbjt_rate as t_pbjt_rate,
                       tr.service_fee_per_kwh as t_svc_fee,
                       tr.ppn_rate as t_ppn_rate
                FROM transactions t
                LEFT JOIN tariffs tr
                    ON tr.charge_point_pk = t.charge_point_pk
                    AND tr.is_active = 1
                WHERE t.id = :id"""),
            {"id": req.transaction_id},
        )
        .mappings()
        .first()
    )

    if not tx:
        raise HTTPException(404, "Transaksi tidak ditemukan")
    if tx["status"] != "Completed":
        raise HTTPException(
            400, "Voucher hanya bisa diapply ke transaksi yang sudah selesai"
        )
    if tx["voucher_code"]:
        raise HTTPException(
            400, f"Transaksi sudah menggunakan voucher: {tx['voucher_code']}"
        )

    # Validasi voucher
    voucher = (
        db.execute(
            text("SELECT * FROM vouchers WHERE code = :code"),
            {"code": req.voucher_code},
        )
        .mappings()
        .first()
    )

    if not voucher:
        raise HTTPException(404, "Voucher tidak ditemukan")
    if not voucher["is_active"]:
        raise HTTPException(400, "Voucher tidak aktif")
    if voucher["valid_from"] and datetime.now() < voucher["valid_from"]:
        raise HTTPException(400, "Voucher belum berlaku")
    if voucher["valid_until"] and datetime.now() > voucher["valid_until"]:
        raise HTTPException(400, "Voucher sudah kadaluarsa")
    if voucher["max_usage"] and voucher["used_count"] >= voucher["max_usage"]:
        raise HTTPException(400, "Voucher sudah mencapai batas penggunaan")

    # Hitung ulang billing dengan voucher
    energy_kwh = float(tx["energy_consumed_kwh"] or 0)
    tariff_per_kwh = float(tx["tariff_per_kwh"] or tx.get("cost_per_kwh") or 0)
    pbjt_rate = float(tx["pbjt_rate"] or tx["t_pbjt_rate"] or 0.03)
    svc_fee_per_kwh = float(tx["service_fee_per_kwh"] or tx["t_svc_fee"] or 0)
    ppn_rate = float(tx["ppn_rate"] or tx["t_ppn_rate"] or 0.11)

    billing = calculate_billing(
        energy_kwh=energy_kwh,
        tariff_per_kwh=tariff_per_kwh,
        pbjt_rate=pbjt_rate,
        service_fee_per_kwh=svc_fee_per_kwh,
        ppn_rate=ppn_rate,
        pricing_scheme=tx["pricing_scheme"] or "commercial",
        voucher_code=req.voucher_code,
        discount_type=voucher["discount_type"],
        discount_value=float(voucher["discount_value"]),
    )

    # Update transaksi
    db.execute(
        text("""
        UPDATE transactions SET
            voucher_code    = :voucher_code,
            discount_type   = :discount_type,
            discount_value  = :discount_value,
            discount_amount = :discount_amount,
            ppn_base        = :ppn_base,
            ppn_amount      = :ppn_amount,
            total_amount    = :total_amount,
            total_cost      = :total_amount
        WHERE id = :id
    """),
        {
            "voucher_code": req.voucher_code,
            "discount_type": voucher["discount_type"],
            "discount_value": float(voucher["discount_value"]),
            "discount_amount": float(billing.discount_amount),
            "ppn_base": float(billing.ppn_base),
            "ppn_amount": float(billing.ppn_amount),
            "total_amount": float(billing.total_amount),
            "id": req.transaction_id,
        },
    )

    # Increment used_count voucher
    db.execute(
        text("""
        UPDATE vouchers SET used_count = used_count + 1 WHERE code = :code
    """),
        {"code": req.voucher_code},
    )

    db.commit()

    return {
        "message": "Voucher berhasil diapply",
        "transaction_id": req.transaction_id,
        "voucher_code": req.voucher_code,
        "discount_amount": float(billing.discount_amount),
        "ppn_amount": float(billing.ppn_amount),
        "total_amount": float(billing.total_amount),
    }


# ── CRUD Voucher (admin) ───────────────────────────────────
@router.get("")
def list_vouchers(
    db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    rows = (
        db.execute(text("SELECT * FROM vouchers ORDER BY created_at DESC"))
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


@router.post("", status_code=201)
def create_voucher(
    data: VoucherCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    existing = db.execute(
        text("SELECT id FROM vouchers WHERE code = :code"), {"code": data.code}
    ).first()
    if existing:
        raise HTTPException(400, "Kode voucher sudah ada")

    db.execute(
        text("""
        INSERT INTO vouchers
            (code, description, discount_type, discount_value,
            applies_to, valid_from, valid_until, max_usage, is_active)
        VALUES
            (:code, :description, :discount_type, :discount_value,
            :applies_to, :valid_from, :valid_until, :max_usage, :is_active)
    """),
        data.model_dump(),
    )
    db.commit()
    return {"message": "Voucher berhasil dibuat", "code": data.code}


@router.delete("/{code}", status_code=204)
def delete_voucher(
    code: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    db.execute(
        text("UPDATE vouchers SET is_active = 0 WHERE code = :code"), {"code": code}
    )
    db.commit()
