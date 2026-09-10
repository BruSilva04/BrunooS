from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from db.database import (
    create_acquisition_click,
    create_affiliate,
    create_campaign,
    get_acquisition_report,
    get_active_campaign_by_referral_code,
    get_affiliate,
    get_campaign,
    get_campaign_by_referral_code,
    get_user_by_id,
    list_affiliates,
    list_campaigns,
    update_affiliate,
    update_campaign,
)
from services.auth import verify_session_token
from services.tracking import (
    TRACKING_TTL_SECONDS,
    create_tracking_token,
    normalize_referral_code,
    now_utc,
    require_referral_code,
    to_iso,
)

router = APIRouter(prefix="/api", tags=["tracking"])


class TrackingClickRequest(BaseModel):
    referral_code: str = Field(max_length=64)
    visitor_id: str = Field(min_length=8, max_length=80)
    landing_path: str | None = Field(default=None, max_length=512)
    referrer_url: str | None = Field(default=None, max_length=1024)
    utm_source: str | None = Field(default=None, max_length=160)
    utm_medium: str | None = Field(default=None, max_length=160)
    utm_campaign: str | None = Field(default=None, max_length=160)
    utm_content: str | None = Field(default=None, max_length=160)


class AffiliateCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    handle: str | None = Field(default=None, max_length=80)
    contact: str | None = Field(default=None, max_length=180)
    status: str = Field(default="active", pattern=r"^(active|paused|archived)$")
    notes: str | None = Field(default=None, max_length=1000)


class AffiliatePatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    handle: str | None = Field(default=None, max_length=80)
    contact: str | None = Field(default=None, max_length=180)
    status: str | None = Field(default=None, pattern=r"^(active|paused|archived)$")
    notes: str | None = Field(default=None, max_length=1000)


class CampaignCreateRequest(BaseModel):
    affiliate_id: str = Field(min_length=20, max_length=80)
    name: str = Field(min_length=2, max_length=160)
    referral_code: str = Field(min_length=3, max_length=64)
    status: str = Field(default="active", pattern=r"^(active|paused|archived)$")
    media_cost: float = Field(default=0, ge=0)
    starts_at: str | None = Field(default=None, max_length=40)
    ends_at: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CampaignPatchRequest(BaseModel):
    affiliate_id: str | None = Field(default=None, min_length=20, max_length=80)
    name: str | None = Field(default=None, min_length=2, max_length=160)
    referral_code: str | None = Field(default=None, min_length=3, max_length=64)
    status: str | None = Field(default=None, pattern=r"^(active|paused|archived)$")
    media_cost: float | None = Field(default=None, ge=0)
    starts_at: str | None = Field(default=None, max_length=40)
    ends_at: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] | None = None


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    return authorization[len(prefix):]


def is_admin_user(user: dict[str, Any]) -> bool:
    permissions = user.get("permissions") or {}
    return user.get("role") == "admin" or bool(permissions.get("admin"))


async def require_admin(authorization: str | None) -> dict[str, Any]:
    session = verify_session_token(bearer_token(authorization))
    if not session:
        raise HTTPException(status_code=401, detail="Sessao invalida")
    user = await get_user_by_id(session["sub"])
    if not user or not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Acesso exclusivo para admin")
    return user


@router.post("/tracking/click")
async def tracking_click(payload: TrackingClickRequest):
    referral_code = normalize_referral_code(payload.referral_code)
    if not referral_code:
        return {"success": False, "reason": "invalid_referral"}

    campaign = await get_active_campaign_by_referral_code(referral_code)
    if not campaign:
        return {"success": False, "reason": "campaign_not_found"}

    click = await create_acquisition_click({
        "campaign_id": campaign["id"],
        "visitor_id": payload.visitor_id,
        "landing_path": payload.landing_path,
        "referrer_url": payload.referrer_url,
        "utm_source": payload.utm_source,
        "utm_medium": payload.utm_medium,
        "utm_campaign": payload.utm_campaign,
        "utm_content": payload.utm_content,
    })
    token = create_tracking_token(
        click_id=click["id"],
        campaign_id=campaign["id"],
        referral_code=referral_code,
        visitor_id=payload.visitor_id,
    )

    return {
        "success": True,
        "click_id": click["id"],
        "campaign_id": campaign["id"],
        "referral_code": referral_code,
        "tracking_token": token,
        "expires_at": to_iso(now_utc() + timedelta(seconds=TRACKING_TTL_SECONDS)),
    }


@router.get("/admin/affiliates")
async def admin_affiliates(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"affiliates": await list_affiliates()}


@router.post("/admin/affiliates")
async def admin_create_affiliate(
    payload: AffiliateCreateRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    affiliate = await create_affiliate(payload.model_dump())
    return {"affiliate": affiliate}


@router.patch("/admin/affiliates/{affiliate_id}")
async def admin_update_affiliate(
    affiliate_id: str,
    payload: AffiliatePatchRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    affiliate = await update_affiliate(affiliate_id, payload.model_dump(exclude_unset=True))
    if not affiliate:
        raise HTTPException(status_code=404, detail="Influenciador nao encontrado")
    return {"affiliate": affiliate}


@router.get("/admin/campaigns")
async def admin_campaigns(
    affiliate_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    return {"campaigns": await list_campaigns(affiliate_id=affiliate_id)}


@router.post("/admin/campaigns")
async def admin_create_campaign(
    payload: CampaignCreateRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    if not await get_affiliate(payload.affiliate_id):
        raise HTTPException(status_code=404, detail="Influenciador nao encontrado")

    try:
        data = payload.model_dump()
        data["referral_code"] = require_referral_code(data.get("referral_code"))
        if await get_campaign_by_referral_code(data["referral_code"]):
            raise HTTPException(status_code=409, detail="Referral code ja existe")
        campaign = await create_campaign(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"campaign": campaign}


@router.patch("/admin/campaigns/{campaign_id}")
async def admin_update_campaign(
    campaign_id: str,
    payload: CampaignPatchRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    data = payload.model_dump(exclude_unset=True)
    if "affiliate_id" in data and data["affiliate_id"] and not await get_affiliate(data["affiliate_id"]):
        raise HTTPException(status_code=404, detail="Influenciador nao encontrado")
    try:
        if data.get("referral_code"):
            code = require_referral_code(data["referral_code"])
            existing = await get_campaign_by_referral_code(code)
            if existing and str(existing["id"]) != str(campaign_id):
                raise HTTPException(status_code=409, detail="Referral code ja existe")
            data["referral_code"] = code
        campaign = await update_campaign(campaign_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    return {"campaign": campaign}


@router.get("/admin/acquisition/overview")
async def admin_acquisition_overview(
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    affiliate_id: str | None = Query(default=None),
    campaign_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    report = await get_acquisition_report(
        from_date=from_date,
        to_date=to_date,
        affiliate_id=affiliate_id,
        campaign_id=campaign_id,
    )
    return {"overview": report["overview"]}


@router.get("/admin/acquisition/campaigns")
async def admin_acquisition_campaigns(
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    affiliate_id: str | None = Query(default=None),
    campaign_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    return await get_acquisition_report(
        from_date=from_date,
        to_date=to_date,
        affiliate_id=affiliate_id,
        campaign_id=campaign_id,
    )


@router.get("/admin/acquisition/campaigns/{campaign_id}")
async def admin_acquisition_campaign(
    campaign_id: str,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    if not await get_campaign(campaign_id):
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    report = await get_acquisition_report(from_date=from_date, to_date=to_date, campaign_id=campaign_id)
    row = report["rows"][0] if report["rows"] else None
    return {"campaign": row, "overview": report["overview"]}
