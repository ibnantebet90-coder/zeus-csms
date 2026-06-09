"""
ZEUS CSMS — Energy Monitoring Endpoint
GET /api/energy/latest        — data terbaru energy_trafo
GET /api/energy/today         — data hari ini
GET /api/energy/daily         — akumulasi harian
GET /api/energy/top5          — top 5 hari tertinggi
GET /api/energy/export        — download CSV/XLSX/PDF
POST /api/energy/seed-demo    — insert demo data (dev only)
"""

import io
import csv
import logging
from datetime import datetime, timedelta, date
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, desc
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import User

logger = logging.getLogger("zeus.energy")
router = APIRouter(prefix="/api/energy", tags=["Energy Monitoring"])


# ── Models ────────────────────────────────────────────────────
class EnergyRecord(BaseModel):
    id:             int
    time_stamp:     str
    energy_trafo_2: Optional[float]
    source:         Optional[str]

class EnergySummary(BaseModel):
    total_records:     int
    latest_value:      Optional[float]
    latest_timestamp:  Optional[str]
    total_today_kwh:   float
    avg_today_kwh:     float
    max_today_kwh:     Optional[float]

class DailyEnergy(BaseModel):
    date:        str
    total_kwh:   float
    avg_kwh:     float
    max_kwh:     float
    min_kwh:     float
    data_points: int


# ── Helper: ambil model EnergyTrafo ──────────────────────────
def get_trafo_model(db: Session):
    from sqlalchemy import text
    # Pastikan tabel ada
    try:
        db.execute(text("SELECT 1 FROM energy_trafo LIMIT 1"))
        return True
    except Exception:
        return False


# ════════════════════════════════════════════════════════════
#  SUMMARY
# ════════════════════════════════════════════════════════════

@router.get("/summary", response_model=EnergySummary)
def get_summary(
    db: Session = Depends(get_db),
    _:  User    = Depends(get_current_user),
):
    from sqlalchemy import text
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    try:
        # Total records
        total = db.execute(text("SELECT COUNT(*) FROM energy_trafo")).scalar() or 0

        # Latest record
        latest = db.execute(text(
            "SELECT time_stamp, energy_trafo_2 FROM energy_trafo ORDER BY time_stamp DESC LIMIT 1"
        )).fetchone()

        # Today stats
        today_stats = db.execute(text(
            "SELECT COALESCE(MAX(energy_trafo_2),0), COALESCE(AVG(energy_trafo_2),0), COALESCE(MAX(energy_trafo_2),0) "
            "FROM energy_trafo WHERE time_stamp >= :ts"
        ), {"ts": today_start}).fetchone()

        return EnergySummary(
            total_records=int(total),
            latest_value=float(latest[1]) if latest and latest[1] is not None else None,
            latest_timestamp=str(latest[0]) if latest else None,
            total_today_kwh=float(today_stats[0]) if today_stats else 0.0,
            avg_today_kwh=round(float(today_stats[1]), 4) if today_stats else 0.0,
            max_today_kwh=float(today_stats[2]) if today_stats else None,
        )
    except Exception as e:
        logger.error("Summary error: %s", e)
        return EnergySummary(
            total_records=0, latest_value=None, latest_timestamp=None,
            total_today_kwh=0.0, avg_today_kwh=0.0, max_today_kwh=None,
        )


# ════════════════════════════════════════════════════════════
#  LATEST DATA (table)
# ════════════════════════════════════════════════════════════

@router.get("/latest", response_model=List[EnergyRecord])
def get_latest(
    limit:  int           = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    db:     Session       = Depends(get_db),
    _:      User          = Depends(get_current_user),
):
    from sqlalchemy import text
    try:
        if search:
            rows = db.execute(text(
                "SELECT id, time_stamp, energy_trafo_2, source FROM energy_trafo "
                "WHERE CAST(energy_trafo_2 AS CHAR) LIKE :s OR source LIKE :s "
                "ORDER BY time_stamp DESC LIMIT :lim"
            ), {"s": f"%{search}%", "lim": limit}).fetchall()
        else:
            rows = db.execute(text(
                "SELECT id, time_stamp, energy_trafo_2, source "
                "FROM energy_trafo ORDER BY time_stamp DESC LIMIT :lim"
            ), {"lim": limit}).fetchall()

        return [
            EnergyRecord(
                id=row[0],
                time_stamp=str(row[1]),
                energy_trafo_2=float(row[2]) if row[2] is not None else None,
                source=row[3],
            )
            for row in rows
        ]
    except Exception as e:
        logger.error("Latest error: %s", e)
        return []


