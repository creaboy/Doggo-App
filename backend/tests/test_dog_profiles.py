import base64
import io
import sys
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

from fastapi import Header
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_dog_profile_photo_visibility_and_owner_scope(monkeypatch):
    dogs = {}

    async def find_dog(query, projection):
        dog = dogs.get(query["_id"])
        if not dog or (query.get("visible") and not dog["visible"]):
            return None
        return dog

    async def save_dog(query, fields, upsert):
        dogs[query["_id"]] = fields

    async def find_member(query, projection):
        return {"username": "Camille", "email": "private@example.com"}

    def current_user(x_member: str = Header()):
        return {"user_id": x_member, "username": x_member}

    monkeypatch.setattr(server, "db", SimpleNamespace(
        dog_profiles=SimpleNamespace(find_one=find_dog, replace_one=save_dog),
        users=SimpleNamespace(find_one=find_member),
    ))
    monkeypatch.setitem(server.app.dependency_overrides, server.current_user, current_user)
    owner = {"X-Member": "owner"}
    viewer = {"X-Member": "viewer"}
    jpeg = io.BytesIO()
    original = Image.new("RGB", (650, 480))
    exif = original.getexif()
    exif[270] = "Original photo metadata"
    original.save(jpeg, format="JPEG", exif=exif)
    profile = {
        "name": "  Rio  ", "age_months": 27, "dogs": "friendly", "adults": "ok", "children": "not_ok",
        "photo_jpeg": base64.b64encode(jpeg.getvalue()).decode("ascii"),
    }

    with closing(TestClient(server.app)) as client:
        assert client.get("/api/me/dog", headers=owner).json() is None
        result = client.put("/api/me/dog", headers=owner, json=profile)
        assert result.status_code == 200, result.text
        saved = result.json()
        assert saved["name"] == "Rio"
        assert not saved["visible"]
        with Image.open(io.BytesIO(base64.b64decode(saved["photo_jpeg"]))) as photo:
            assert max(photo.size) == 600
            assert not photo.getexif()

        assert client.get("/api/me/dog", headers=viewer).json() is None
        shared_url = "/api/members/owner/dog"
        assert client.get(shared_url, headers=viewer).status_code == 404
        assert client.put("/api/me/dog", headers=owner, json={**saved, "visible": True}).status_code == 200
        shared = client.get(shared_url, headers=viewer).json()
        assert shared["owner_name"] == "Camille"
        assert "email" not in shared and "visible" not in shared["dog"]
        assert shared["dog"]["children"] == "not_ok"
        assert client.put("/api/me/dog", headers=viewer, json={**profile, "photo_jpeg": "aW52YWxpZA=="}).status_code == 422
        assert client.get("/api/me/dog", headers=viewer).json() is None
        assert client.put("/api/me/dog", headers=owner, json={**saved, "photo_jpeg": None}).status_code == 200
        assert client.get(shared_url, headers=viewer).status_code == 404
