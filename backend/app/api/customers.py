"""
ZEUS CSMS — Customer Endpoints
GET    /api/customers          — list semua customer
POST   /api/customers          — tambah customer baru
GET    /api/customers/{id}     — detail satu customer
PUT    /api/customers/{id}     — update customer
DELETE /api/customers/{id}     — hapus customer
GET    /api/customers/{id}/transactions — riwayat transaksi customer
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import Customer, Transaction, User
from app.schemas.schemas import (
    CustomerCreate,
    CustomerResponse,
    CustomerUpdate,
    TransactionResponse,
)

router = APIRouter(prefix="/api/customers", tags=["Customers"])


@router.get("", response_model=List[CustomerResponse])
def list_customers(
    search: Optional[str] = Query(None, description="Cari by nama atau email"),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Customer)
    if search:
        q = q.filter(
            Customer.name.ilike(f"%{search}%") | Customer.email.ilike(f"%{search}%")
        )
    if status:
        q = q.filter(Customer.status == status)
    return q.order_by(Customer.name).offset(offset).limit(limit).all()


@router.post("", response_model=CustomerResponse, status_code=201)
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
    if db.query(Customer).filter(Customer.id_tag_token == body.id_tag_token).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="id_tag_token sudah digunakan",
        )
    customer = Customer(**body.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    return customer


@router.put("/{customer_id}", response_model=CustomerResponse)
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


@router.delete("/{customer_id}", status_code=204)
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


@router.get("/{customer_id}/transactions", response_model=List[TransactionResponse])
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
