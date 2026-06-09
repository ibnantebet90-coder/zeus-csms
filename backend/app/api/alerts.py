"""
ZEUS CSMS — Alerts Endpoint
PUT /api/alerts/{alert_id} — update is_resolved
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models.models import Alert, User

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


class AlertUpdate(BaseModel):
    is_resolved: bool


@router.put("/{alert_id}")
def resolve_alert(
    alert_id: int,
    body: AlertUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert tidak ditemukan")
    alert.is_resolved = body.is_resolved
    db.commit()
    return {"id": alert_id, "is_resolved": alert.is_resolved}
