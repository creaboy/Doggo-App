import re
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from fastapi import Header
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def matches(document, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(document, branch) for branch in expected):
                return False
            continue
        value = document
        for part in key.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$ne" in expected and value == expected["$ne"]:
                return False
            if "$regex" in expected and not re.search(expected["$regex"], value or "", re.I):
                return False
        elif (expected not in value if isinstance(value, list) else value != expected):
            return False
    return True


class Collection:
    def __init__(self, *documents):
        self.documents = list(documents)

    def find(self, query, projection=None):
        return Collection(*(deepcopy(doc) for doc in self.documents if matches(doc, query)))

    def limit(self, count):
        return Collection(*self.documents[:count])

    async def to_list(self, length):
        return self.documents

    async def find_one(self, query, projection=None):
        return next(iter(self.find(query).documents), None)

    async def insert_one(self, doc):
        if await self.find_one({"_id": doc["_id"]}):
            raise DuplicateKeyError("already exists")
        self.documents.append(doc)

    async def update_one(self, query, changes):
        for doc in self.documents:
            if matches(doc, query):
                doc.update(deepcopy(changes.get("$set", {})))
                for key in changes.get("$unset", {}):
                    doc.pop(key, None)
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query):
        self.documents = [doc for doc in self.documents if not matches(doc, query)]


def test_friends_must_accept_and_only_see_the_shared_walk(monkeypatch):
    db = SimpleNamespace(
        users=Collection(*[
            {"user_id": name, "username": name, "email": name + "@example.com"}
            for name in ["Alice", "Bob", "Charlie"]
        ]),
        walks=Collection({"id": "woods", "title": "Bois", "variants": [{"name": "B"}], "start_lat": 48.0}),
        friendships=Collection(),
    )

    async def auth(x_member: str = Header()):
        return await db.users.find_one({"user_id": x_member})

    monkeypatch.setattr(server, "db", db)
    monkeypatch.setitem(server.app.dependency_overrides, server.current_user, auth)
    alice, bob, charlie = [{"X-Member": name} for name in ["Alice", "Bob", "Charlie"]]
    client = TestClient(server.app)
    try:
        profile = {"first_name": "Alicia", "area": "Saint-Étienne", "bio": "J’aime les bois.", "share_walks": True}
        assert client.put("/api/me/social", json=profile, headers=alice).status_code == 200
        for params in [{"q": "ali"}, {"area": "saint-etienne"}]:
            assert client.get("/api/members/search", params=params, headers=bob).json() == [
                {"id": "Alice", "name": "Alicia", "bio": profile["bio"]},
            ]

        assert client.post("/api/me/friends/Bob", headers=alice).status_code == 200
        assert client.post("/api/me/friends/Bob/accept", headers=alice).status_code == 404
        assert client.post("/api/me/friends/Alice", headers=bob).status_code == 200
        presence = {"walk_id": "woods", "variant": "B", "session": "test-session-123"}
        assert client.put("/api/me/walk-presence", json={**presence, "latitude": 48}, headers=alice).status_code == 422
        assert client.put("/api/me/walk-presence", json=presence, headers=alice).status_code == 200
        pending = client.get("/api/me/friends", headers=bob).json()[0]
        assert pending["status"] == "incoming" and "walk" not in pending
        assert client.post("/api/me/friends/Alice/accept", headers=bob).status_code == 200
        assert client.get("/api/me/friends", headers=bob).json()[0]["walk"] == {"id": "woods", "title": "Bois", "variant": "B"}
        assert client.get("/api/me/friends", headers=charlie).json() == []
        assert client.delete("/api/me/walk-presence/test-session-123", headers=alice).status_code == 200
        assert "walk" not in client.get("/api/me/friends", headers=bob).json()[0]
        assert client.put("/api/me/walk-presence", json=presence, headers=alice).status_code == 200
        assert client.put("/api/me/social", json={**profile, "share_walks": False}, headers=alice).status_code == 200
        assert client.put("/api/me/walk-presence", json=presence, headers=alice).status_code == 200
        assert "walk" not in client.get("/api/me/friends", headers=bob).json()[0]
    finally:
        client.close()