# ════════════════════════════════════════════════════════════
#  TODAY REALTIME (grafik hari ini)
# ════════════════════════════════════════════════════════════

@router.get("/today")
def get_today(
    db: Session = Depends(get_db),
    _:  User    = Depends(get_current_user),
):
    from sqlalchemy import text
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        rows = db.execute(text(
            "SELECT time_stamp, energy_trafo_2, source FROM energy_trafo "
            "WHERE time_stamp >= :ts ORDER BY time_stamp ASC LIMIT 1440"
        ), {"ts": today_start}).fetchall()

        return [
            {
                "time_stamp":     str(row[0]),
                "energy_trafo_2": float(row[1]) if row[1] is not None else 0,
                "source":         row[2],
            }
            for row in rows
        ]
    except Exception as e:
        logger.error("Today error: %s", e)
        return []


# ════════════════════════════════════════════════════════════
#  DAILY AGGREGATION
# ════════════════════════════════════════════════════════════

@router.get("/daily", response_model=List[DailyEnergy])
def get_daily(
    days: int     = Query(30, ge=1, le=365),
    db:   Session = Depends(get_db),
    _:    User    = Depends(get_current_user),
):
    from sqlalchemy import text
    since = datetime.utcnow() - timedelta(days=days)
    try:
        rows = db.execute(text(
            "SELECT DATE(time_stamp) as d, "
            "SUM(energy_trafo_2), AVG(energy_trafo_2), "
            "MAX(energy_trafo_2), MIN(energy_trafo_2), COUNT(*) "
            "FROM energy_trafo WHERE time_stamp >= :since AND energy_trafo_2 IS NOT NULL "
            "GROUP BY DATE(time_stamp) ORDER BY d ASC"
        ), {"since": since}).fetchall()

        result = []
        for row in rows:
            result.append(DailyEnergy(
                date=str(row[0]),
                total_kwh=round(float(row[1] or 0), 4),
                avg_kwh=round(float(row[2] or 0), 4),
                max_kwh=round(float(row[3] or 0), 4),
                min_kwh=round(float(row[4] or 0), 4),
                data_points=int(row[5]),
            ))
        return result
    except Exception as e:
        logger.error("Daily error: %s", e)
        return []


# ════════════════════════════════════════════════════════════
#  TOP 5 DAILY
# ════════════════════════════════════════════════════════════

@router.get("/top5")
def get_top5(
    days: int     = Query(30, ge=7, le=365),
    db:   Session = Depends(get_db),
    _:    User    = Depends(get_current_user),
):
    from sqlalchemy import text
    since = datetime.utcnow() - timedelta(days=days)
    try:
        rows = db.execute(text(
            "SELECT DATE(time_stamp) as d, SUM(energy_trafo_2) as total "
            "FROM energy_trafo WHERE time_stamp >= :since AND energy_trafo_2 IS NOT NULL "
            "GROUP BY DATE(time_stamp) ORDER BY total DESC LIMIT 5"
        ), {"since": since}).fetchall()

        return [{"date": str(row[0]), "total_kwh": round(float(row[1] or 0), 4)} for row in rows]
    except Exception as e:
        logger.error("Top5 error: %s", e)
        return []


# ════════════════════════════════════════════════════════════
#  EXPORT
# ════════════════════════════════════════════════════════════

@router.get("/export")
def export_energy(
    format:     str           = Query("csv", enum=["csv", "xlsx", "pdf"]),
    days:       int           = Query(30, ge=1, le=365),
    export_type: str          = Query("latest", enum=["latest", "daily"]),
    limit:      int           = Query(1000, ge=1, le=10000),
    db:         Session       = Depends(get_db),
    _:          User          = Depends(get_current_user),
):
    from sqlalchemy import text
    fname = f"zeus_energy_{export_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    if export_type == "latest":
        rows_db = db.execute(text(
            "SELECT id, time_stamp, energy_trafo_2, source "
            "FROM energy_trafo ORDER BY time_stamp DESC LIMIT :lim"
        ), {"lim": limit}).fetchall()
        headers = ["id", "time_stamp", "energy_trafo_2", "source"]
        rows = [[row[0], str(row[1]), row[2], row[3]] for row in rows_db]
    else:
        since = datetime.utcnow() - timedelta(days=days)
        rows_db = db.execute(text(
            "SELECT DATE(time_stamp), SUM(energy_trafo_2), AVG(energy_trafo_2), "
            "MAX(energy_trafo_2), MIN(energy_trafo_2), COUNT(*) "
            "FROM energy_trafo WHERE time_stamp >= :since AND energy_trafo_2 IS NOT NULL "
            "GROUP BY DATE(time_stamp) ORDER BY DATE(time_stamp) ASC"
        ), {"since": since}).fetchall()
        headers = ["date", "total_kwh", "avg_kwh", "max_kwh", "min_kwh", "data_points"]
        rows = [[str(r[0]), round(float(r[1] or 0),4), round(float(r[2] or 0),4),
                 round(float(r[3] or 0),4), round(float(r[4] or 0),4), int(r[5])] for r in rows_db]

    if format == "pdf":
        return _export_pdf(rows, headers, fname, export_type)
    elif format == "xlsx":
        return _export_xlsx(rows, headers, fname)
    else:
        return _export_csv(rows, headers, fname)


