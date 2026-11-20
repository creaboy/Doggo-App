"""Creation persists complete route families and rejects invalid drafts before writes."""
import copy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Collection:
    def __init__(self):
        self.documents = []

    async def insert_one(self, document):
        self.documents.append(copy.deepcopy(document))

    async def find_one(self, query, projection=None):
        return next((item for item in self.documents if self.matches(item, query)), None)

    @staticmethod
    def matches(item, query):
        for key, value in query.items():
            if key == '$or':
                if not any(Collection.matches(item, option) for option in value):
                    return False
            elif isinstance(value, dict) and '$exists' in value:
                if (key in item) != value['$exists']:
                    return False
            elif isinstance(value, dict) and '$ne' in value:
                if item.get(key) == value['$ne']:
                    return False
            elif item.get(key) != value:
                return False
        return True

    async def update_one(self, query, changes, upsert=False):
        item = await self.find_one(query)
        matched = item is not None
        if not matched and upsert:
            item = {**query, **changes.get('$setOnInsert', {})}
            self.documents.append(item)
        if item is not None:
            item.update(copy.deepcopy(changes['$set']))
        return SimpleNamespace(matched_count=int(matched))

    async def delete_one(self, query):
        item = await self.find_one(query)
        if item is not None:
            self.documents.remove(item)


@pytest.fixture
def api(monkeypatch):
    database = SimpleNamespace(walks=Collection(), pois=Collection(), hazards=Collection(),
                               walk_confirmations=Collection(), walk_reports=Collection())
    monkeypatch.setattr(server, 'db', database)
    server.app.dependency_overrides[server.current_user] = lambda: {'user_id': 'creator', 'username': 'Creator'}
    client = TestClient(server.app, raise_server_exceptions=True)
    try:
        yield client, database
    finally:
        client.close()
        server.app.dependency_overrides.clear()


def payload():
    segments = [dict(coordinates=[[48.85, 2.35], [48.851, 2.351], [48.85, 2.35]], freedom='free',
                     features=['shade'], interests=['water'], dangers=['crossing'], notes='Traverser au passage piéton')]
    return dict(title='Boucle du bois', duration_min=30, segments=segments,
                pois=[dict(type='water', lat=48.85, lng=2.35, description='Fontaine')],
                hazards=[dict(type='path_closed', lat=48.851, lng=2.351, description='Barrière')],
                variants=[dict(name='B', segments=copy.deepcopy(segments), pois=[], hazards=[dict(type='cars', lat=48.85, lng=2.35)])])


def test_publish_preserves_metadata_and_variants(api):
    client, database = api
    body = payload()
    body['variants'][0]['duration_min'] = 42
    response = client.post('/api/walks', json=body)
    assert response.status_code == 200, response.text
    walk = database.walks.documents[0]
    assert walk['duration_min'] == 30
    assert walk['variants'][0]['duration_min'] == 42
    assert walk['segments'][0]['dangers'] == ['crossing']
    assert walk['segments'][0]['notes'] == 'Traverser au passage piéton'
    assert walk['variants'][0]['name'] == 'B'
    assert walk['variants'][0]['distance_km'] > 0
    assert walk['variants'][0]['off_leash_pct'] == 100
    assert walk['variants'][0]['hazards'][0]['type'] == 'cars'
    assert database.pois.documents[0]['description'] == 'Fontaine'
    assert database.hazards.documents[0]['type'] == 'path_closed'


@pytest.mark.parametrize('failure', ['open', 'disconnected', 'different_start', 'duplicate', 'bad_note', 'bad_segment'])
def test_invalid_family_is_rejected_before_any_write(api, failure):
    client, database = api
    body = payload()
    variant = body['variants'][0]
    if failure == 'open':
        variant['segments'][0]['coordinates'].pop()
    elif failure == 'disconnected':
        variant['segments'].append(dict(coordinates=[[48.9, 2.4], [48.85, 2.35]]))
    elif failure == 'different_start':
        variant['segments'][0]['coordinates'] = [[48.9, 2.4], [48.901, 2.401], [48.9, 2.4]]
    elif failure == 'duplicate':
        body['variants'].append(copy.deepcopy(variant))
    elif failure == 'bad_note':
        body['hazards'][0]['type'] = 'invalid'
    else:
        variant['segments'][0]['dangers'] = ['invalid']
    assert client.post('/api/walks', json=body).status_code == 422
    assert database.walks.documents == []
    assert database.pois.documents == []
    assert database.hazards.documents == []


