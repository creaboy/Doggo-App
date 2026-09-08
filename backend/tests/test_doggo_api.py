"""Doggo backend API tests."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not BASE:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL is required for API tests", allow_module_level=True)
BASE = BASE.rstrip("/")
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


@pytest.fixture(scope="session")
def seeded_loop_coords(session):
    """Reference loop geometry from seeded demo walks for real-world snap tests."""
    walks = session.get(f"{API}/walks")
    assert walks.status_code == 200
    items = walks.json()
    assert items, "Expected seeded walks"
    detail = session.get(f"{API}/walks/{items[0]['id']}")
    assert detail.status_code == 200
    segments = detail.json()["walk"]["segments"]
    coords = segments[0]["coordinates"]
    assert len(coords) >= 4
    return coords


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
        """Walk creation requires exact closed loops and persists computed stats."""
        payload = {
            "title": "TEST_Walk_" + uuid.uuid4().hex[:6],
            "description": "test",
            "difficulty": "easy",
            "environment": "forest",
            "dog_freedom": "free",
            "duration_min": 30,
            "segments": [
                {"freedom": "free", "coordinates": [[48.4053, 2.7010], [48.4062, 2.7025], [48.4075, 2.7040]]},
                {"freedom": "caution", "coordinates": [[48.4075, 2.7040], [48.4064, 2.7056], [48.4051, 2.7040]]},
                {"freedom": "leash", "coordinates": [[48.4051, 2.7040], [48.4053, 2.7010]]},
            ],
            "features": ["shade"],
            "pois": [{"type": "water", "lat": 48.41, "lng": 2.71, "description": "spring"}],
            "hazards": [{"type": "caterpillars", "lat": 48.42, "lng": 2.72, "description": "warning"}],
        }
        r = session.post(f"{API}/walks", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w["distance_km"] > 0
        assert 0 < w["off_leash_pct"] < 100
        # verify persisted
        got = session.get(f"{API}/walks/{w['id']}").json()
        assert got["walk"]["title"] == payload["title"]
        assert len(got["pois"]) == 1
        assert len(got["hazards"]) == 1

    def test_create_walk_rejects_open_loop_and_preserves_existing(self, session, auth_headers):
        """Open loops are rejected and existing walk records stay unchanged."""
        before = session.get(f"{API}/walks")
        assert before.status_code == 200
        before_count = len(before.json())

        payload = {
            "title": "TEST_OpenLoop_" + uuid.uuid4().hex[:6],
            "description": "should fail",
            "difficulty": "easy",
            "environment": "forest",
            "dog_freedom": "free",
            "duration_min": 20,
            "segments": [{"freedom": "free", "coordinates": [[48.4053, 2.7010], [48.4062, 2.7025], [48.4075, 2.7040]]}],
            "features": [],
            "pois": [],
            "hazards": [],
        }
        failed = session.post(f"{API}/walks", json=payload, headers=auth_headers)
        assert failed.status_code == 422

        after = session.get(f"{API}/walks")
        assert after.status_code == 200
        assert len(after.json()) == before_count

    def test_create_walk_rejects_invalid_coordinates_and_discontinuity(self, session, auth_headers):
        """Walk creation rejects invalid ranges/NaN-like inputs and discontinuous segments."""
        bad_range_payload = {
            "title": "TEST_BadRange_" + uuid.uuid4().hex[:6],
            "description": "invalid lat",
            "difficulty": "easy",
            "environment": "forest",
            "dog_freedom": "free",
            "duration_min": 20,
            "segments": [{"freedom": "free", "coordinates": [[95.0, 2.7010], [48.4062, 2.7025], [95.0, 2.7010]]}],
            "features": [],
            "pois": [],
            "hazards": [],
        }
        bad_range = session.post(f"{API}/walks", json=bad_range_payload, headers=auth_headers)
        assert bad_range.status_code == 422

        discontinuous_payload = {
            "title": "TEST_Gap_" + uuid.uuid4().hex[:6],
            "description": "discontinuous",
            "difficulty": "easy",
            "environment": "forest",
            "dog_freedom": "free",
            "duration_min": 20,
            "segments": [
                {"freedom": "free", "coordinates": [[48.4053, 2.7010], [48.4062, 2.7025]]},
                {"freedom": "caution", "coordinates": [[48.4068, 2.7032], [48.4053, 2.7010]]},
            ],
            "features": [],
            "pois": [],
            "hazards": [],
        }
        discontinuous = session.post(f"{API}/walks", json=discontinuous_payload, headers=auth_headers)
        assert discontinuous.status_code == 422

    def test_create_walk_rejects_zero_movement(self, session, auth_headers):
        """Walk creation rejects stationary zero-movement loops."""
        payload = {
            "title": "TEST_Stationary_" + uuid.uuid4().hex[:6],
            "description": "stationary",
            "difficulty": "easy",
            "environment": "forest",
            "dog_freedom": "free",
            "duration_min": 10,
            "segments": [{"freedom": "free", "coordinates": [[48.4053, 2.7010], [48.4053, 2.7010], [48.4053, 2.7010]]}],
            "features": [],
            "pois": [],
            "hazards": [],
        }
        r = session.post(f"{API}/walks", json=payload, headers=auth_headers)
        assert r.status_code == 422

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


# --- Route snapping (OSRM) ---
class TestRoutingSnap:
    """Routing tests for foot-only quality constraints, batching and failures."""

    def test_snap_two_points(self, session, seeded_loop_coords):
        first = seeded_loop_coords[0]
        second = seeded_loop_coords[min(10, len(seeded_loop_coords) - 1)]
        r = session.post(f"{API}/routing/snap", json={"points": [first, second], "profile": "foot"})
        # OSRM public endpoint may be flaky; retry once on 5xx
        if r.status_code in (502, 503, 504):
            import time as _t; _t.sleep(2)
            r = session.post(f"{API}/routing/snap", json={"points": [first, second], "profile": "foot"})
        assert r.status_code == 200, f"OSRM snap failed: {r.status_code} {r.text}"
        data = r.json()
        assert "coordinates" in data
        assert isinstance(data["coordinates"], list)
        assert data.get("provider") == "fossgis_osrm"
        assert data.get("profile") == "foot"
        assert len(data["coordinates"]) >= 2
        assert data["coordinates"][0] == first
        assert data["coordinates"][-1] == second
        assert "distance_km" in data
        assert data["distance_km"] > 0

    def test_snap_needs_two_points(self, session):
        r = session.post(f"{API}/routing/snap", json={"points": [[48.8215, 2.3355]], "profile": "foot"})
        assert r.status_code == 400

    def test_snap_rejects_far_from_network_without_car_fallback(self, session):
        r = session.post(
            f"{API}/routing/snap",
            json={"points": [[48.8215, 2.3355], [48.8237, 2.3410]], "profile": "foot"},
        )
        assert r.status_code == 422
        assert "20 m" in r.text

    def test_snap_rejects_more_than_200_points(self, session, seeded_loop_coords):
        points = [seeded_loop_coords[i % len(seeded_loop_coords)] for i in range(201)]
        r = session.post(f"{API}/routing/snap", json={"points": points, "profile": "foot"})
        assert r.status_code == 422

    def test_snap_batches_and_dedupes_seams(self, session, seeded_loop_coords):
        if len(seeded_loop_coords) < 30:
            pytest.skip("Seeded geometry too small for batching test")
        step = max(1, len(seeded_loop_coords) // 30)
        points = seeded_loop_coords[::step][:30]
        if len(points) < 26:
            points = seeded_loop_coords[:26]
        r = session.post(f"{API}/routing/snap", json={"points": points, "profile": "foot"})
        if r.status_code in (502, 503, 504):
            import time as _t
            _t.sleep(2)
            r = session.post(f"{API}/routing/snap", json={"points": points, "profile": "foot"})
        assert r.status_code == 200, r.text
        snapped = r.json()["coordinates"]
        assert snapped[0] == points[0]
        assert snapped[-1] == points[-1]
        duplicates = sum(1 for a, b in zip(snapped, snapped[1:]) if a == b)
        assert duplicates == 0


# --- Seed v2: OSRM-snapped seeded walks ---
class TestSeededWalksOsrm:
    def test_seed_produced_dense_segments(self, session):
        walks = session.get(f"{API}/walks").json()
        assert len(walks) >= 4
        demo_walks = [w for w in walks if w.get("created_by") == "user_demo0001"]
        assert len(demo_walks) >= 4, f"expected 4 demo walks, got {len(demo_walks)}"
        # At least half of demo walks should have a snapped-first-segment (>50 coords).
        # If OSRM was unreachable at seed time, fallback allows straight-line seeds.
        dense = 0
        for w in demo_walks:
            detail = session.get(f"{API}/walks/{w['id']}").json()
            segs = detail["walk"]["segments"]
            first_len = len(segs[0]["coordinates"]) if segs else 0
            if first_len > 50:
                dense += 1
        assert dense >= 2, f"expected >=2 demo walks with snapped segments (>50 pts), got {dense}"

    def test_seeded_walk_detail_enriched(self, session):
        walks = session.get(f"{API}/walks").json()
        demo = next(w for w in walks if w.get("created_by") == "user_demo0001")
        d = session.get(f"{API}/walks/{demo['id']}").json()
        assert "walk" in d and "pois" in d and "hazards" in d
        assert "comments" in d and "confirmations_30d" in d
        assert "favorited" in d
        assert isinstance(d["favorited"], bool)
