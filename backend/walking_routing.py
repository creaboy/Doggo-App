"""OSRM adapter: dedicated FOSSGIS foot data, not the public car demo's /foot alias."""
import asyncio
import os
import time

import httpx
from fastapi import HTTPException
from route_geometry import meters, valid_point

_lock = asyncio.Lock()
_last_request = 0.0
ATTRIBUTION = "© OpenStreetMap contributors · Routage FOSSGIS"


async def _fetch(service, points, profile, params):
    global _last_request
    base = os.environ.get("OSRM_ROUTING_BASE_URL", "https://routing.openstreetmap.de").rstrip("/")
    coords = ";".join(f"{lng:.7f},{lat:.7f}" for lat, lng in points)
    url = f"{base}/routed-{profile}/{service}/v1/{profile}/{coords}"
    # Public service policy: globally <=1 upstream request/sec for this single-worker API.
    async with _lock:
        await asyncio.sleep(max(0, 1.05 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        async with httpx.AsyncClient(timeout=18) as client:
            response = await client.get(url, params=params, headers={"User-Agent": "Doggo-community-walks/1.0"})
    if response.status_code != 200:
        raise HTTPException(502, "Le service piéton est indisponible. Votre tracé est conservé ; réessayez ou continuez la balade.")
    data = response.json()
    return data


async def _request(points, profile, alternatives):
    data = await _fetch("route", points, profile, {
        "geometries": "geojson", "overview": "full", "steps": "false",
        "alternatives": "true" if alternatives else "false",
    })
    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(422, "Aucun chemin accessible trouvé. Votre tracé est conservé.")
    waypoints = data.get("waypoints", [])
    if len(waypoints) != len(points) or any(float(w.get("distance", 999)) > 20 for w in waypoints):
        raise HTTPException(422, "Un point est à plus de 20 m d’un chemin connu. Rapprochez-le d’un chemin puis réessayez.")
    # The foot profile optimizes pedestrian time; prefer the shortest returned walking alternative.
    route = min(data["routes"], key=lambda r: r.get("distance", float("inf")))
    result = [[c[1], c[0]] for c in route["geometry"]["coordinates"]]
    if len(result) < 2 or not all(valid_point(p) for p in result):
        raise HTTPException(502, "Le service a renvoyé un tracé inutilisable. Vos points sont conservés.")
    if meters(points[0], result[0]) > 20 or meters(points[-1], result[-1]) > 20:
        raise HTTPException(422, "Le chemin calculé ne rejoint pas les points demandés. Aucun raccourci direct n’a été ajouté.")
    # Only tiny endpoint connectors. The official first point never moves to another street.
    return [points[0], *result, points[-1]]


async def snap_points(points, profile="foot", alternatives=False):
    if len(points) < 2:
        raise HTTPException(400, "Ajoutez au moins deux points.")
    if len(points) > 200 or not all(valid_point(p) for p in points):
        raise HTTPException(422, "Coordonnées invalides ou plus de 200 points de passage.")
    if all(meters(points[0], p) < 0.01 for p in points[1:]):
        raise HTTPException(422, "Choisissez deux positions distinctes.")
    out = []
    try:
        # Small, overlapping waypoint batches. Dense generated/GPS geometry is never resubmitted.
        for offset in range(0, len(points) - 1, 24):
            chunk = await _request(points[offset:offset + 25], profile, alternatives and len(points) == 2)
            for point in chunk:
                if not out or meters(out[-1], point) > 0.001:
                    out.append(point)
        out[0], out[-1] = points[0].copy(), points[-1].copy()
        distance = sum(meters(a, b) for a, b in zip(out, out[1:]))
        return {"coordinates": out, "distance_km": round(distance / 1000, 2),
                "duration_min": max(1, round(distance / 75)), "profile": profile,
                "provider": "fossgis_osrm", "attribution": ATTRIBUTION}
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(502, "Impossible de calculer le chemin. Vos points sont conservés ; réessayez ou continuez l’enregistrement.")


async def match_points(points, timestamps, accuracies, start_anchor):
    """Map-match only the pending raw GPS window. Never route between endpoints as a fallback."""
    if not 2 <= len(points) <= 100 or not all(valid_point(p) for p in points):
        raise HTTPException(422, "Le recalage GPS requiert entre 2 et 100 positions valides.")
    if (len(timestamps) != len(points) or any(t < 0 for t in timestamps) or any(b <= a for a, b in zip(timestamps, timestamps[1:]))
            or len(accuracies) != len(points) or any(not 1 <= a <= 25 for a in accuracies)):
        raise HTTPException(422, "Les horodatages GPS doivent progresser et chaque précision doit être comprise entre 1 et 25 m.")
    if not valid_point(start_anchor) or meters(start_anchor, points[0]) > 20:
        raise HTTPException(422, "La jonction au segment précédent est trop éloignée. Les positions GPS sont conservées.")
    try:
        data = await _fetch("match", points, "foot", {
            "geometries": "geojson", "overview": "full", "gaps": "split", "tidy": "false",
            "timestamps": ";".join(str(t) for t in timestamps),
            "radiuses": ";".join(str(a) for a in accuracies),
        })
        trace = data.get("tracepoints", [])
        matches = data.get("matchings", [])
        if (data.get("code") != "Ok" or len(matches) != 1 or not isinstance(matches[0], dict) or len(trace) != len(points)
                or any(not isinstance(p, dict) or p.get("matchings_index") != 0 for p in trace)):
            raise HTTPException(422, "Le GPS ne correspond pas à un chemin continu. Les points bruts sont conservés ; aucun raccourci n’est ajouté.")
        confidence = float(matches[0].get("confidence", 0))
        if not 0.5 <= confidence <= 1 or any(float(p.get("distance", 999)) > 20 for p in trace):
            raise HTTPException(422, "Le recalage GPS est trop incertain. Les points bruts sont conservés.")
        geometry = [[c[1], c[0]] for c in matches[0]["geometry"]["coordinates"]]
        if (len(geometry) < 2 or not all(valid_point(p) for p in geometry)
                or meters(start_anchor, geometry[0]) > 20 or meters(points[-1], geometry[-1]) > 20):
            raise HTTPException(422, "Le chemin ajusté ne rejoint pas correctement votre trace GPS.")
        out = []
        for p in [start_anchor, *geometry]:
            if not out or meters(out[-1], p) > 0.001:
                out.append(p)
        if len(out) < 2:
            raise HTTPException(422, "Pas assez de déplacement pour ajuster ce segment.")
        # End on the path; next batch anchors here, not back on the raw GPS position.
        # Only the final explicit Stop connects back to the latest raw GPS fix.
        out[0] = start_anchor.copy()
        return {"coordinates": out, "profile": "foot", "provider": "fossgis_osrm_match",
                "confidence": confidence, "ambiguous": any(p.get("alternatives_count", 0) > 0 for p in trace),
                "attribution": ATTRIBUTION}
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(502, "Recalage GPS indisponible. L’enregistrement continue et les positions restent conservées.")