def test_old_single_route_payload_is_still_supported(api):
    client, database = api
    body = payload()
    del body['variants']
    for key in ['features', 'interests', 'dangers', 'notes']:
        del body['segments'][0][key]
    assert client.post('/api/walks', json=body).status_code == 200
    assert database.walks.documents[0]['variants'] == []


def test_confirmed_off_road_loops_are_published_without_road_distance_checks(api):
    client, database = api
    body = payload()
    body['segments'][0]['off_path'] = True
    body['variants'][0]['segments'][0]['off_path'] = True
    response = client.post('/api/walks', json=body)
    assert response.status_code == 200, response.text
    assert database.walks.documents[0]['segments'][0]['off_path'] is True
    assert database.walks.documents[0]['variants'][0]['segments'][0]['off_path'] is True


def test_live_event_uses_valid_coordinates_and_belongs_to_an_existing_walk(api):
    client, database = api
    database.walks.documents.append({'id': 'walk'})
    event = {'type': 'event', 'lat': 48.85, 'lng': 2.35, 'description': 'Course locale'}
    assert client.post('/api/walks/missing/hazards', json=event).status_code == 404
    assert client.post('/api/walks/walk/hazards', json={**event, 'lat': 100}).status_code == 422
    assert database.hazards.documents == []
    response = client.post('/api/walks/walk/hazards', json=event)
    assert response.status_code == 200
    assert database.hazards.documents[0]['walk_id'] == 'walk'
    assert response.json()['description'] == 'Course locale'


def test_edit_updates_only_the_changed_route_revision(api):
    client, database = api
    body = payload()
    walk_id = client.post('/api/walks', json=body).json()['id']
    url = f'/api/walks/{walk_id}'
    walk = database.walks.documents[0]
    walk['rating_count'] = 3
    body.update(edit_revision='initial', title='Nouveau titre')
    server.app.dependency_overrides[server.current_user] = lambda: {'user_id': 'reader', 'username': 'Reader'}
    assert client.put(url, json=body).status_code == 403
    server.app.dependency_overrides[server.current_user] = lambda: {'user_id': 'creator', 'username': 'Creator'}
    assert client.put(url, json=body).status_code == 200
    assert server.route_revisions(walk) == {'A': 'initial', 'B': 'initial'}
    assert client.put(url, json=body).status_code == 409
    body['edit_revision'] = walk['edit_revision']
    body['variants'][0]['segments'][0]['coordinates'][1][0] += 0.001
    assert client.put(url, json=body).status_code == 200
    assert server.route_revisions(walk)['A'] == 'initial'
    assert server.route_revisions(walk)['B'] != 'initial'
    assert walk['rating_count'] == 3
    assert walk['variants'][0]['hazards'][0]['type'] == 'cars'
    assert len(database.hazards.documents) == 1


def test_feedback_is_versioned_and_deduplicated(api):
    client, database = api
    walk_id = client.post('/api/walks', json=payload()).json()['id']
    url = f'/api/walks/{walk_id}/confirm'
    confirmation = {'variant': 'B', 'route_revision': 'initial', 'accurate': True}
    assert client.post(url, json=confirmation).status_code == 403
    server.app.dependency_overrides[server.current_user] = lambda: {'user_id': 'reader', 'username': 'Reader'}
    assert client.post(url, json=confirmation).status_code == 200
    assert client.post(url, json=confirmation).status_code == 200
    assert len(database.walk_confirmations.documents) == 1
    report = {**confirmation, 'accurate': False, 'change_type': 'path_inaccessible'}
    assert client.post(url, json=report).status_code == 200
    assert client.post(url, json=report).status_code == 200
    assert len(database.walk_reports.documents) == 1
    assert database.walk_confirmations.documents == []
    database.walks.documents[0]['variants'][0]['route_revision'] = 'new'
    assert client.post(url, json=confirmation).status_code == 409


def test_only_configured_admin_can_hide_walk(api, monkeypatch):
    client, database = api
    walk_id = client.post('/api/walks', json=payload()).json()['id']
    url = f'/api/admin/walks/{walk_id}/moderation'
    body = {'edit_revision': 'initial', 'status': 'hidden'}
    monkeypatch.setenv('DOGGO_ADMIN_USER_IDS', ' moderator ')
    assert client.put(url, json=body).status_code == 403
    server.app.dependency_overrides[server.current_user] = lambda: {'user_id': 'moderator', 'username': 'Moderator'}
    assert client.put(url, json=body).status_code == 200
    assert database.walks.documents[0]['moderation_status'] == 'hidden'
    assert client.get(f'/api/walks/{walk_id}').status_code == 404
    assert client.post(f'/api/walks/{walk_id}/confirm', json={'accurate': True}).status_code == 404
