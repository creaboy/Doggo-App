"""Exercise the real auth endpoints without MongoDB or outbound HTTP."""
import asyncio
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Collection:
    def __init__(self):
        self.documents = []

    async def find_one(self, query, projection=None):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                return {key: value for key, value in document.items()
                        if not projection or projection.get(key) != 0}
        return None

    async def insert_one(self, document):
        self.documents.append(dict(document))

    async def delete_one(self, query):
        document = await self.find_one(query)
        if document:
            self.documents.remove(document)


@pytest.fixture
def api(monkeypatch):
    class Database:
        users = Collection()
        user_sessions = Collection()

    def forbid_external_http(*args, **kwargs):
        raise AssertionError("Authentication must not call an external provider")

    monkeypatch.setattr(server, "db", Database())
    monkeypatch.setattr(httpx, "AsyncClient", forbid_external_http)
    # Startup seeds demo data; omit the lifespan to isolate these auth endpoints.
    client = TestClient(server.app)
    yield client
    client.close()


def test_register_restore_login_logout_without_provider(api):
    credentials = {"email": "OWNER@example.com", "password": "local-password", "username": "Owner"}
    created = api.post("/api/auth/register", json=credentials)
    assert created.status_code == 200
    token = created.json()["session_token"]
    user = created.json()["user"]
    assert user["email"] == "owner@example.com"
    assert "password_hash" not in user
    headers = {"Authorization": f"Bearer {token}"}
    restored = api.get("/api/auth/me", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["user_id"] == user["user_id"]
    assert "password_hash" not in restored.json()
    assert api.post("/api/auth/register", json=credentials).status_code == 400
    assert api.post("/api/auth/login", json={**credentials, "password": "wrong"}).status_code == 401
    logged_in = api.post("/api/auth/login", json=credentials)
    assert logged_in.status_code == 200
    assert logged_in.json()["session_token"] != token
    assert api.post("/api/auth/logout", headers=headers).status_code == 200
    assert api.get("/api/auth/me", headers=headers).status_code == 401


def test_removed_provider_and_map_endpoints(api):
    assert api.post("/api/auth/session", json={"session_id": "old-provider-session"}).status_code == 404
    assert api.get("/api/maps/view").status_code == 404
    assert api.get("/api/auth/me").status_code == 401


def test_existing_password_accounts_still_log_in(api):
    server.db.users.documents.append({
        "user_id": "existing", "email": "existing@example.com", "username": "Existing",
        "password_hash": server.hash_password("existing-password"),
    })
    response = api.post("/api/auth/login", json={"email": "existing@example.com", "password": "existing-password"})
    assert response.status_code == 200
    assert response.json()["user"]["user_id"] == "existing"


def test_demo_routes_use_the_shared_router(monkeypatch):
    points = [[48.85, 2.35], [48.851, 2.352]]

    async def route(actual_points, profile):
        assert actual_points == points
        assert profile == "foot"
        return {"coordinates": points}

    monkeypatch.setattr(server, "snap_points", route)
    assert asyncio.run(server._snap_via_osrm(points)) == points

    async def unavailable(*args):
        raise server.HTTPException(502, "Router unavailable")

    monkeypatch.setattr(server, "snap_points", unavailable)
    assert asyncio.run(server._snap_via_osrm(points)) is None
