"""
ZEUS CSMS — Forecasting Import/Export v2
Format disesuaikan dengan export transaksi ZEUS
"""

import io
import csv
import logging
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import Transaction, User

logger = logging.getLogger("zeus.forecast.io")
router = APIRouter(prefix="/api/forecasting", tags=["Forecasting IO"])


class ImportedDataPoint(BaseModel):
    date: str
    value: float


class ImportResponse(BaseModel):
    success: bool
    rows: int
    data: List[ImportedDataPoint]
    errors: List[str]
    source: str


@router.post("/import", response_model=ImportResponse)
async def import_forecast_data(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
):
    filename = file.filename or ""
    content = await file.read()
    errors: List[str] = []
    data: List[ImportedDataPoint] = []
    source = "custom"

    try:
        if filename.endswith(".csv"):
            data, errors, source = _parse_csv(content)
        elif filename.endswith((".xlsx", ".xls")):
            data, errors, source = _parse_excel(content)
        else:
            raise HTTPException(status_code=400, detail="Gunakan .csv atau .xlsx")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal membaca file: {e}")

    return ImportResponse(
        success=len(data) > 0, rows=len(data), data=data, errors=errors, source=source
    )


def _parse_date(s: str) -> str:
    s = s.strip().strip('"')
    for fmt in [
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%Y/%m/%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
    ]:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Format tanggal tidak dikenal: '{s}'")


def _parse_csv(content: bytes):
    text = content.decode("utf-8-sig").strip()
    reader = csv.DictReader(io.StringIO(text))
    headers = [h.lower().strip().strip('"') for h in (reader.fieldnames or [])]

    if "start_timestamp" in headers and "energy_consumed_kwh" in headers:
        return _parse_zeus_transaction(text, is_excel=False)

    date_col = next((h for h in headers if h in ("date", "tanggal", "tgl")), None)
    value_col = next(
        (
            h
            for h in headers
            if h
            in ("value", "energy", "energi", "kwh", "energy_consumed_kwh", "total_kwh")
        ),
        None,
    )

    if date_col and value_col:
        data, errors = [], []
        reader2 = csv.DictReader(io.StringIO(text))
        fnames = reader2.fieldnames or []
        orig_d = next(
            (f for f in fnames if f.lower().strip().strip('"') == date_col), None
        )
        orig_v = next(
            (f for f in fnames if f.lower().strip().strip('"') == value_col), None
        )
        for i, row in enumerate(reader2, 2):
            try:
                rd = str(row.get(orig_d or date_col, "")).strip().strip('"')
                rv = str(row.get(orig_v or value_col, "0")).strip().strip('"')
                if not rd or rd.startswith("#"):
                    continue
                d = _parse_date(rd.split(" ")[0])
                v = float(rv.replace(",", "."))
                data.append(ImportedDataPoint(date=d, value=max(0, v)))
            except Exception as e:
                errors.append(f"Baris {i}: {e}")
        return data, errors, "daily"

    data, errors = [], []
    for i, line in enumerate(text.split("\n")[1:], 2):
        parts = line.strip().split(",")
        if len(parts) < 2:
            continue
        try:
            d = _parse_date(parts[0].split(" ")[0])
            v = float(parts[1].strip().strip('"').replace(",", "."))
            data.append(ImportedDataPoint(date=d, value=max(0, v)))
        except Exception as e:
            errors.append(f"Baris {i}: {e}")
    return data, errors, "custom"


def _parse_zeus_transaction(text_or_bytes, is_excel=False):
    daily: dict = {}
    errors: List[str] = []

    if is_excel:
        rows_iter = text_or_bytes
    else:
        rows_iter = csv.DictReader(io.StringIO(text_or_bytes))

    for i, row in enumerate(rows_iter, 2):
        try:
            status = str(row.get("status", "")).strip().strip('"')
            if status != "Completed":
                continue
            raw_e = str(row.get("energy_consumed_kwh", "")).strip().strip('"')
            if not raw_e or raw_e in ("nan", ""):
                continue
            energy = float(raw_e)
            if energy <= 0:
                continue
            raw_ts = str(row.get("start_timestamp", "")).strip().strip('"')
            date_str = _parse_date(raw_ts.split(" ")[0].split("T")[0])
            daily[date_str] = daily.get(date_str, 0.0) + energy
        except Exception as e:
            errors.append(f"Baris {i}: {e}")

    data = [
        ImportedDataPoint(date=d, value=round(v, 4)) for d, v in sorted(daily.items())
    ]
    return data, errors, "transaction"


