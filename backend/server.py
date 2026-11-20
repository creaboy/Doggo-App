from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pymongo.uri_parser import parse_uri
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
import hashlib
import secrets
import json
from datetime import datetime, timezone, timedelta
from route_geometry import validate_loop, meters
from walking_routing import snap_points, match_points
from dog_profiles import DogProfile, normalize_photo
from social import member_view, social_router

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / ".env.local")

mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
client = AsyncIOMotorClient(mongo_url)
db_name = os.environ.get("DB_NAME", "doggo_db")
db = client[db_name]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ============ Models ============

class RouteSegment(BaseModel):
    coordinates: List[List[float]]  # [[lat, lng], ...]
    freedom: Literal["free", "caution", "leash"] = "free"
    off_path: bool = False
    features: List[Literal["shade", "water", "swimming", "parking", "low_traffic", "easy_path", "quiet"]] = Field(default_factory=list)
    interests: List[Literal["water", "swimming", "parking", "viewpoint", "trash", "other"]] = Field(default_factory=list)
    dangers: List[Literal["cars", "crossing", "caterpillars", "boars", "livestock", "aggressive_dogs", "toxic", "hunting", "path_closed", "dogs_prohibited", "other"]] = Field(default_factory=list)
    notes: str = Field(default="", max_length=3000)


