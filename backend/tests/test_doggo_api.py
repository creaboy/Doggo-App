"""Doggo backend API tests"""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://barkroute.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

DEMO_EMAIL = "demo@doggo.app"
DEMO_PWD = "demo1234"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_token(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PWD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# --- Auth ---
class TestAuth:
    def test_login_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PWD})
        assert r.status_code == 200
        data = r.json()
        assert "session_token" in data
        assert data["user"]["email"] == DEMO_EMAIL

    def test_login_bad_password(self, session):
        r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_register_and_me(self, session):
        email = f"test_{uuid.uuid4().hex[:8]}@doggo.app"
        r = session.post(f"{API}/auth/register", json={"email": email, "password": "pw12345", "username": "TEST_User"})
        assert r.status_code == 200, r.text
        token = r.json()["session_token"]
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == email

    def test_register_duplicate(self, session):
        r = session.post(f"{API}/auth/register", json={"email": DEMO_EMAIL, "password": "pw12345", "username": "x"})
        assert r.status_code == 400

    def test_me_unauthorized(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401


# --- Walks list & filters ---
class TestWalksList:
    def test_list_all(self, session):
        r = session.get(f"{API}/walks")
        assert r.status_code == 200
        walks = r.json()
        assert isinstance(walks, list)
        assert len(walks) >= 4
        # ensure no _id leak
        for w in walks:
            assert "_id" not in w
            assert "distance_km" in w and "rating_avg" in w

    def test_filter_environment_forest(self, session):
        r = session.get(f"{API}/walks", params={"environment": "forest"})
        assert r.status_code == 200
        walks = r.json()
        assert len(walks) >= 1
        for w in walks:
            assert w["environment"] == "forest"

    def test_filter_difficulty(self, session):
        r = session.get(f"{API}/walks", params={"difficulty": "easy"})
        assert r.status_code == 200
        for w in r.json():
            assert w["difficulty"] == "easy"

    def test_filter_dog_freedom(self, session):
        r = session.get(f"{API}/walks", params={"dog_freedom": "free"})
        assert r.status_code == 200
        for w in r.json():
            assert w["dog_freedom"] == "free"

    def test_filter_max_duration(self, session):
        r = session.get(f"{API}/walks", params={"max_duration": 40})
        assert r.status_code == 200
        for w in r.json():
            assert w["duration_min"] <= 40

    def test_filter_min_rating(self, session):
        r = session.get(f"{API}/walks", params={"min_rating": 4.0})
        assert r.status_code == 200
        for w in r.json():
            assert w["rating_avg"] >= 4.0


# --- Walk detail ---
class TestWalkDetail:
    def test_get_walk_detail(self, session):
        walks = session.get(f"{API}/walks").json()
        wid = walks[0]["id"]
        r = session.get(f"{API}/walks/{wid}")
        assert r.status_code == 200
        d = r.json()
        assert "walk" in d and "pois" in d and "hazards" in d
        assert "comments" in d and "confirmations_30d" in d
        assert d["walk"]["id"] == wid
        assert isinstance(d["confirmations_30d"], int)

    def test_get_walk_not_found(self, session):
        r = session.get(f"{API}/walks/nonexistent-id-xxx")
        assert r.status_code == 404


# --- Create walk (auth) ---
class TestCreateWalk:
    def test_create_walk_auto_distance(self, session, auth_headers):
        payload = {
            "title": "TEST_Walk_" + uuid.uuid4().hex[:6],
            "description": "test",
            "difficulty": "easy",
            "environment": "forest",
            "dog_freedom": "free",
            "duration_min": 30,
            "segments": [{"freedom": "free", "coordinates": [[48.40, 2.70], [48.41, 2.71], [48.42, 2.72]]}],
            "features": ["shade"],
            "pois": [{"type": "water", "lat": 48.41, "lng": 2.71, "description": "spring"}],
            "hazards": [{"type": "caterpillars", "lat": 48.42, "lng": 2.72, "description": "warning"}],
        }
        r = session.post(f"{API}/walks", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w["distance_km"] > 0
        assert w["off_leash_pct"] == 100
        # verify persisted
        got = session.get(f"{API}/walks/{w['id']}").json()
        assert got["walk"]["title"] == payload["title"]
        assert len(got["pois"]) == 1
        assert len(got["hazards"]) == 1

    def test_create_walk_requires_auth(self, session):
        r = session.post(f"{API}/walks", json={"title": "x", "duration_min": 10, "segments": [{"coordinates": [[0, 0], [1, 1]]}]})
        assert r.status_code == 401


# --- Rate / comment / confirm ---
class TestInteractions:
    def test_rate_walk(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/rate", json={"stars": 4}, headers=auth_headers)
        assert r.status_code == 200
        assert "rating_avg" in r.json()

    def test_rate_invalid(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/rate", json={"stars": 9}, headers=auth_headers)
        assert r.status_code == 400

    def test_add_comment(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/comments", json={"text": "TEST_comment"}, headers=auth_headers)
        assert r.status_code == 200
        detail = session.get(f"{API}/walks/{wid}").json()
        assert any(c["text"] == "TEST_comment" for c in detail["comments"])

    def test_empty_comment_rejected(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/comments", json={"text": "  "}, headers=auth_headers)
        assert r.status_code == 400

    def test_add_hazard_and_confirm_resolve(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/hazards",
                         json={"type": "cars", "lat": 48.4, "lng": 2.7, "description": "TEST"},
                         headers=auth_headers)
        assert r.status_code == 200
        hid = r.json()["id"]
        r2 = session.post(f"{API}/hazards/{hid}/confirm", headers=auth_headers)
        assert r2.status_code == 200
        r3 = session.post(f"{API}/hazards/{hid}/resolve", headers=auth_headers)
        assert r3.status_code == 200

    def test_confirm_walk_accurate(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/confirm", json={"accurate": True}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["accurate"] is True

    def test_confirm_walk_change(self, session, auth_headers):
        wid = session.get(f"{API}/walks").json()[0]["id"]
        r = session.post(f"{API}/walks/{wid}/confirm",
                         json={"accurate": False, "change_type": "new_hazard", "note": "test"},
                         headers=auth_headers)
        assert r.status_code == 200


# --- Profile ---
class TestProfile:
    def test_my_walks(self, session, auth_headers):
        r = session.get(f"{API}/me/walks", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_my_activity(self, session, auth_headers):
        r = session.get(f"{API}/me/activity", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        assert "comments" in d and "ratings" in d
