from datetime import datetime, timedelta, timezone
import json
import re
import unicodedata
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError


class SocialProfile(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    first_name: str = Field(default="", max_length=40)
    bio: str = Field(default="", max_length=240)
    area: str = Field(default="", max_length=80)
    share_walks: bool = False


class WalkPresence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    walk_id: str = Field(min_length=1, max_length=100)
    variant: str = Field(pattern=r"^[A-Z]$")
    session: str = Field(pattern=r"^[a-z0-9-]{10,80}$")


def area_key(area):
    return "".join(c for c in unicodedata.normalize("NFD", area.casefold()) if not unicodedata.combining(c)).strip()


def member_view(member):
    profile = member.get("social", {})
    return {
        "id": member["user_id"],
        "name": profile.get("first_name") or member["username"],
        "bio": profile.get("bio", ""),
    }


def pair_id(a, b):
    return json.dumps(sorted([a, b]))


def social_router(get_db, current_user):
    router = APIRouter()
    projection = {"_id": 0, "user_id": 1, "username": 1, "social": 1}

    @router.get("/me/social")
    async def get_profile(user=Depends(current_user)):
        return SocialProfile.model_validate(user.get("social", {}))

    @router.put("/me/social")
    async def save_profile(profile: SocialProfile, user=Depends(current_user)):
        changes = {"$set": {"social": {**profile.model_dump(), "area_key": area_key(profile.area)}}}
        if not profile.share_walks:
            changes["$unset"] = {"walk_presence": ""}
        await get_db().users.update_one({"user_id": user["user_id"]}, changes)
        return profile

    @router.get("/members/search")
    async def search_members(q: str = Query("", max_length=60), area: str = Query("", max_length=80),
                             user=Depends(current_user)):
        q, area = q.strip(), area_key(area) or user.get("social", {}).get("area_key", "")
        if (q and len(q) < 2) or (not q and not area):
            return []
        query = {"user_id": {"$ne": user["user_id"]}}
        if q:
            name = {"$regex": r"(?:^|[\s-])" + re.escape(q), "$options": "i"}
            query["$or"] = [{"social.first_name": name}, {"username": name}]
        else:
            query["social.area_key"] = area
        members = await get_db().users.find(query, projection).limit(30).to_list(30)
        return [member_view(member) for member in members]

    @router.get("/me/friends")
    async def friends(user=Depends(current_user)):
        db, my_id = get_db(), user["user_id"]
        links = await db.friendships.find({"members": my_id}).to_list(None)
        ids = [next(member for member in link["members"] if member != my_id) for link in links]
        members = await db.users.find({"user_id": {"$in": ids}}, {**projection, "walk_presence": 1}).to_list(None)
        by_id = {member["user_id"]: member for member in members}
        now = datetime.now(timezone.utc)
        presence_by_id = {}
        result = []
        for link, other_id in zip(links, ids):
            member = by_id.get(other_id)
            if not member:
                continue
            view = member_view(member)
            view["status"] = "friend" if link["accepted"] else "outgoing" if link["requested_by"] == my_id else "incoming"
            presence = member.get("walk_presence")
            if view["status"] == "friend" and member.get("social", {}).get("share_walks") and presence:
                if presence["expires_at"].replace(tzinfo=timezone.utc) > now:
                    presence_by_id[other_id] = presence
            result.append(view)
        if not presence_by_id:
            return result
        walks = await db.walks.find({"id": {"$in": [p["walk_id"] for p in presence_by_id.values()]},
                                     "moderation_status": {"$ne": "hidden"}},
                                    {"_id": 0, "id": 1, "title": 1}).to_list(None)
        titles = {walk["id"]: walk["title"] for walk in walks}
        for view in result:
            presence = presence_by_id.get(view["id"])
            if presence and presence["walk_id"] in titles:
                view["walk"] = {"id": presence["walk_id"], "title": titles[presence["walk_id"]], "variant": presence["variant"]}
        return result

    @router.post("/me/friends/{other_id}")
    async def request_friend(other_id: str, user=Depends(current_user)):
        db, my_id = get_db(), user["user_id"]
        if other_id == my_id or not await db.users.find_one({"user_id": other_id}, {"_id": 1}):
            raise HTTPException(404, "Membre introuvable.")
        members = sorted([my_id, other_id])
        try:
            await db.friendships.insert_one({"_id": pair_id(my_id, other_id), "members": members, "requested_by": my_id, "accepted": False})
        except DuplicateKeyError:
            pass  # Only the recipient can accept via the explicit action.
        return {"ok": True}

    @router.post("/me/friends/{other_id}/accept")
    async def accept_friend(other_id: str, user=Depends(current_user)):
        result = await get_db().friendships.update_one(
            {"_id": pair_id(user["user_id"], other_id), "requested_by": other_id}, {"$set": {"accepted": True}},
        )
        if not result.matched_count:
            raise HTTPException(404, "Invitation introuvable.")
        return {"ok": True}

    @router.delete("/me/friends/{other_id}")
    async def remove_friend(other_id: str, user=Depends(current_user)):
        await get_db().friendships.delete_one({"_id": pair_id(user["user_id"], other_id)})
        return {"ok": True}

    @router.put("/me/walk-presence")
    async def publish_presence(body: WalkPresence, user=Depends(current_user)):
        if not user.get("social", {}).get("share_walks"):
            return {"ok": True}
        db = get_db()
        walk = await db.walks.find_one({"id": body.walk_id, "moderation_status": {"$ne": "hidden"}}, {"variants.name": 1})
        if not walk or (body.variant != "A" and not any(v["name"] == body.variant for v in walk.get("variants", []))):
            raise HTTPException(404, "Balade introuvable.")
        await db.users.update_one({"user_id": user["user_id"], "social.share_walks": True},
                                  {"$set": {"walk_presence": {**body.model_dump(), "expires_at": datetime.now(timezone.utc) + timedelta(seconds=60)}}})
        return {"ok": True}

    @router.delete("/me/walk-presence/{session}")
    async def end_presence(session: str, user=Depends(current_user)):
        await get_db().users.update_one({"user_id": user["user_id"], "walk_presence.session": session},
                                        {"$unset": {"walk_presence": ""}})
        return {"ok": True}

    return router