class PoiInput(BaseModel):
    type: Literal["water", "swimming", "parking", "viewpoint", "trash", "other"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    description: str = Field(default="", max_length=3000)


class HazardInput(PoiInput):
    type: Literal["cars", "crossing", "caterpillars", "boars", "livestock", "aggressive_dogs", "toxic", "hunting", "path_closed", "dogs_prohibited", "event", "other"]


class VariantCreate(BaseModel):
    name: str = Field(pattern=r"^[B-Z]$")
    duration_min: Optional[int] = Field(default=None, ge=1)
    segments: List[RouteSegment]
    pois: List[PoiInput] = Field(default_factory=list, max_length=200)
    hazards: List[HazardInput] = Field(default_factory=list, max_length=200)


class RouteVariant(VariantCreate):
    distance_km: float
    off_leash_pct: int


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
        "aggressive_dogs", "toxic", "hunting", "path_closed", "dogs_prohibited", "event", "other"
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
    variants: List[RouteVariant] = Field(default_factory=list)
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
    pois: List[PoiInput] = Field(default_factory=list, max_length=200)
    hazards: List[HazardInput] = Field(default_factory=list, max_length=200)
    variants: List[VariantCreate] = Field(default_factory=list, max_length=25)


class WalkEdit(WalkCreate):
    edit_revision: str = Field(max_length=40)


class WalkFeedback(BaseModel):
    accurate: bool
    variant: str = Field(default="A", pattern=r"^[A-Z]$")
    route_revision: Optional[str] = Field(default=None, max_length=40)
    change_type: Optional[Literal["new_hazard", "path_inaccessible", "rules_changed", "hazard_disappeared", "new_poi", "other"]] = None
    note: str = Field(default="", max_length=500)


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


def is_admin(user):
    ids = os.getenv("DOGGO_ADMIN_USER_IDS", "").split(",")
    return bool(user and user["user_id"] in {value.strip() for value in ids if value.strip()})


async def admin_user(user=Depends(current_user)):
    if not is_admin(user):
        raise HTTPException(403, "Accès réservé aux administrateurs.")
    return user


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
    return {"session_token": token, "user": {"user_id": user["user_id"], "email": user["email"], "username": user["username"],
                                             "picture": user.get("picture"), "can_moderate": is_admin(user)}}


@api_router.get("/auth/me")
async def me(user=Depends(current_user)):
    return {**user, "can_moderate": is_admin(user)}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ============ Walks ============

def route_revisions(walk):
    return {"A": walk.get("route_revision", "initial"),
            **{v["name"]: v.get("route_revision", "initial") for v in walk.get("variants", [])}}


def current_confirmation_stages():
    # Match the revision of the exact loop, including older routes without a revision field.
    matching_variants = {"$filter": {"input": {"$ifNull": ["$walk.variants", []]}, "as": "variant",
                                     "cond": {"$eq": ["$$variant.name", "$variant"]}}}
    variant_revision = {"$arrayElemAt": [{"$map": {"input": matching_variants, "as": "route",
                                                  "in": {"$ifNull": ["$$route.route_revision", "initial"]}}}, 0]}
    return [
        {"$lookup": {"from": "walks", "localField": "walk_id", "foreignField": "id", "as": "walk",
                     "pipeline": [{"$project": {"_id": 0, "moderation_status": 1, "route_revision": 1,
                                                "variants.name": 1, "variants.route_revision": 1}}]}},
        {"$unwind": "$walk"},
        {"$match": {"walk.moderation_status": {"$ne": "hidden"}, "$expr": {"$eq": ["$route_revision", {
            "$cond": [{"$eq": ["$variant", "A"]}, {"$ifNull": ["$walk.route_revision", "initial"]}, variant_revision],
        }]}}},
    ]


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
    q: dict = {"rating_avg": {"$gte": min_rating}, "moderation_status": {"$ne": "hidden"}}
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
    walks = await db.walks.find(q, {"_id": 0, "moderation_note": 0}).to_list(500)
    if walks:
        latest = await db.walk_confirmations.aggregate([
            {"$match": {"accurate": True, "route_revision": {"$exists": True}, "walk_id": {"$in": [walk["id"] for walk in walks]}}},
            *current_confirmation_stages(),
            {"$group": {"_id": "$walk_id", "latest": {"$max": "$created_at"}}},
        ]).to_list(len(walks))
        by_walk = {row["_id"]: row["latest"] for row in latest}
        for walk in walks:
            walk["last_verified_at"] = by_walk.get(walk["id"])
    return walks


@api_router.get("/walks/{walk_id}")
async def get_walk(walk_id: str, user=Depends(optional_user)):
    walk = await db.walks.find_one({"id": walk_id}, {"_id": 0})
    if not walk or (walk.get("moderation_status") == "hidden"
                    and not (user and (walk.get("created_by") == user["user_id"] or is_admin(user)))):
        raise HTTPException(status_code=404, detail="Walk not found")
    creator = walk.get("created_by")
    if not user or (creator != user["user_id"] and not is_admin(user)):
        walk.pop("moderation_note", None)
    has_visible_dog = bool(user and creator and await db.dog_profiles.find_one({"_id": creator, "visible": True}, {"_id": 1}))
    pois = await db.pois.find({"walk_id": walk_id}, {"_id": 0}).to_list(200)
    hazards = await db.hazards.find({"walk_id": walk_id}, {"_id": 0}).to_list(200)
    comments = await db.comments.find({"walk_id": walk_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    routes = [{"variant": name, "route_revision": revision} for name, revision in route_revisions(walk).items()]
    since = datetime.now(timezone.utc) - timedelta(days=30)
    counts = await db.walk_confirmations.aggregate([
        {"$match": {"walk_id": walk_id, "accurate": True, "$or": routes}},
        {"$group": {"_id": {"variant": "$variant", "user": "$user_id"}, "latest": {"$max": "$created_at"}}},
        {"$group": {"_id": "$_id.variant", "latest": {"$max": "$latest"},
                    "people_30d": {"$sum": {"$cond": [{"$gte": ["$latest", since]}, 1, 0]}}}},
    ]).to_list(26)
    verification = {row["_id"]: {"last_confirmed_at": row["latest"], "people_30d": row["people_30d"]} for row in counts}
    reported = await db.walk_reports.distinct("variant", {"walk_id": walk_id, "status": "open", "$or": routes})
    favorited = False
    if user:
        fav = await db.favorites.find_one({"user_id": user["user_id"], "walk_id": walk_id})
        favorited = fav is not None
    return {"walk": walk, "pois": pois, "hazards": hazards, "comments": comments,
            "confirmations_30d": verification.get("A", {}).get("people_30d", 0), "verification": verification,
            "reported_variants": reported, "can_edit": bool(user and creator == user["user_id"]),
            "favorited": favorited, "has_visible_dog": has_visible_dog}


@api_router.get("/me/dog", response_model=Optional[DogProfile])
async def my_dog(user=Depends(current_user)):
    return await db.dog_profiles.find_one({"_id": user["user_id"]}, {"_id": 0})


@api_router.put("/me/dog", response_model=DogProfile)
async def save_my_dog(profile: DogProfile, user=Depends(current_user)):
    fields = profile.model_dump()
    if profile.photo_jpeg is not None:
        current = await db.dog_profiles.find_one({"_id": user["user_id"]}, {"photo_jpeg": 1})
        if not current or current.get("photo_jpeg") != profile.photo_jpeg:
            try:
                fields["photo_jpeg"] = await run_in_threadpool(normalize_photo, profile.photo_jpeg)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
    await db.dog_profiles.replace_one({"_id": user["user_id"]}, fields, upsert=True)
    return fields


@api_router.get("/members/{member_id}/dog")
async def member_dog(member_id: str, user=Depends(current_user)):
    dog = await db.dog_profiles.find_one({"_id": member_id, "visible": True}, {"_id": 0})
    if not dog:
        raise HTTPException(404, "Aucune fiche chien partagée.")
    member = await db.users.find_one({"user_id": member_id}, {"_id": 0, "user_id": 1, "username": 1, "social": 1})
    if not member:
        raise HTTPException(404, "Aucune fiche chien partagée.")
    owner = member_view({**member, "user_id": member_id})
    return {"owner_name": owner["name"], "owner_bio": owner["bio"], "dog": DogProfile.model_validate(dog).model_dump(exclude={"visible"})}


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


def prepare_walk(inp: WalkCreate, user):
    if not inp.title.strip() or inp.duration_min < 1:
        raise HTTPException(422, "Un titre et une durée positive sont requis.")
    try:
        validate_loop(inp.segments)
        names = set()
        for variant in inp.variants:
            validate_loop(variant.segments)
            if variant.name in names:
                raise ValueError("Chaque variante doit avoir une lettre différente.")
            names.add(variant.name)
            if meters(inp.segments[0].coordinates[0], variant.segments[0].coordinates[0]) > 0.01:
                raise ValueError("Les variantes doivent partir du même point que l’itinéraire A.")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
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
        variants=[RouteVariant(**v.model_dump(), distance_km=_compute_distance(v.segments),
                               off_leash_pct=_compute_off_leash_pct(v.segments)) for v in inp.variants],
        features=inp.features,
        created_by=user["user_id"],
        creator_name=user["username"],
    )
    return walk


@api_router.post("/walks")
async def create_walk(inp: WalkCreate, user=Depends(current_user)):
    walk = prepare_walk(inp, user)
    d = walk.model_dump()
    await db.walks.insert_one(d)
    # insert POIs / hazards
    for p in inp.pois:
        poi = PointOfInterest(walk_id=walk.id, **p.model_dump(), created_by=user["user_id"])
        await db.pois.insert_one(poi.model_dump())
    for hz in inp.hazards:
        h = Hazard(walk_id=walk.id, **hz.model_dump(), created_by=user["user_id"],
                   creator_name=user["username"])
        await db.hazards.insert_one(h.model_dump())
    return clean(d)


def update_route_revision(prior, updated, rules_changed):
    segments = [RouteSegment.model_validate(segment).model_dump() for segment in prior.get("segments", [])]
    if rules_changed or segments != updated["segments"]:
        updated["route_revision"] = uuid.uuid4().hex
    elif "route_revision" in prior:
        updated["route_revision"] = prior["route_revision"]


def revision_filter(field, revision):
    if revision != "initial":
        return {field: revision}
    return {"$or": [{field: revision}, {field: {"$exists": False}}]}


@api_router.put("/walks/{walk_id}")
async def edit_walk(walk_id: str, inp: WalkEdit, user=Depends(current_user)):
    existing = await db.walks.find_one({"id": walk_id})
    if not existing:
        raise HTTPException(404, "Balade introuvable.")
    if existing.get("created_by") != user["user_id"]:
        raise HTTPException(403, "Seul l’auteur peut modifier cette balade.")
    updates = prepare_walk(inp, user).model_dump(exclude={
        "id", "created_by", "creator_name", "created_at", "rating_avg", "rating_count", "last_verified_at",
    })
    previous_segment_features = {feature for segment in existing.get("segments", []) for feature in segment.get("features", [])}
    updates["features"] = list(dict.fromkeys([
        *updates["features"], *(feature for feature in existing.get("features", []) if feature not in previous_segment_features),
    ]))
    old_variants = {variant["name"]: variant for variant in existing.get("variants", [])}
    rules_changed = existing.get("dog_freedom", "free") != updates["dog_freedom"]
    update_route_revision(existing, updates, rules_changed)
    for variant in updates["variants"]:
        prior = old_variants.get(variant["name"], {})
        variant["pois"] = prior.get("pois", [])
        variant["hazards"] = prior.get("hazards", [])
        update_route_revision(prior, variant, rules_changed)
    updates["edit_revision"] = uuid.uuid4().hex
    result = await db.walks.update_one(
        {"id": walk_id, "created_by": user["user_id"], **revision_filter("edit_revision", inp.edit_revision)},
        {"$set": updates},
    )
    if not result.matched_count:
        raise HTTPException(409, "La balade a changé depuis l’ouverture de cette fiche. Rouvrez-la pour repartir de la dernière version.")
    return {"id": walk_id}


# ============ Ratings ============

@api_router.post("/walks/{walk_id}/rate")
async def rate(walk_id: str, body: dict, user=Depends(current_user)):
    stars = int(body.get("stars", 0))
    if stars < 1 or stars > 5:
        raise HTTPException(status_code=400, detail="Invalid stars")
    walk = await db.walks.find_one({"id": walk_id, "moderation_status": {"$ne": "hidden"}})
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

async def require_visible_walk(walk_id):
    if not await db.walks.find_one({"id": walk_id, "moderation_status": {"$ne": "hidden"}}, {"_id": 1}):
        raise HTTPException(404, "Balade introuvable.")


@api_router.post("/walks/{walk_id}/comments")
async def add_comment(walk_id: str, body: dict, user=Depends(current_user)):
    await require_visible_walk(walk_id)
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty comment")
    c = Comment(walk_id=walk_id, user_id=user["user_id"], username=user["username"], text=text)
    await db.comments.insert_one(c.model_dump())
    return clean(c.model_dump())


# ============ Hazards ============

@api_router.post("/walks/{walk_id}/hazards")
async def add_hazard(walk_id: str, body: HazardInput, user=Depends(current_user)):
    await require_visible_walk(walk_id)
    h = Hazard(
        walk_id=walk_id,
        **body.model_dump(),
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
    await require_visible_walk(hz["walk_id"])
    await db.hazards.update_one({"id": hazard_id}, {
        "$inc": {"confirmations": 1},
        "$set": {"last_confirmed_at": datetime.now(timezone.utc), "status": "active"},
    })
    return {"ok": True}


@api_router.post("/hazards/{hazard_id}/resolve")
async def resolve_hazard(hazard_id: str, user=Depends(current_user)):
    hz = await db.hazards.find_one({"id": hazard_id}, {"walk_id": 1})
    if not hz:
        raise HTTPException(404, "Signalement introuvable")
    await require_visible_walk(hz["walk_id"])
    result = await db.hazards.update_one({"id": hazard_id}, {
        "$set": {"status": "resolved", "last_confirmed_at": datetime.now(timezone.utc)},
    })
    if not result.matched_count:
        raise HTTPException(404, "Signalement introuvable")
    return {"ok": True}


@api_router.post("/walks/{walk_id}/variants/{variant}/hazards/{index}/{action}")
async def update_variant_hazard(walk_id: str, variant: str, index: int,
                                action: Literal["confirm", "resolve"], user=Depends(current_user)):
    # Existing variants store their original reports inline. Their order is fixed.
    if index < 0 or index >= 200:
        raise HTTPException(404, "Signalement introuvable")
    field = f"variants.$.hazards.{index}"
    changes = {"$set": {f"{field}.status": "active" if action == "confirm" else "resolved",
                        f"{field}.last_confirmed_at": datetime.now(timezone.utc)}}
    if action == "confirm":
        changes["$inc"] = {f"{field}.confirmations": 1}
    result = await db.walks.update_one(
        {"id": walk_id, "moderation_status": {"$ne": "hidden"},
         "variants": {"$elemMatch": {"name": variant, f"hazards.{index}.type": {"$exists": True}}}},
        changes,
    )
    if not result.matched_count:
        raise HTTPException(404, "Signalement introuvable")
    return {"ok": True}


# ============ POIs ============

@api_router.post("/walks/{walk_id}/pois")
async def add_poi(walk_id: str, body: dict, user=Depends(current_user)):
    await require_visible_walk(walk_id)
    p = PointOfInterest(
        walk_id=walk_id, type=body["type"], lat=body["lat"], lng=body["lng"],
        description=body.get("description", ""), created_by=user["user_id"],
    )
    await db.pois.insert_one(p.model_dump())
    return clean(p.model_dump())


# ============ Walk confirmation ============

@api_router.post("/walks/{walk_id}/confirm")
async def confirm_walk(walk_id: str, body: WalkFeedback, user=Depends(current_user)):
    walk = await db.walks.find_one({"id": walk_id, "moderation_status": {"$ne": "hidden"}})
    revision = route_revisions(walk).get(body.variant) if walk else None
    if revision is None:
        raise HTTPException(404, "Itinéraire introuvable.")
    if body.route_revision != revision and (body.route_revision is not None or revision != "initial"):
        raise HTTPException(409, "Le parcours a été modifié. Rouvrez la balade pour vérifier la nouvelle version.")
    identity = json.dumps([walk_id, revision, body.variant, user["user_id"]])
    fields = {"walk_id": walk_id, "variant": body.variant, "route_revision": revision, "user_id": user["user_id"]}
    now = datetime.now(timezone.utc)
    if body.accurate and user["user_id"] == walk.get("created_by"):
        raise HTTPException(403, "Les confirmations sont réservées aux autres marcheurs.")
    if body.accurate:
        await db.walk_confirmations.update_one({"_id": identity}, {
            "$set": {**fields, "accurate": True, "created_at": now},
            "$setOnInsert": {"id": uuid.uuid4().hex},
        }, upsert=True)
    else:
        reason = body.change_type or "other"
        await db.walk_reports.update_one({"_id": json.dumps([identity, reason])}, {
            "$set": {**fields, "change_type": reason, "note": body.note.strip(), "reported_at": now, "status": "open"},
            "$setOnInsert": {"id": uuid.uuid4().hex},
        }, upsert=True)
        await db.walk_confirmations.delete_one({"_id": identity})
    return {"ok": True}


@api_router.get("/admin/walk-reports")
async def walk_reports(user=Depends(admin_user)):
    reports = await db.walk_reports.find({"status": "open"}, {"_id": 0, "user_id": 0}).sort("reported_at", -1).to_list(200)
    fields = {"_id": 0, "id": 1, "title": 1, "edit_revision": 1, "route_revision": 1,
              "moderation_status": 1, "moderation_note": 1, "variants.name": 1, "variants.route_revision": 1}
    moderated = await db.walks.find({"moderation_status": {"$in": ["correction_requested", "hidden"]}},
                                    fields).to_list(200)
    reported = await db.walks.find({"id": {"$in": [item["walk_id"] for item in reports]}},
                                    fields).to_list(200)
    return {"reports": reports, "walks": list({walk["id"]: walk for walk in [*moderated, *reported]}.values())}


class ModerationAction(BaseModel):
    status: Literal["published", "correction_requested", "hidden"]
    edit_revision: str = Field(max_length=40)
    note: str = Field(default="", max_length=500)


@api_router.put("/admin/walks/{walk_id}/moderation")
async def moderate_walk(walk_id: str, body: ModerationAction, user=Depends(admin_user)):
    if body.status == "correction_requested" and not body.note.strip():
        raise HTTPException(422, "Précisez la correction à apporter.")
    result = await db.walks.update_one({"id": walk_id, **revision_filter("edit_revision", body.edit_revision)},
                                       {"$set": {"moderation_status": body.status, "edit_revision": uuid.uuid4().hex,
                                                 "moderation_note": "" if body.status == "published" else body.note.strip()}})
    if not result.matched_count:
        raise HTTPException(409, "La balade a changé. Rechargez les signalements.")
    return {"ok": True}


@api_router.post("/admin/walk-reports/{report_id}/dismiss")
async def dismiss_walk_report(report_id: str, user=Depends(admin_user)):
    result = await db.walk_reports.update_one({"id": report_id, "status": "open"}, {"$set": {"status": "closed"}})
    if not result.matched_count:
        raise HTTPException(404, "Signalement introuvable.")
    return {"ok": True}


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
    await require_visible_walk(walk_id)
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
    walks = await db.walks.find({"id": {"$in": ids}, "moderation_status": {"$ne": "hidden"}}, {"_id": 0, "moderation_note": 0}).to_list(500)
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
    walks = await db.walks.find({"id": {"$in": ids}, "moderation_status": {"$ne": "hidden"}}, {"_id": 0, "id": 1, "title": 1}).to_list(500)
    title_by_id = {w["id"]: w["title"] for w in walks}
    hazards = [hazard for hazard in hazards if hazard["walk_id"] in title_by_id]
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
    new_walks = await db.walks.find({"created_at": {"$gte": since}, "moderation_status": {"$ne": "hidden"}},
                                    {"_id": 0, "moderation_note": 0}).sort("created_at", -1).to_list(500)
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
    walks = await db.walks.find({"id": {"$in": walk_ids}, "moderation_status": {"$ne": "hidden"}}, {"_id": 0, "id": 1, "title": 1, "start_lat": 1, "start_lng": 1}).to_list(500)
    title_by = {w["id"]: w for w in walks}
    recent_hazards = [hazard for hazard in recent_hazards if hazard["walk_id"] in title_by]
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
        {"$match": {"created_at": {"$gte": since}, "accurate": True, "route_revision": {"$exists": True}}},
        *current_confirmation_stages(),
        {"$group": {"_id": {"walk": "$walk_id", "member": "$user_id"}, "last": {"$max": "$created_at"}}},
        {"$group": {"_id": "$_id.walk", "count": {"$sum": 1}, "last": {"$max": "$last"}}},
        {"$sort": {"count": -1}},
        {"$limit": 20},
    ])
    conf_groups = await conf_cursor.to_list(50)
    conf_walk_ids = [c["_id"] for c in conf_groups]
    conf_walks = await db.walks.find({"id": {"$in": conf_walk_ids}, "moderation_status": {"$ne": "hidden"}},
                                     {"_id": 0, "title": 1, "id": 1, "environment": 1, "start_lat": 1, "start_lng": 1}).to_list(50)
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


# ============ Pedestrian routing ============

class SnapInput(BaseModel):
    points: List[List[float]]  # [[lat, lng], ...]
    profile: Literal["foot", "bike", "car"] = "foot"
    alternatives: bool = False


@api_router.post("/routing/snap")
async def snap_route(inp: SnapInput):
    return await snap_points(inp.points, inp.profile, inp.alternatives)


class MatchInput(BaseModel):
    points: List[List[float]]
    timestamps: List[int]
    accuracies: List[float]
    start_anchor: List[float]


@api_router.post("/routing/match")
async def match_gps(inp: MatchInput):
    return await match_points(inp.points, inp.timestamps, inp.accuracies, inp.start_anchor)


@api_router.get("/")
async def root():
    return {"message": "Doggo API"}


# ============ Seed ============

SEED_VERSION = 2


async def _snap_via_osrm(points: List[List[float]], profile: str = "foot") -> Optional[List[List[float]]]:
    """Seed demo walks through the same router as user-created walks, best effort."""
    try:
        return (await snap_points(points, profile))["coordinates"]
    except HTTPException as exc:
        logger.warning("Demo route unavailable: %s", exc.detail)
        return None


async def _snap_segments(segments: List[dict]) -> List[dict]:
    out = []
    for seg in segments:
        snapped = await _snap_via_osrm(seg["coordinates"], profile="foot")
        out.append({"freedom": seg["freedom"], "coordinates": snapped or seg["coordinates"]})
    return out


async def seed_friend_accounts():
    # Shared demo credentials are enabled by the dev launcher for local MongoDB only.
    if os.getenv("DOGGO_SEED_FRIENDS") != "1" or not mongo_url.startswith("mongodb://"):
        return
    hosts = parse_uri(mongo_url)["nodelist"]
    if not hosts or any(host not in {"localhost", "127.0.0.1", "::1"} for host, _ in hosts):
        return

    now = datetime.now(timezone.utc)
    password_hash = hash_password("BaladeDemo26!")
    for name, initial, bio in [
        ("Camille", "R", "J’aime les balades en forêt avec Rio."),
        ("Nina", "L", "Je marche surtout le week-end avec Oslo."),
        ("Hugo", "M", "Toujours partant pour découvrir un nouveau chemin avec Nox."),
    ]:
        user_id = f"user_friend_demo_{name.lower()}"
        email = f"{name.lower()}.demo@example.com"
        try:
            await db.users.update_one(
                {"user_id": user_id},
                {"$setOnInsert": {
                    "user_id": user_id, "email": email, "username": f"{name} {initial}.",
                    "password_hash": password_hash, "picture": None, "created_at": now,
                    "social": {"first_name": name, "area": "Paris", "area_key": "paris", "bio": bio, "share_walks": False},
                }},
                upsert=True,
            )
        except DuplicateKeyError:
            logger.warning("Demo account skipped because its email is already in use: %s", email)


async def seed_data():
    version_doc = await db.config.find_one({"key": "seed_version"})
    current_version = version_doc["value"] if version_doc else 0
    demo_id = "user_demo0001"

    if current_version >= SEED_VERSION:
        return

    logger.info(f"Seeding demo data (v{SEED_VERSION})...")

    # Wipe previously seeded walks + child records (preserve user-created walks)
    old = await db.walks.find({"created_by": demo_id}, {"_id": 0, "id": 1}).to_list(500)
    old_ids = [w["id"] for w in old]
    if old_ids:
        await db.walks.delete_many({"id": {"$in": old_ids}})
        await db.pois.delete_many({"walk_id": {"$in": old_ids}})
        await db.hazards.delete_many({"walk_id": {"$in": old_ids}})
        await db.ratings.delete_many({"walk_id": {"$in": old_ids}})
        await db.comments.delete_many({"walk_id": {"$in": old_ids}})
        await db.walk_confirmations.delete_many({"walk_id": {"$in": old_ids}})
        await db.favorites.delete_many({"walk_id": {"$in": old_ids}})

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
                # 4 corners of Parc Montsouris — OSRM will snap along real park paths
                {"freedom": "leash", "coordinates": [
                    [48.8215, 2.3355],  # SW entrance (Bd Jourdan / rue Nansouty)
                    [48.8225, 2.3355],  # west side path
                    [48.8237, 2.3380],  # north-west, near lake
                    [48.8237, 2.3410],  # north-east side
                    [48.8225, 2.3418],  # east side
                    [48.8215, 2.3395],  # south side
                    [48.8215, 2.3355],  # back to start
                ]},
            ],
            "pois": [
                {"type": "water", "lat": 48.8231, "lng": 2.3393, "description": "Fontaine potable près du lac"},
                {"type": "trash", "lat": 48.8221, "lng": 2.3370, "description": "Sacs à déjections"},
            ],
            "hazards": [
                {"type": "dogs_prohibited", "lat": 48.8228, "lng": 2.3405, "description": "Aire de jeux interdite"},
            ],
        },
        {
            "title": "Côte sauvage de Quiberon",
            "description": "Balade côtière avec accès baignade pour chien à mi-parcours.",
            "duration_min": 90, "difficulty": "sporty", "environment": "beach", "dog_freedom": "partial",
            "features": ["water", "swimming", "parking"],
            "segments": [
                # Real coastal path along Côte Sauvage west side
                {"freedom": "free", "coordinates": [
                    [47.5090, -3.1370], [47.5120, -3.1380], [47.5150, -3.1385],
                ]},
                {"freedom": "caution", "coordinates": [
                    [47.5150, -3.1385], [47.5175, -3.1370],
                ]},
                {"freedom": "leash", "coordinates": [
                    [47.5175, -3.1370], [47.5200, -3.1350],
                ]},
            ],
            "pois": [
                {"type": "swimming", "lat": 47.5150, "lng": -3.1385, "description": "Petite crique baignade chien"},
                {"type": "parking", "lat": 47.5088, "lng": -3.1365, "description": "Parking Port Bara"},
                {"type": "viewpoint", "lat": 47.5175, "lng": -3.1370, "description": "Vue sur l'océan"},
            ],
            "hazards": [
                {"type": "cars", "lat": 47.5200, "lng": -3.1350, "description": "Route côtière fréquentée"},
            ],
        },
    ]

    for i, w in enumerate(walks_seed):
        # Snap segments to real paths (best-effort; falls back to hand-drawn coords)
        snapped_segs = await _snap_segments(w["segments"])
        segs = [RouteSegment(**s) for s in snapped_segs]
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

    await db.config.update_one({"key": "seed_version"}, {"$set": {"value": SEED_VERSION}}, upsert=True)
    logger.info(f"Seed complete (v{SEED_VERSION}).")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.walks.create_index("id", unique=True)
    await db.walk_confirmations.create_index([("walk_id", 1), ("route_revision", 1), ("accurate", 1)])
    await db.walk_reports.create_index([("walk_id", 1), ("route_revision", 1), ("status", 1)])
    await db.walk_reports.create_index([("status", 1), ("reported_at", -1)])
    await db.friendships.create_index("members")
    await db.users.create_index("social.area_key", sparse=True)
    await seed_friend_accounts()
    await seed_data()


api_router.include_router(social_router(lambda: db, current_user))
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