def _export_csv(rows, headers, fname):
    buf = io.StringIO()
    w   = csv.writer(buf, quoting=csv.QUOTE_NONNUMERIC)
    w.writerow(headers)
    w.writerows(rows)
    content = ("\ufeff" + buf.getvalue()).encode("utf-8")
    return StreamingResponse(io.BytesIO(content), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'})


def _export_xlsx(rows, headers, fname):
    import pandas as pd
    df  = pd.DataFrame(rows, columns=headers)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Energy Data", index=False)
        ws = writer.sheets["Energy Data"]
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = min(
                max(len(str(c.value or "")) for c in col) + 4, 40)
    buf.seek(0)
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}.xlsx"'})


def _export_pdf(rows, headers, fname, export_type):
    try:
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.units import cm

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                                 leftMargin=1*cm, rightMargin=1*cm,
                                 topMargin=1.5*cm, bottomMargin=1.5*cm)
        styles = getSampleStyleSheet()
        elements = []

        # Title
        elements.append(Paragraph(
            f"<b>ZEUS CSMS — Energy Monitoring Report</b>", styles["Title"]))
        elements.append(Paragraph(
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Type: {export_type}",
            styles["Normal"]))
        elements.append(Spacer(1, 0.5*cm))

        # Table
        table_data = [headers] + [[str(v) for v in row] for row in rows[:500]]
        col_count  = len(headers)
        col_width  = (landscape(A4)[0] - 2*cm) / col_count

        t = Table(table_data, colWidths=[col_width] * col_count, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1,0), colors.HexColor("#1a1a2e")),
            ("TEXTCOLOR",     (0,0), (-1,0), colors.white),
            ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",      (0,0), (-1,-1), 7),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [colors.white, colors.HexColor("#f8f9fa")]),
            ("GRID",          (0,0), (-1,-1), 0.3, colors.HexColor("#dee2e6")),
            ("ALIGN",         (0,0), (-1,-1), "CENTER"),
            ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
            ("PADDING",       (0,0), (-1,-1), 4),
        ]))
        elements.append(t)
        doc.build(elements)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'})
    except ImportError:
        # Fallback ke CSV jika reportlab tidak ada
        return _export_csv(rows, headers, fname)


# ════════════════════════════════════════════════════════════
#  SEED DEMO DATA (untuk testing)
# ════════════════════════════════════════════════════════════

@router.post("/seed-demo")
def seed_demo(
    days:   int     = Query(30),
    db:     Session = Depends(get_db),
    _:      User    = Depends(get_current_user),
):
    """Insert data demo ke tabel energy_trafo untuk testing."""
    from sqlalchemy import text
    import random, math

    now   = datetime.utcnow()
    count = 0

    for day in range(days):
        base_date = now - timedelta(days=days-day)
        # Insert setiap 15 menit
        for minute in range(0, 1440, 15):
            ts    = base_date.replace(hour=0,minute=0,second=0) + timedelta(minutes=minute)
            hour  = ts.hour
            # Pola harian: rendah malam, tinggi siang
            base  = 50 + 80 * math.sin(math.pi * max(0, hour-6) / 14) if 6 <= hour <= 22 else 20
            value = round(max(0, base + random.uniform(-10, 10)), 4)
            try:
                db.execute(text(
                    "INSERT INTO energy_trafo (time_stamp, energy_trafo_2, source) "
                    "VALUES (:ts, :val, 'DEMO')"
                ), {"ts": ts, "val": value})
                count += 1
            except Exception:
                pass

    db.commit()
    return {"inserted": count, "days": days}
