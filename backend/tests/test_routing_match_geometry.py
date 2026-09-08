"""Focused backend regression tests for GPS match and geometry validation."""

import os
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
import requests

sys.path.append(str(Path(__file__).resolve().parents[1]))
from route_geometry import validate_loop


BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not BASE:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL is required for API tests", allow_module_level=True)
BASE = BASE.rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def http():
    """Shared HTTP client for routing API checks."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


# --- /routing/match endpoint validation and smoke ---
class TestRoutingMatch:
    def test_match_smoke_fixture_returns_matched_geometry(self, http):
        payload = {
            "points": [[52.517037, 13.38886], [52.51720, 13.38920]],
            "timestamps": [1778000000, 1778000020],
            "accuracies": [20, 20],
            "start_anchor": [52.517037, 13.38886],
        }
        response = http.post(f"{API}/routing/match", json=payload)
        if response.status_code in (502, 503, 504):
            response = http.post(f"{API}/routing/match", json=payload)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["provider"] == "fossgis_osrm_match"
        assert isinstance(data.get("coordinates"), list)
        assert len(data["coordinates"]) >= 2
        assert 0.5 <= float(data.get("confidence", 0)) <= 1

    def test_match_rejects_more_than_100_samples(self, http):
        points = [[48.8566 + i * 0.00003, 2.3522 + i * 0.00003] for i in range(101)]
        payload = {
            "points": points,
            "timestamps": [1778000000 + i * 20 for i in range(101)],
            "accuracies": [20 for _ in range(101)],
            "start_anchor": points[0],
        }
        response = http.post(f"{API}/routing/match", json=payload)
        assert response.status_code == 422

    def test_match_rejects_non_progressive_timestamps(self, http):
        payload = {
            "points": [[48.8566, 2.3522], [48.8567, 2.3524]],
            "timestamps": [1778000000, 1778000000],
            "accuracies": [20, 20],
            "start_anchor": [48.8566, 2.3522],
        }
        response = http.post(f"{API}/routing/match", json=payload)
        assert response.status_code == 422

    def test_match_rejects_invalid_accuracy_bounds(self, http):
        payload = {
            "points": [[48.8566, 2.3522], [48.8567, 2.3524]],
            "timestamps": [1778000000, 1778000020],
            "accuracies": [0, 20],
            "start_anchor": [48.8566, 2.3522],
        }
        response = http.post(f"{API}/routing/match", json=payload)
        assert response.status_code == 422

    def test_match_rejects_far_start_anchor(self, http):
        payload = {
            "points": [[48.8566, 2.3522], [48.8567, 2.3524]],
            "timestamps": [1778000000, 1778000020],
            "accuracies": [20, 20],
            "start_anchor": [48.8666, 2.3622],
        }
        response = http.post(f"{API}/routing/match", json=payload)
        assert response.status_code == 422


# --- route_geometry.validate_loop behavior with large and continuous traces ---
@dataclass
class Segment:
    coordinates: list
    freedom: str = "free"


class TestValidateLoopGeometry:
    def test_validate_loop_accepts_large_continuous_loop(self):
        seg1 = Segment(coordinates=[[48.8566, 2.3522], [48.8573, 2.3565], [48.8581, 2.3591]])
        seg2 = Segment(coordinates=[[48.8581, 2.3591], [48.8570, 2.3555], [48.8566, 2.3522]])
        validate_loop([seg1, seg2])
        assert seg2.coordinates[-1] == seg1.coordinates[0]

    def test_validate_loop_rejects_more_than_100k_coordinates(self):
        huge = [[48.8566 + i * 0.000001, 2.3522 + i * 0.000001] for i in range(100001)]
        with pytest.raises(ValueError, match="100 000"):
            validate_loop([Segment(coordinates=huge)])

    def test_validate_loop_rejects_discontinuous_segments(self):
        seg1 = Segment(coordinates=[[48.8566, 2.3522], [48.8570, 2.3530]])
        seg2 = Segment(coordinates=[[48.8575, 2.3536], [48.8566, 2.3522]])
        with pytest.raises(ValueError, match="reliés"):
            validate_loop([seg1, seg2])
