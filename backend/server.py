from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
import hashlib
import secrets
import httpx
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ============ Models ============

class RouteSegment(BaseModel):
    coordinates: List[List[float]]  # [[lat, lng], ...]
    freedom: Literal["free", "caution", "leash"] = "free"


class PointOfInterest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    walk_id: str
    type: Literal["water", "swimming", "parking", "viewpoint", "trash", "other"]
    lat: float
    lng: float
    description: Optional[str] = ""
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Hazard(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    walk_id: str
    type: Literal[
        "cars", "crossing", "caterpillars", "boars", "livestock",
        "aggressive_dogs", "toxic", "hunting", "path_closed", "dogs_prohibited", "other"
    ]
    lat: float
    lng: float
    description: Optional[str] = ""
    status: Literal["active", "resolved"] = "active"
    created_by: Optional[str] = None
    creator_name: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_confirmed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    confirmations: int = 0
    expires_at: Optional[datetime] = None  # for later auto-expiry


class Walk(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: Optional[str] = ""
    start_lat: float
    start_lng: float
    distance_km: float
    duration_min: int
    difficulty: Literal["easy", "moderate", "sporty"] = "easy"
    environment: Literal["forest", "fields", "city", "beach", "mountain", "mixed"] = "mixed"
    dog_freedom: Literal["free", "partial", "leash"] = "free"
    off_leash_pct: int = 0
    segments: List[RouteSegment] = []
    features: List[str] = []  # shade, water, swimming, parking, low_traffic, easy_path, quiet
    rating_avg: float = 0.0
    rating_count: int = 0
    last_verified_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: Optional[str] = None
    creator_name: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WalkCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    difficulty: Literal["easy", "moderate", "sporty"] = "easy"
    environment: Literal["forest", "fields", "city", "beach", "mountain", "mixed"] = "mixed"
    dog_freedom: Literal["free", "partial", "leash"] = "free"
    duration_min: int
    segments: List[RouteSegment]
    features: List[str] = []
    pois: List[dict] = []
    hazards: List[dict] = []


class Rating(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    walk_id: str
    user_id: str
    username: str
    stars: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Comment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    walk_id: str
    user_id: str
    username: str
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WalkConfirmation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    walk_id: str
    user_id: str
    accurate: bool
    change_type: Optional[str] = None  # new_hazard, path_inaccessible, rules_changed, hazard_disappeared, new_poi, other
    note: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ============ Auth ============

class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    username: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class SessionInput(BaseModel):
    session_id: str


def hash_password(pw: str) -> str:
    salt = "doggo_static_salt_v1"
    return hashlib.sha256((pw + salt).encode()).hexdigest()


def verify_password(pw: str, hashed: str) -> bool:
    return hash_password(pw) == hashed


def gen_token() -> str:
    return secrets.token_urlsafe(32)


async def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def optional_user(authorization: Optional[str] = Header(None)):
    if not authorization:
        return None
    try:
        return await current_user(authorization)
    except HTTPException:
        return None


@api_router.post("/auth/register")
async def register(inp: RegisterInput):
    existing = await db.users.find_one({"email": inp.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": inp.email.lower(),
        "username": inp.username,
        "password_hash": hash_password(inp.password),
        "picture": None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user)
    token = gen_token()
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    return {"session_token": token, "user": {"user_id": user_id, "email": inp.email.lower(), "username": inp.username, "picture": None}}


@api_router.post("/auth/login")
async def login(inp: LoginInput):
    user = await db.users.find_one({"email": inp.email.lower()})
    if not user or not user.get("password_hash") or not verify_password(inp.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = gen_token()
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    return {"session_token": token, "user": {"user_id": user["user_id"], "email": user["email"], "username": user["username"], "picture": user.get("picture")}}


@api_router.post("/auth/session")
async def emergent_session(inp: SessionInput):
    try:
        async with httpx.AsyncClient(timeout=10) as h:
            r = await h.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": inp.session_id},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Emergent session error: {e}")
        raise HTTPException(status_code=401, detail="Auth failed")

    email = data["email"].lower()
    name = data.get("name", email.split("@")[0])
    picture = data.get("picture")
    emergent_token = data["session_token"]

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"username": existing.get("username") or name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "username": name,
            "picture": picture,
            "password_hash": None,
            "created_at": datetime.now(timezone.utc),
        })

    await db.user_sessions.insert_one({
        "session_token": emergent_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    return {"session_token": emergent_token, "user": {"user_id": user_id, "email": email, "username": name, "picture": picture}}


@api_router.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ============ Walks ============

def clean(d: dict) -> dict:
    d.pop("_id", None)
    return d


@api_router.get("/walks")
async def list_walks(
    min_rating: float = 0,
    max_duration: Optional[int] = None,
    min_distance: Optional[float] = None,
    max_distance: Optional[float] = None,
    environment: Optional[str] = None,
    difficulty: Optional[str] = None,
    dog_freedom: Optional[str] = None,
):
    q: dict = {"rating_avg": {"$gte": min_rating}}
    if max_duration:
        q["duration_min"] = {"$lte": max_duration}
    if environment and environment != "all":
        q["environment"] = environment
    if difficulty and difficulty != "all":
        q["difficulty"] = difficulty
    if dog_freedom and dog_freedom != "all":
        q["dog_freedom"] = dog_freedom
    dist = {}
    if min_distance is not None:
        dist["$gte"] = min_distance
    if max_distance is not None:
        dist["$lte"] = max_distance
    if dist:
        q["distance_km"] = dist
    walks = await db.walks.find(q, {"_id": 0}).to_list(500)
    return walks


@api_router.get("/walks/{walk_id}")
async def get_walk(walk_id: str, user=Depends(optional_user)):
    walk = await db.walks.find_one({"id": walk_id}, {"_id": 0})
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found")
    pois = await db.pois.find({"walk_id": walk_id}, {"_id": 0}).to_list(200)
    hazards = await db.hazards.find({"walk_id": walk_id}, {"_id": 0}).to_list(200)
    comments = await db.comments.find({"walk_id": walk_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    confirmations_30d = await db.walk_confirmations.count_documents({
        "walk_id": walk_id,
        "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=30)},
    })
    favorited = False
    if user:
        fav = await db.favorites.find_one({"user_id": user["user_id"], "walk_id": walk_id})
        favorited = fav is not None
    return {"walk": walk, "pois": pois, "hazards": hazards, "comments": comments, "confirmations_30d": confirmations_30d, "favorited": favorited}


def _compute_distance(segments: List[RouteSegment]) -> float:
    from math import radians, sin, cos, sqrt, atan2
    total = 0.0
    for seg in segments:
        pts = seg.coordinates
        for i in range(1, len(pts)):
            lat1, lon1 = pts[i - 1]
            lat2, lon2 = pts[i]
            r = 6371
            dlat = radians(lat2 - lat1)
            dlon = radians(lon2 - lon1)
            a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
            c = 2 * atan2(sqrt(a), sqrt(1 - a))
            total += r * c
    return round(total, 2)


def _compute_off_leash_pct(segments: List[RouteSegment]) -> int:
    from math import radians, sin, cos, sqrt, atan2

    def dist(pts):
        d = 0.0
        for i in range(1, len(pts)):
            lat1, lon1 = pts[i - 1]
            lat2, lon2 = pts[i]
            r = 6371
            dlat = radians(lat2 - lat1)
            dlon = radians(lon2 - lon1)
            a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
            d += r * 2 * atan2(sqrt(a), sqrt(1 - a))
        return d

    total = sum(dist(s.coordinates) for s in segments)
    if total == 0:
        return 0
    free = sum(dist(s.coordinates) for s in segments if s.freedom == "free")
    return int(round((free / total) * 100))


@api_router.post("/walks")
async def create_walk(inp: WalkCreate, user=Depends(current_user)):
    if not inp.segments or not inp.segments[0].coordinates:
        raise HTTPException(status_code=400, detail="Route required")
    distance = _compute_distance(inp.segments)
    off_leash = _compute_off_leash_pct(inp.segments)
    first = inp.segments[0].coordinates[0]
    walk = Walk(
        title=inp.title,
        description=inp.description or "",
        start_lat=first[0],
        start_lng=first[1],
        distance_km=distance,
        duration_min=inp.duration_min,
        difficulty=inp.difficulty,
        environment=inp.environment,
        dog_freedom=inp.dog_freedom,
        off_leash_pct=off_leash,
        segments=inp.segments,
        features=inp.features,
        created_by=user["user_id"],
        creator_name=user["username"],
    )
    d = walk.model_dump()
    await db.walks.insert_one(d)
    # insert POIs / hazards
    for p in inp.pois:
        poi = PointOfInterest(walk_id=walk.id, type=p["type"], lat=p["lat"], lng=p["lng"],
                              description=p.get("description", ""), created_by=user["user_id"])
        await db.pois.insert_one(poi.model_dump())
    for hz in inp.hazards:
        h = Hazard(walk_id=walk.id, type=hz["type"], lat=hz["lat"], lng=hz["lng"],
                   description=hz.get("description", ""), created_by=user["user_id"],
                   creator_name=user["username"])
        await db.hazards.insert_one(h.model_dump())
    return clean(d)


# ============ Ratings ============

@api_router.post("/walks/{walk_id}/rate")
async def rate(walk_id: str, body: dict, user=Depends(current_user)):
    stars = int(body.get("stars", 0))
    if stars < 1 or stars > 5:
        raise HTTPException(status_code=400, detail="Invalid stars")
    walk = await db.walks.find_one({"id": walk_id})
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found")
    await db.ratings.update_one(
        {"walk_id": walk_id, "user_id": user["user_id"]},
        {"$set": {
            "walk_id": walk_id, "user_id": user["user_id"], "username": user["username"],
            "stars": stars, "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    # recompute
    agg = await db.ratings.aggregate([
        {"$match": {"walk_id": walk_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$stars"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    avg = round(agg[0]["avg"], 2) if agg else 0
    count = agg[0]["count"] if agg else 0
    await db.walks.update_one({"id": walk_id}, {"$set": {"rating_avg": avg, "rating_count": count}})
    return {"rating_avg": avg, "rating_count": count}


# ============ Comments ============

@api_router.post("/walks/{walk_id}/comments")
async def add_comment(walk_id: str, body: dict, user=Depends(current_user)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty comment")
    c = Comment(walk_id=walk_id, user_id=user["user_id"], username=user["username"], text=text)
    await db.comments.insert_one(c.model_dump())
    return clean(c.model_dump())


# ============ Hazards ============

@api_router.post("/walks/{walk_id}/hazards")
async def add_hazard(walk_id: str, body: dict, user=Depends(current_user)):
    h = Hazard(
        walk_id=walk_id,
        type=body["type"],
        lat=body["lat"],
        lng=body["lng"],
        description=body.get("description", ""),
        created_by=user["user_id"],
        creator_name=user["username"],
    )
    await db.hazards.insert_one(h.model_dump())
    return clean(h.model_dump())


@api_router.post("/hazards/{hazard_id}/confirm")
async def confirm_hazard(hazard_id: str, user=Depends(current_user)):
    hz = await db.hazards.find_one({"id": hazard_id})
    if not hz:
        raise HTTPException(status_code=404, detail="Not found")
    await db.hazards.update_one({"id": hazard_id}, {
        "$inc": {"confirmations": 1},
        "$set": {"last_confirmed_at": datetime.now(timezone.utc), "status": "active"},
    })
    return {"ok": True}


@api_router.post("/hazards/{hazard_id}/resolve")
async def resolve_hazard(hazard_id: str, user=Depends(current_user)):
    await db.hazards.update_one({"id": hazard_id}, {
        "$set": {"status": "resolved", "last_confirmed_at": datetime.now(timezone.utc)},
    })
    return {"ok": True}


# ============ POIs ============

@api_router.post("/walks/{walk_id}/pois")
async def add_poi(walk_id: str, body: dict, user=Depends(current_user)):
    p = PointOfInterest(
        walk_id=walk_id, type=body["type"], lat=body["lat"], lng=body["lng"],
        description=body.get("description", ""), created_by=user["user_id"],
    )
    await db.pois.insert_one(p.model_dump())
    return clean(p.model_dump())


# ============ Walk confirmation ============

@api_router.post("/walks/{walk_id}/confirm")
async def confirm_walk(walk_id: str, body: dict, user=Depends(current_user)):
    accurate = bool(body.get("accurate", True))
    wc = WalkConfirmation(
        walk_id=walk_id, user_id=user["user_id"], accurate=accurate,
        change_type=body.get("change_type"), note=body.get("note", ""),
    )
    await db.walk_confirmations.insert_one(wc.model_dump())
    if accurate:
        await db.walks.update_one({"id": walk_id}, {"$set": {"last_verified_at": datetime.now(timezone.utc)}})
    return clean(wc.model_dump())


# ============ Profile ============

@api_router.get("/me/walks")
async def my_walks(user=Depends(current_user)):
    walks = await db.walks.find({"created_by": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return walks


@api_router.get("/me/activity")
async def my_activity(user=Depends(current_user)):
    comments = await db.comments.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    ratings = await db.ratings.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"comments": comments, "ratings": ratings}


# ============ Favorites ============

@api_router.post("/walks/{walk_id}/favorite")
async def add_favorite(walk_id: str, user=Depends(current_user)):
    walk = await db.walks.find_one({"id": walk_id})
    if not walk:
        raise HTTPException(status_code=404, detail="Walk not found")
    await db.favorites.update_one(
        {"user_id": user["user_id"], "walk_id": walk_id},
        {"$set": {"user_id": user["user_id"], "walk_id": walk_id, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"favorited": True}


@api_router.delete("/walks/{walk_id}/favorite")
async def remove_favorite(walk_id: str, user=Depends(current_user)):
    await db.favorites.delete_one({"user_id": user["user_id"], "walk_id": walk_id})
    return {"favorited": False}


@api_router.get("/me/favorites")
async def list_favorites(user=Depends(current_user)):
    favs = await db.favorites.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    ids = [f["walk_id"] for f in favs]
    if not ids:
        return []
    walks = await db.walks.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)
    # preserve favorite order
    by_id = {w["id"]: w for w in walks}
    return [by_id[i] for i in ids if i in by_id]


@api_router.get("/me/favorites/hazards")
async def favorites_hazards(user=Depends(current_user)):
    favs = await db.favorites.find({"user_id": user["user_id"]}).to_list(500)
    ids = [f["walk_id"] for f in favs]
    if not ids:
        return []
    hazards = await db.hazards.find(
        {"walk_id": {"$in": ids}, "status": "active"},
        {"_id": 0},
    ).to_list(2000)
    # attach walk title
    walks = await db.walks.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(500)
    title_by_id = {w["id"]: w["title"] for w in walks}
    for h in hazards:
        h["walk_title"] = title_by_id.get(h["walk_id"], "")
    return hazards


# ============ Weekly digest ============

def _haversine_km(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, sqrt, atan2
    r = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return r * 2 * atan2(sqrt(a), sqrt(1 - a))


@api_router.get("/digest")
async def weekly_digest(lat: Optional[float] = None, lng: Optional[float] = None, radius_km: float = 50.0):
    since = datetime.now(timezone.utc) - timedelta(days=7)
    # New walks this week
    new_walks = await db.walks.find({"created_at": {"$gte": since}}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if lat is not None and lng is not None:
        new_walks = [w for w in new_walks if _haversine_km(lat, lng, w["start_lat"], w["start_lng"]) <= radius_km]
        for w in new_walks:
            w["distance_from_you_km"] = round(_haversine_km(lat, lng, w["start_lat"], w["start_lng"]), 1)
    new_walks = new_walks[:20]

    # Recent hazard reports & confirmations this week
    recent_hazards = await db.hazards.find(
        {"$or": [{"created_at": {"$gte": since}}, {"last_confirmed_at": {"$gte": since}}]},
        {"_id": 0},
    ).sort("last_confirmed_at", -1).to_list(200)
    walk_ids = list({h["walk_id"] for h in recent_hazards})
    walks = await db.walks.find({"id": {"$in": walk_ids}}, {"_id": 0, "id": 1, "title": 1, "start_lat": 1, "start_lng": 1}).to_list(500)
    title_by = {w["id"]: w for w in walks}
    for h in recent_hazards:
        w = title_by.get(h["walk_id"], {})
        h["walk_title"] = w.get("title", "")
        if lat is not None and lng is not None and w:
            h["distance_from_you_km"] = round(_haversine_km(lat, lng, w["start_lat"], w["start_lng"]), 1)
    if lat is not None and lng is not None:
        recent_hazards = [h for h in recent_hazards if h.get("distance_from_you_km", 0) <= radius_km]
    recent_hazards = recent_hazards[:30]

    # Walk confirmations this week — count per walk
    conf_cursor = db.walk_confirmations.aggregate([
        {"$match": {"created_at": {"$gte": since}, "accurate": True}},
        {"$group": {"_id": "$walk_id", "count": {"$sum": 1}, "last": {"$max": "$created_at"}}},
        {"$sort": {"count": -1}},
        {"$limit": 20},
    ])
    conf_groups = await conf_cursor.to_list(50)
    conf_walk_ids = [c["_id"] for c in conf_groups]
    conf_walks = await db.walks.find({"id": {"$in": conf_walk_ids}}, {"_id": 0}).to_list(50)
    conf_by = {w["id"]: w for w in conf_walks}
    confirmations = []
    for c in conf_groups:
        w = conf_by.get(c["_id"])
        if not w:
            continue
        entry = {"walk_id": c["_id"], "walk_title": w["title"], "count": c["count"], "last": c["last"], "environment": w["environment"]}
        if lat is not None and lng is not None:
            entry["distance_from_you_km"] = round(_haversine_km(lat, lng, w["start_lat"], w["start_lng"]), 1)
        confirmations.append(entry)
    if lat is not None and lng is not None:
        confirmations = [c for c in confirmations if c.get("distance_from_you_km", 0) <= radius_km]

    return {"new_walks": new_walks, "hazards": recent_hazards, "confirmations": confirmations}


@api_router.get("/")
async def root():
    return {"message": "Doggo API"}


# ============ Seed ============

async def seed_data():
    count = await db.walks.count_documents({})
    if count > 0:
        return
    logger.info("Seeding demo data...")

    # Demo user
    demo_id = "user_demo0001"
    await db.users.update_one(
        {"user_id": demo_id},
        {"$set": {
            "user_id": demo_id, "email": "demo@doggo.app",
            "username": "Marie D.", "picture": None,
            "password_hash": hash_password("demo1234"),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    demo2 = "user_demo0002"
    await db.users.update_one(
        {"user_id": demo2},
        {"$set": {
            "user_id": demo2, "email": "paul@doggo.app",
            "username": "Paul B.", "picture": None,
            "password_hash": hash_password("demo1234"),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    # Center around Paris / Fontainebleau area for variety
    walks_seed = [
        {
            "title": "Boucle en forêt de Fontainebleau",
            "description": "Superbe balade forestière, majoritairement sous les arbres. Points d'eau naturels.",
            "duration_min": 35, "difficulty": "easy", "environment": "forest", "dog_freedom": "free",
            "features": ["shade", "water", "low_traffic", "quiet"],
            "segments": [
                {"freedom": "free", "coordinates": [
                    [48.4053, 2.7010], [48.4062, 2.7025], [48.4075, 2.7040],
                    [48.4085, 2.7055], [48.4095, 2.7070], [48.4088, 2.7088],
                    [48.4072, 2.7080], [48.4058, 2.7060], [48.4053, 2.7010],
                ]},
            ],
            "pois": [
                {"type": "water", "lat": 48.4075, "lng": 2.7040, "description": "Ruisseau frais"},
                {"type": "parking", "lat": 48.4051, "lng": 2.7008, "description": "Parking gratuit"},
            ],
            "hazards": [
                {"type": "caterpillars", "lat": 48.4085, "lng": 2.7055, "description": "Chenilles processionnaires observées en mars"},
            ],
        },
        {
            "title": "Boucle campagne du Vexin",
            "description": "Grande boucle champêtre. Quelques passages près de routes.",
            "duration_min": 75, "difficulty": "moderate", "environment": "fields", "dog_freedom": "partial",
            "features": ["low_traffic", "quiet"],
            "segments": [
                {"freedom": "free", "coordinates": [
                    [49.0850, 1.7500], [49.0870, 1.7520], [49.0895, 1.7540], [49.0915, 1.7565],
                ]},
                {"freedom": "caution", "coordinates": [
                    [49.0915, 1.7565], [49.0925, 1.7590], [49.0910, 1.7615],
                ]},
                {"freedom": "free", "coordinates": [
                    [49.0910, 1.7615], [49.0885, 1.7605], [49.0860, 1.7580], [49.0850, 1.7500],
                ]},
            ],
            "pois": [
                {"type": "viewpoint", "lat": 49.0925, "lng": 1.7590, "description": "Panorama sur les champs"},
            ],
            "hazards": [
                {"type": "livestock", "lat": 49.0895, "lng": 1.7540, "description": "Vaches en pâture, tenir en laisse"},
                {"type": "hunting", "lat": 49.0870, "lng": 1.7520, "description": "Chasse le dimanche en saison"},
            ],
        },
        {
            "title": "Parc Montsouris urbain",
            "description": "Balade urbaine en parc parisien. Laisse obligatoire partout.",
            "duration_min": 45, "difficulty": "easy", "environment": "city", "dog_freedom": "leash",
            "features": ["water", "shade"],
            "segments": [
                {"freedom": "leash", "coordinates": [
                    [48.8221, 2.3378], [48.8225, 2.3390], [48.8232, 2.3400], [48.8240, 2.3395],
                    [48.8242, 2.3378], [48.8235, 2.3368], [48.8221, 2.3378],
                ]},
            ],
            "pois": [
                {"type": "water", "lat": 48.8232, "lng": 2.3400, "description": "Fontaine potable"},
                {"type": "trash", "lat": 48.8225, "lng": 2.3390, "description": "Sacs à déjections"},
            ],
            "hazards": [
                {"type": "dogs_prohibited", "lat": 48.8240, "lng": 2.3395, "description": "Aire de jeux interdite"},
            ],
        },
        {
            "title": "Côte sauvage de Quiberon",
            "description": "Balade côtière avec accès baignade pour chien à mi-parcours.",
            "duration_min": 90, "difficulty": "sporty", "environment": "beach", "dog_freedom": "partial",
            "features": ["water", "swimming", "parking"],
            "segments": [
                {"freedom": "free", "coordinates": [
                    [47.4870, -3.1300], [47.4890, -3.1310], [47.4910, -3.1325], [47.4930, -3.1340],
                ]},
                {"freedom": "caution", "coordinates": [
                    [47.4930, -3.1340], [47.4955, -3.1330], [47.4970, -3.1315],
                ]},
                {"freedom": "leash", "coordinates": [
                    [47.4970, -3.1315], [47.4980, -3.1290], [47.4970, -3.1270],
                ]},
            ],
            "pois": [
                {"type": "swimming", "lat": 47.4930, "lng": -3.1340, "description": "Petite crique baignade chien"},
                {"type": "parking", "lat": 47.4868, "lng": -3.1298, "description": "Parking payant l'été"},
                {"type": "viewpoint", "lat": 47.4970, "lng": -3.1315, "description": "Vue sur l'océan"},
            ],
            "hazards": [
                {"type": "cars", "lat": 47.4970, "lng": -3.1290, "description": "Route côtière fréquentée"},
            ],
        },
    ]

    for i, w in enumerate(walks_seed):
        segs = [RouteSegment(**s) for s in w["segments"]]
        first = segs[0].coordinates[0]
        walk = Walk(
            title=w["title"], description=w["description"],
            start_lat=first[0], start_lng=first[1],
            distance_km=_compute_distance(segs),
            duration_min=w["duration_min"], difficulty=w["difficulty"],
            environment=w["environment"], dog_freedom=w["dog_freedom"],
            off_leash_pct=_compute_off_leash_pct(segs),
            segments=segs, features=w["features"],
            created_by=demo_id, creator_name="Marie D.",
            last_verified_at=datetime.now(timezone.utc) - timedelta(days=i * 2 + 1),
        )
        d = walk.model_dump()
        await db.walks.insert_one(d)
        for p in w["pois"]:
            poi = PointOfInterest(walk_id=walk.id, **p, created_by=demo_id)
            await db.pois.insert_one(poi.model_dump())
        for hz in w["hazards"]:
            h = Hazard(walk_id=walk.id, **hz, created_by=demo_id, creator_name="Marie D.",
                       confirmations=2, last_confirmed_at=datetime.now(timezone.utc) - timedelta(days=1))
            await db.hazards.insert_one(h.model_dump())

        # Seed ratings + comments
        stars_list = [5, 4, 5]
        for s in stars_list:
            await db.ratings.insert_one(Rating(walk_id=walk.id, user_id=demo2, username="Paul B.", stars=s).model_dump())
        avg = sum(stars_list) / len(stars_list)
        await db.walks.update_one({"id": walk.id}, {"$set": {"rating_avg": round(avg, 2), "rating_count": len(stars_list)}})
        await db.comments.insert_one(Comment(
            walk_id=walk.id, user_id=demo2, username="Paul B.",
            text="Super balade, mon chien a adoré ! Parking facile."
        ).model_dump())
        await db.walk_confirmations.insert_one(WalkConfirmation(
            walk_id=walk.id, user_id=demo2, accurate=True,
        ).model_dump())

    logger.info("Seed complete.")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.walks.create_index("id", unique=True)
    await seed_data()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
