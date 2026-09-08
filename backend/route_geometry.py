"""Validation for NEW walks only. Never mutates historical community walks."""
from math import atan2, cos, isfinite, radians, sin, sqrt


def valid_point(p):
    return (isinstance(p, (list, tuple)) and len(p) == 2
            and all(isinstance(v, (int, float)) and isfinite(v) for v in p)
            and -90 <= p[0] <= 90 and -180 <= p[1] <= 180)


def meters(a, b):
    dlat, dlon = radians(b[0] - a[0]), radians(b[1] - a[1])
    h = sin(dlat / 2) ** 2 + cos(radians(a[0])) * cos(radians(b[0])) * sin(dlon / 2) ** 2
    h = min(1, max(0, h))
    return 6371000 * 2 * atan2(sqrt(h), sqrt(1 - h))


def validate_loop(segments):
    if not segments or sum(len(s.coordinates) for s in segments) > 100000:
        raise ValueError("Un parcours valide est requis (100 000 coordonnées maximum).")
    first, previous, total, extent = None, None, 0.0, 0.0
    for seg in segments:
        pts = seg.coordinates
        if len(pts) < 2 or not all(valid_point(p) for p in pts):
            raise ValueError("Chaque segment doit contenir au moins deux coordonnées GPS valides.")
        if first is None:
            first = pts[0]
        if previous is not None and meters(previous, pts[0]) > 0.01:
            raise ValueError("Les segments du parcours doivent être reliés sans interruption.")
        for i, point in enumerate(pts):
            extent = max(extent, meters(first, point))
            if i:
                total += meters(pts[i - 1], point)
        previous = pts[-1]
    if total < 20 or extent < 10:
        raise ValueError("Parcours trop court : marchez ou dessinez un véritable trajet avant de terminer.")
    if meters(first, previous) > 0.01:
        raise ValueError("Fermez la boucle et vérifiez l’aperçu avant de publier : l’arrivée doit rejoindre le départ.")
    # Normalize only sub-centimetre floating-point noise; never silently close an open walk.
    for a, b in zip(segments, segments[1:]):
        b.coordinates[0] = a.coordinates[-1].copy()
    segments[-1].coordinates[-1] = first.copy()