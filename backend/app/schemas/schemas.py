"""
ZEUS CSMS — Pydantic Schemas  (v0.5)
Validasi request & response untuk semua endpoint.

Perubahan dari v0.4:
- CustomerCreate: hapus id_tag_token, expiry_date_time; tambah charge_limit_enabled, monthly_charge_limit
- CustomerUpdate: hapus status (pindah ke id_tags)
- CustomerResponse: hapus id_tag_token, status; tambah charge_limit_enabled, monthly_charge_limit
- ChargePointCreate/Update/Response: hapus tariff_per_kwh
- TransactionResponse: rename transaction_id → ocpp_transaction_id; tambah auto_completed
- ConnectorOut: rename timestamp → last_status_at
- TariffCreate/Response: charge_point_id tetap ada (denormalized field)

Tambahan pasca v0.5 (sinkronisasi frontend Customers):
- IdTagCreate/Update/Response: schema baru untuk CRUD id_tags (relasi
  1 customer → N id_tag). Frontend lama sempat mengasumsikan id_tag_token
  dan status sebagai field langsung Customer — itu sudah tidak berlaku
  sejak v0.5, id_tag_token/status sepenuhnya pindah ke tabel id_tags.
- CustomerCreate: tambah field opsional id_tag (RFID pertama saat
  membuat customer baru, dibuat sekaligus dalam 1 request).
- CustomerResponse: tambah field id_tags (daftar semua id_tag milik
  customer ini) supaya frontend tidak perlu request terpisah per baris.
"""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr

# ════════════════════════════════════════════════════════════
#  AUTH
# ════════════════════════════════════════════════════════════


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str


# ════════════════════════════════════════════════════════════
#  USER
# ════════════════════════════════════════════════════════════


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "Guest"


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  ID TAG  (RFID — relasi 1 customer → N id_tag)
# ════════════════════════════════════════════════════════════


class IdTagCreate(BaseModel):
    id_tag: str
    expiry_date: Optional[datetime] = None
    status: str = "Accepted"  # Accepted/Blocked/Expired/Invalid/ConcurrentTx


class IdTagUpdate(BaseModel):
    expiry_date: Optional[datetime] = None
    status: Optional[str] = None


class IdTagResponse(BaseModel):
    id: int
    id_tag: str
    customer_id: Optional[int]
    expiry_date: Optional[datetime]
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  CUSTOMER
# ════════════════════════════════════════════════════════════


class CustomerCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    car_brand: Optional[str] = None
    car_model: Optional[str] = None
    car_type: str = "private"
    charge_limit_enabled: bool = True
    monthly_charge_limit: Optional[int] = None
    id_tag: Optional[str] = None  # RFID pertama, dibuat sekaligus jika diisi


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    car_brand: Optional[str] = None
    car_model: Optional[str] = None
    charge_limit_enabled: Optional[bool] = None
    monthly_charge_limit: Optional[int] = None


class CustomerResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str]
    car_brand: Optional[str]
    car_model: Optional[str]
    car_type: str
    charge_limit_enabled: bool
    monthly_charge_limit: Optional[int]
    created_at: datetime
    id_tags: List[IdTagResponse] = []

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  CHARGE POINT
# ════════════════════════════════════════════════════════════


class ChargePointCreate(BaseModel):
    charge_point_id: str
    name: str
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    number_of_connectors: int = 1


class ChargePointUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ConnectorOut(BaseModel):
    connector_id: int
    status: str
    error_code: Optional[str]
    last_status_at: Optional[datetime]

    class Config:
        from_attributes = True


class ChargePointResponse(BaseModel):
    id: int
    charge_point_id: str
    name: str
    address: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    number_of_connectors: int
    cp_status: str
    is_online: bool
    last_heartbeat: Optional[datetime]
    vendor_name: Optional[str]
    model: Optional[str]
    serial_number: Optional[str]
    connectors: List[ConnectorOut] = []

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  TRANSACTION
# ════════════════════════════════════════════════════════════


class TransactionResponse(BaseModel):
    id: int
    ocpp_transaction_id: int
    charge_point_id: str
    connector_id: int
    id_tag: Optional[str]
    start_timestamp: Optional[datetime]
    stop_timestamp: Optional[datetime]
    meter_start: Optional[int]
    meter_stop: Optional[int]
    energy_consumed_kwh: Optional[float]
    tariff_per_kwh: Optional[float]
    total_cost: Optional[float]
    stop_reason: Optional[str]
    status: str
    auto_completed: bool

    # [Billing v0.5]
    pricing_scheme: Optional[str] = None
    energy_cost: Optional[float] = None
    pbjt_rate: Optional[float] = None
    pbjt_amount: Optional[float] = None
    service_fee_per_kwh: Optional[float] = None
    service_fee_amount: Optional[float] = None
    subtotal: Optional[float] = None
    ppn_rate: Optional[float] = None
    ppn_base: Optional[float] = None
    ppn_amount: Optional[float] = None
    total_amount: Optional[float] = None
    voucher_code: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    discount_amount: Optional[float] = None

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  METER VALUES (Monitoring Realtime)
# ════════════════════════════════════════════════════════════


class MeterValueResponse(BaseModel):
    id: int
    transaction_pk: Optional[int]
    ocpp_transaction_id: Optional[int]
    charge_point_id: str
    connector_id: int
    timestamp: datetime
    measurand: str
    value: Optional[float]
    unit: Optional[str]
    context: Optional[str]
    format: Optional[str]
    phase: Optional[str]
    location: Optional[str]

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  ALERT
# ════════════════════════════════════════════════════════════


class AlertResponse(BaseModel):
    id: int
    charge_point_id: str
    connector_id: Optional[int]
    timestamp: datetime
    status: str
    error_code: Optional[str]
    info: Optional[str]
    is_resolved: bool

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  TARIFF
# ════════════════════════════════════════════════════════════


class TariffCreate(BaseModel):
    charge_point_id: str
    cost_per_kwh: float
    currency: str = "IDR"
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None


class TariffResponse(BaseModel):
    id: int
    charge_point_id: str
    cost_per_kwh: float
    currency: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ════════════════════════════════════════════════════════════
#  DASHBOARD SUMMARY
# ════════════════════════════════════════════════════════════


class DashboardSummary(BaseModel):
    total_charge_points: int
    online_charge_points: int
    active_transactions: int
    total_transactions_today: int
    total_energy_today_kwh: float
    total_revenue_today: float


# ════════════════════════════════════════════════════════════
#  REPORT
# ════════════════════════════════════════════════════════════


class ReportDaily(BaseModel):
    report_date: str
    charge_point_id: str
    charge_point_name: str
    total_transactions: int
    total_energy_kwh: float
    total_revenue: float

    class Config:
        from_attributes = True


class ReportMonthly(BaseModel):
    year: int
    month: int
    month_name: str
    charge_point_id: str
    charge_point_name: str
    total_transactions: int
    total_energy_kwh: float
    total_revenue: float
    avg_energy_kwh: float

    class Config:
        from_attributes = True


class ReportSummary(BaseModel):
    date_from: str
    date_to: str
    total_transactions: int
    total_energy_kwh: float
    total_revenue: float
    avg_energy_per_tx_kwh: float
    avg_cost_per_tx: float
    active_charge_points: int

    class Config:
        from_attributes = True