def _parse_excel(content: bytes):
    import pandas as pd

    df = pd.read_excel(io.BytesIO(content), header=0, dtype=str)
    df.columns = [str(c).lower().strip() for c in df.columns]

    if "start_timestamp" in df.columns and "energy_consumed_kwh" in df.columns:
        rows = [dict(row) for _, row in df.iterrows()]
        return _parse_zeus_transaction(iter(rows), is_excel=True)

    date_col = next(
        (c for c in df.columns if c in ("date", "tanggal", "tgl")), df.columns[0]
    )
    value_col = next(
        (
            c
            for c in df.columns
            if c
            in ("value", "energy", "energi", "kwh", "energy_consumed_kwh", "total_kwh")
        ),
        df.columns[1] if len(df.columns) > 1 else None,
    )

    data, errors = [], []
    for i, row in df.iterrows():
        try:
            rd = str(row[date_col]).strip()
            rv = str(row[value_col]).strip()
            if rd in ("nan", "") or rv in ("nan", ""):
                continue
            d = _parse_date(rd.split(" ")[0].split("T")[0])
            v = float(rv.replace(",", "."))
            data.append(ImportedDataPoint(date=d, value=max(0, v)))
        except Exception as e:
            errors.append(f"Baris {int(i)+2}: {e}")
    return data, errors, "daily"


@router.get("/export")
def export_forecast_data(
    format: str = Query("csv", enum=["csv", "xlsx", "json"]),
    charge_point_id: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    export_type: str = Query("transaction", enum=["transaction", "daily"]),
    include_forecast: bool = Query(False),
    method: str = Query("arima"),
    forecast_days: int = Query(7),
    split_ratio: float = Query(0.8),
    look_back: int = Query(7),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    fname = f"zeus_{'transactions' if export_type=='transaction' else 'energy'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    if export_type == "transaction":
        q = db.query(Transaction).filter(Transaction.start_timestamp >= since)
        if charge_point_id:
            q = q.filter(Transaction.charge_point_id == charge_point_id)
        txs = q.order_by(Transaction.start_timestamp).all()

        headers = [
            "id",
            "transaction_id",
            "charge_point_id",
            "connector_id",
            "id_tag",
            "customer_id",
            "start_timestamp",
            "stop_timestamp",
            "meter_start",
            "meter_stop",
            "energy_consumed_kwh",
            "stop_reason",
            "tariff_per_kwh",
            "total_cost",
            "status",
            "created_at",
            "updated_at",
        ]
        rows = []
        for t in txs:
            rows.append(
                [
                    t.id,
                    t.transaction_id,
                    t.charge_point_id,
                    t.connector_id,
                    t.id_tag or "",
                    t.customer_id or "",
                    t.start_timestamp or "",
                    t.stop_timestamp or "",
                    t.meter_start or 0,
                    t.meter_stop or "",
                    t.energy_consumed_kwh or "",
                    t.stop_reason or "",
                    t.tariff_per_kwh or "",
                    t.total_cost or "",
                    t.status,
                    t.created_at or "",
                    t.updated_at or "",
                ]
            )
    else:
        q = db.query(
            func.date(Transaction.start_timestamp).label("date"),
            func.coalesce(func.sum(Transaction.energy_consumed_kwh), 0).label("energy"),
            func.count(Transaction.id).label("sessions"),
            func.coalesce(func.sum(Transaction.total_cost), 0).label("revenue"),
        ).filter(
            Transaction.status == "Completed", Transaction.start_timestamp >= since
        )
        if charge_point_id:
            q = q.filter(Transaction.charge_point_id == charge_point_id)
        rows_db = (
            q.group_by(func.date(Transaction.start_timestamp))
            .order_by(func.date(Transaction.start_timestamp))
            .all()
        )

        date_map: dict = {}
        for i in range(days):
            d = (since + timedelta(days=i + 1)).date()
            date_map[str(d)] = {"energy": 0.0, "sessions": 0, "revenue": 0.0}
        for row in rows_db:
            date_map[str(row.date)] = {
                "energy": float(row.energy),
                "sessions": int(row.sessions),
                "revenue": float(row.revenue),
            }

        records = [
            {"date": k, **v, "type": "actual"} for k, v in sorted(date_map.items())
        ]

        if include_forecast:
            try:
                from app.services.forecast_engine import run_model

                values = [r["energy"] for r in records]
                result = run_model(
                    method, values, split_ratio, forecast_days, look_back
                )
                if not result.error:
                    last = datetime.strptime(records[-1]["date"], "%Y-%m-%d")
                    for i, v in enumerate(result.forecast):
                        records.append(
                            {
                                "date": (last + timedelta(days=i + 1)).strftime(
                                    "%Y-%m-%d"
                                ),
                                "energy": round(v, 4),
                                "sessions": "",
                                "revenue": "",
                                "type": "forecast",
                            }
                        )
            except Exception as e:
                logger.error("Forecast error: %s", e)

        headers = [
            "date",
            "energy_consumed_kwh",
            "total_sessions",
            "total_revenue_idr",
            "type",
        ]
        rows = [
            [r["date"], r["energy"], r["sessions"], r["revenue"], r["type"]]
            for r in records
        ]

    return _render(rows, headers, format, fname)


def _render(rows, headers, format, fname):
    if format == "json":
        import json

        content = json.dumps(
            {
                "exported_at": datetime.now().isoformat(),
                "data": [dict(zip(headers, r)) for r in rows],
            },
            indent=2,
            default=str,
        ).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{fname}.json"'},
        )
    elif format == "xlsx":
        import pandas as pd

        df = pd.DataFrame(rows, columns=headers)
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Data", index=False)
            ws = writer.sheets["Data"]
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = min(
                    max(len(str(c.value or "")) for c in col) + 4, 40
                )
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}.xlsx"'},
        )
    else:
        buf = io.StringIO()
        w = csv.writer(buf, quoting=csv.QUOTE_NONNUMERIC)
        w.writerow(headers)
        w.writerows(rows)
        content = ("\ufeff" + buf.getvalue()).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'},
        )


