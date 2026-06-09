"""
ZEUS CSMS — Forecasting API v2
Endpoint dengan ARIMA, LS, SVR, XGBoost, ANN, LSTM
+ train/test split + metrics lengkap
"""

import logging
import random
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import Transaction, User

logger = logging.getLogger("zeus.forecast")
router = APIRouter(prefix="/api/forecasting", tags=["Forecasting"])

# ── Models ─────────────────────────────────────────────────

class MetricsOut(BaseModel):
    mape: float
    mae:  float
    mse:  float
    rmse: float
    r2:   float

class ForecastResponse(BaseModel):
    method:          str
    split_ratio:     float
    look_back:       int
    # Data series
    dates_all:       List[str]
    actual:          List[float]
    train_predicted: List[float]
    test_predicted:  List[float]
    forecast_values: List[float]
    forecast_dates:  List[str]
    # Train/test boundary index
    train_size:      int
    test_size:       int
    # Metrics
    metrics_train:   MetricsOut
    metrics_test:    MetricsOut
    # Meta
    error:           Optional[str] = None
    unit:            str = "kWh"

class SummaryResponse(BaseModel):
    period_days:        int
    total_sessions:     int
    total_energy_kwh:   float
    total_revenue_idr:  float
    avg_energy_kwh:     float
    avg_duration_min:   float

# ── Helper: ambil data energi harian ──────────────────────

def get_daily_energy(
    db: Session,
    charge_point_id: Optional[str],
    days: int,
) -> tuple[List[str], List[float]]:
    since = datetime.utcnow() - timedelta(days=days)

    q = db.query(
        func.date(Transaction.start_timestamp).label("date"),
        func.coalesce(func.sum(Transaction.energy_consumed_kwh), 0).label("energy"),
    ).filter(
        Transaction.status == "Completed",
        Transaction.start_timestamp >= since,
    )
    if charge_point_id:
        q = q.filter(Transaction.charge_point_id == charge_point_id)

    rows = q.group_by(func.date(Transaction.start_timestamp))\
            .order_by(func.date(Transaction.start_timestamp)).all()

    date_map: dict = {}
    for i in range(days):
        d = (since + timedelta(days=i+1)).date()
        date_map[str(d)] = 0.0
    for row in rows:
        date_map[str(row.date)] = float(row.energy)

    sorted_items = sorted(date_map.items())
    dates  = [k for k, _ in sorted_items]
    values = [v for _, v in sorted_items]
    return dates, values


# ── Main Forecast Endpoint ─────────────────────────────────

@router.get("/energy", response_model=ForecastResponse)
def forecast_energy(
    method:           str            = Query("arima"),
    charge_point_id:  Optional[str]  = Query(None),
    history_days:     int            = Query(60, ge=14, le=180),
    forecast_days:    int            = Query(7,  ge=1,  le=60),
    split_ratio:      float          = Query(0.8, ge=0.4, le=0.95),
    look_back:        int            = Query(7,  ge=3,  le=30),
    db:               Session        = Depends(get_db),
    _:                User           = Depends(get_current_user),
):
    from app.services.forecast_engine import run_model

    dates, values = get_daily_energy(db, charge_point_id, history_days)

    # Jika tidak ada data nyata — generate dummy untuk demo
    if not any(v > 0 for v in values):
        random.seed(42)
        base = 100.0
        values = []
        for i in range(history_days):
            base += random.uniform(-10, 15)
            base = max(10, base)
            values.append(round(base, 2))

    result = run_model(
        method=method,
        data=values,
        split_ratio=split_ratio,
        forecast_days=forecast_days,
        look_back=look_back,
    )

    if result.error:
        return ForecastResponse(
            method=method, split_ratio=split_ratio, look_back=look_back,
            dates_all=dates, actual=values,
            train_predicted=[], test_predicted=[],
            forecast_values=[], forecast_dates=[],
            train_size=0, test_size=0,
            metrics_train=MetricsOut(mape=0,mae=0,mse=0,rmse=0,r2=0),
            metrics_test=MetricsOut(mape=0,mae=0,mse=0,rmse=0,r2=0),
            error=result.error,
        )

    # Susun array train/test predicted sesuai panjang actual
    n_train = int(len(values) * split_ratio)
    n_test  = len(values) - n_train

    # Pad agar panjang = len(actual)
    look_back_eff = min(look_back, n_train - 1)
    train_pred_padded = [None] * look_back_eff + [round(v, 3) for v in result.train_predicted]
    train_pred_padded = (train_pred_padded + [None] * len(values))[:len(values)]

    test_offset = n_train
    test_pred_padded = [None] * test_offset + [round(v, 3) for v in result.test_predicted]
    test_pred_padded = (test_pred_padded + [None] * len(values))[:len(values)]

    # Forecast dates
    last_date = datetime.strptime(dates[-1], "%Y-%m-%d")
    forecast_dates = [
        (last_date + timedelta(days=i+1)).strftime("%Y-%m-%d")
        for i in range(forecast_days)
    ]

    def _metrics(m: dict) -> MetricsOut:
        return MetricsOut(**m)

    return ForecastResponse(
        method=method,
        split_ratio=split_ratio,
        look_back=look_back,
        dates_all=dates,
        actual=[round(v, 3) for v in values],
        train_predicted=[v if v is not None else 0 for v in train_pred_padded],
        test_predicted=[v if v is not None else 0 for v in test_pred_padded],
        forecast_values=[round(v, 3) for v in result.forecast],
        forecast_dates=forecast_dates,
        train_size=n_train,
        test_size=n_test,
        metrics_train=_metrics(result.metrics_train),
        metrics_test=_metrics(result.metrics_test),
        unit="kWh",
    )


# ── Summary Endpoint ───────────────────────────────────────

@router.get("/summary", response_model=SummaryResponse)
def transactions_summary(
    charge_point_id: Optional[str] = Query(None),
    days:            int            = Query(30, ge=1, le=90),
    db:              Session        = Depends(get_db),
    _:               User           = Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    q = db.query(Transaction).filter(
        Transaction.status == "Completed",
        Transaction.start_timestamp >= since,
    )
    if charge_point_id:
        q = q.filter(Transaction.charge_point_id == charge_point_id)

    txs = q.all()
    total_energy  = sum(float(t.energy_consumed_kwh or 0) for t in txs)
    total_revenue = sum(float(t.total_cost or 0) for t in txs)
    n = len(txs)
    avg_energy = total_energy / n if n else 0

    durations = [
        (t.stop_timestamp - t.start_timestamp).total_seconds() / 60
        for t in txs if t.start_timestamp and t.stop_timestamp
    ]
    avg_dur = sum(durations) / len(durations) if durations else 0

    return SummaryResponse(
        period_days=days,
        total_sessions=n,
        total_energy_kwh=round(total_energy, 2),
        total_revenue_idr=round(total_revenue, 2),
        avg_energy_kwh=round(avg_energy, 3),
        avg_duration_min=round(avg_dur, 1),
    )
