"""
ZEUS CSMS — SQLAlchemy Models
Mapping semua tabel database ke Python class.
"""

from datetime import datetime
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Boolean,
    JSON,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum("SuperAdmin", "Admin", "Guest"), default="Guest")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False)
    email = Column(String(128), unique=True, nullable=False)
    phone = Column(String(32))
    car_brand = Column(String(64))
    car_model = Column(String(64))
    car_type = Column(Enum("private", "public"), default="private")
    id_tag_token = Column(String(64), unique=True, nullable=False)
    expiry_date_time = Column(DateTime)
    status = Column(
        Enum("Accepted", "Blocked", "Expired", "Invalid", "ConcurrentTx"),
        default="Accepted",
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    id_tags = relationship("IdTag", back_populates="customer")
    transactions = relationship("Transaction", back_populates="customer")
    monthly_charge_limit = Column(Integer, nullable=True, default=None)
    charge_limit_enabled = Column(Boolean, default=True)


class ChargePoint(Base):
    __tablename__ = "charge_points"

    id = Column(Integer, primary_key=True, autoincrement=True)
    charge_point_id = Column(String(64), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    address = Column(Text)
    latitude = Column(Numeric(10, 7))
    longitude = Column(Numeric(10, 7))
    number_of_connectors = Column(SmallInteger, default=1)
    tariff_per_kwh = Column(Numeric(10, 2), default=0)
    cp_status = Column(String(32), default="Unknown")
    is_online = Column(Boolean, default=False)
    last_heartbeat = Column(DateTime)
    vendor_name = Column(String(64))
    model = Column(String(64))
    serial_number = Column(String(64))
    firmware_version = Column(String(64))
    iccid = Column(String(64))
    imsi = Column(String(64))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    connectors = relationship("Connector", back_populates="charge_point")
    transactions = relationship("Transaction", back_populates="charge_point")
    alerts = relationship("Alert", back_populates="charge_point")
    tariffs = relationship("Tariff", back_populates="charge_point")


class Connector(Base):
    __tablename__ = "connectors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    charge_point_id = Column(
        String(64), ForeignKey("charge_points.charge_point_id"), nullable=False
    )
    connector_id = Column(SmallInteger, nullable=False)
    status = Column(String(32), default="Unknown")
    error_code = Column(String(64))
    vendor_id = Column(String(64))
    vendor_error_code = Column(String(64))
    info = Column(String(255))
    timestamp = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    charge_point = relationship("ChargePoint", back_populates="connectors")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    charge_point_id = Column(
        String(64), ForeignKey("charge_points.charge_point_id"), nullable=False
    )
    connector_id = Column(SmallInteger)
    timestamp = Column(DateTime, default=datetime.utcnow)
    status = Column(String(64), nullable=False)
    error_code = Column(String(64))
    vendor_id = Column(String(64))
    vendor_error_code = Column(String(64))
    info = Column(String(255))
    is_resolved = Column(Boolean, default=False)

    charge_point = relationship("ChargePoint", back_populates="alerts")


class IdTag(Base):
    __tablename__ = "id_tags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    id_tag = Column(String(64), unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    expiry_date = Column(DateTime)
    status = Column(
        Enum("Accepted", "Blocked", "Expired", "Invalid", "ConcurrentTx"),
        default="Accepted",
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer = relationship("Customer", back_populates="id_tags")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    transaction_id = Column(Integer, nullable=False)
    charge_point_id = Column(
        String(64), ForeignKey("charge_points.charge_point_id"), nullable=False
    )
    connector_id = Column(SmallInteger, nullable=False)
    id_tag = Column(String(64))
    customer_id = Column(Integer, ForeignKey("customers.id"))
    start_timestamp = Column(DateTime)
    stop_timestamp = Column(DateTime)
    meter_start = Column(Integer)
    meter_stop = Column(Integer)
    energy_consumed_kwh = Column(Numeric(10, 3))
    stop_reason = Column(String(64))
    tariff_per_kwh = Column(Numeric(10, 2))
    total_cost = Column(Numeric(12, 2))
    status = Column(Enum("Active", "Completed", "Invalid"), default="Active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    charge_point = relationship("ChargePoint", back_populates="transactions")
    customer = relationship("Customer", back_populates="transactions")


class ChargingLimitConfig(Base):
    """Konfigurasi limit global — selalu hanya 1 baris (id=1)."""

    __tablename__ = "charging_limit_config"

    id = Column(Integer, primary_key=True, default=1)
    monthly_limit = Column(Integer, nullable=False, default=15)
    is_enabled = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ChargeLimitRequest(Base):
    """Request akses sementara dari customer yang sudah over limit."""

    __tablename__ = "charge_limit_requests"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    id_tag = Column(String(64), nullable=False)
    charge_point_id = Column(String(64), nullable=True)
    reason = Column(Text, nullable=True)
    status = Column(Enum("Pending", "Approved", "Rejected"), default="Pending")
    extra_sessions = Column(Integer, default=1)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    requested_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    customer = relationship("Customer", foreign_keys=[customer_id])
    approver = relationship("User", foreign_keys=[approved_by])


class MeterValue(Base):
    __tablename__ = "meter_values"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    transaction_id = Column(Integer)
    charge_point_id = Column(
        String(64), ForeignKey("charge_points.charge_point_id"), nullable=False
    )
    connector_id = Column(SmallInteger, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    measurand = Column(String(64), default="Energy.Active.Import.Register")
    value = Column(Numeric(14, 4))
    unit = Column(String(16))
    context = Column(String(32))
    format = Column(String(16))
    phase = Column(String(16))
    location = Column(String(16))


class Tariff(Base):
    __tablename__ = "tariffs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    charge_point_id = Column(
        String(64), ForeignKey("charge_points.charge_point_id"), nullable=False
    )
    cost_per_kwh = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(8), default="IDR")
    valid_from = Column(DateTime)
    valid_until = Column(DateTime)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    charge_point = relationship("ChargePoint", back_populates="tariffs")


class SendCommand(Base):
    __tablename__ = "send_commands"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    charge_point_id = Column(String(64), nullable=False)
    command = Column(String(64), nullable=False)
    payload = Column(JSON)
    response = Column(JSON)
    status = Column(
        Enum("Pending", "Sent", "Accepted", "Rejected", "Failed"),
        default="Pending",
    )
    sent_by_user_id = Column(Integer, ForeignKey("users.id"))
    sent_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime)