@router.get("/template")
def download_template(
    format: str = Query("csv", enum=["csv", "xlsx"]),
    template_type: str = Query("transaction", enum=["transaction", "daily"]),
    _: User = Depends(get_current_user),
):
    now = datetime.now()
    if template_type == "transaction":
        headers = [
            "id",
            "transaction_id",
            "charge_point_id",
            "connector_id",
            "id_tag",
            "customer_id",
            "start_timestamp",
            "stop_timestamp",
            "meter_start",
            "meter_stop",
            "energy_consumed_kwh",
            "stop_reason",
            "tariff_per_kwh",
            "total_cost",
            "status",
            "created_at",
            "updated_at",
        ]
        rows = []
        for i in range(3):
            s = now - timedelta(days=3 - i, hours=2)
            e = s + timedelta(minutes=30)
            en = round(0.050 + i * 0.01, 3)
            rows.append(
                [
                    i + 1,
                    765000000 + i,
                    "CP001",
                    2,
                    "ABCD1234",
                    "",
                    s.strftime("%Y-%m-%d %H:%M:%S"),
                    e.strftime("%Y-%m-%d %H:%M:%S"),
                    0,
                    int(en * 1000),
                    en,
                    "Local",
                    2500,
                    round(en * 2500, 0),
                    "Completed",
                    s.strftime("%Y-%m-%d %H:%M:%S"),
                    e.strftime("%Y-%m-%d %H:%M:%S"),
                ]
            )
        fname = "template_transactions"
        notes = [
            "FORMAT TRANSAKSI ZEUS CSMS",
            "Kolom wajib: start_timestamp, energy_consumed_kwh, status",
            "Hanya baris status=Completed yang diproses",
            "Format start_timestamp: YYYY-MM-DD HH:MM:SS",
        ]
    else:
        headers = [
            "date",
            "energy_consumed_kwh",
            "total_sessions",
            "total_revenue_idr",
            "type",
        ]
        rows = [
            [
                (now - timedelta(days=7 - i)).strftime("%Y-%m-%d"),
                round(50 + i * 10 + (i % 3) * 5, 3),
                i + 2,
                (50 + i * 10) * 2500,
                "actual",
            ]
            for i in range(7)
        ]
        fname = "template_daily_energy"
        notes = [
            "FORMAT HARIAN ZEUS CSMS",
            "Kolom wajib: date, energy_consumed_kwh",
            "Format date: YYYY-MM-DD",
        ]

    if format == "xlsx":
        import pandas as pd

        df = pd.DataFrame(rows, columns=headers)
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Data", index=False)
            ws2 = writer.book.create_sheet("Petunjuk")
            for i, n in enumerate(notes, 1):
                ws2.cell(row=i, column=1, value=n)
            ws = writer.sheets["Data"]
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = min(
                    max(len(str(c.value or "")) for c in col) + 4, 40
                )
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}.xlsx"'},
        )
    else:
        buf = io.StringIO()
        w = csv.writer(buf, quoting=csv.QUOTE_NONNUMERIC)
        w.writerow(headers)
        w.writerows(rows)
        content = ("\ufeff" + buf.getvalue()).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'},
        )
