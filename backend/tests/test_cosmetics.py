"""外观商店：免费资源、买断解锁、重复购买与余额不足。"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import credits
from app.auth import hash_password, make_token
from app.deps import get_db
from app.main import app
from app.models import Base, CosmeticPurchase, CreditLog, User


def setup_client():
    engine = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)

    def override_get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), sessions


def auth_headers(username="buyer"):
    return {"Authorization": f"Bearer {make_token(username)}"}


def test_guest_catalog_marks_only_free_items_owned():
    client, _ = setup_client()
    response = client.get("/api/cosmetics/catalog")
    assert response.status_code == 200
    items = response.json()["items"]
    assert next(item for item in items if item["key"] == "app_ink")["owned"] is True
    assert next(item for item in items if item["key"] == "app_night")["owned"] is False
    assert next(item for item in items if item["key"] == "board_classic")["owned"] is True
    assert next(item for item in items if item["key"] == "board_jade")["owned"] is False


def test_purchase_is_permanent_and_idempotent():
    client, sessions = setup_client()
    with sessions() as db:
        db.add(User(username="buyer", password_hash=hash_password("password1")))
        credits.grant_signup(db, "buyer")
        starting_balance = credits.balance(db, "buyer")

    first = client.post(
        "/api/cosmetics/purchase",
        headers=auth_headers(),
        json={"asset_key": "board_jade"},
    )
    assert first.status_code == 200
    assert first.json()["purchased"] is True
    assert first.json()["balance"] == starting_balance - 120

    second = client.post(
        "/api/cosmetics/purchase",
        headers=auth_headers(),
        json={"asset_key": "board_jade"},
    )
    assert second.status_code == 200
    assert second.json()["already_owned"] is True
    assert second.json()["balance"] == first.json()["balance"]

    catalog = client.get("/api/cosmetics/catalog", headers=auth_headers()).json()["items"]
    assert next(item for item in catalog if item["key"] == "board_jade")["owned"] is True
    with sessions() as db:
        assert db.query(CosmeticPurchase).count() == 1
        spend = db.query(CreditLog).filter_by(kind="spend:cosmetic").one()
        assert spend.amount == -120


def test_purchase_requires_login_and_enough_credits():
    client, sessions = setup_client()
    assert client.post("/api/cosmetics/purchase", json={"asset_key": "piece_jade"}).status_code == 401

    with sessions() as db:
        db.add(User(username="buyer", password_hash=hash_password("password1")))
        db.commit()
    response = client.post(
        "/api/cosmetics/purchase",
        headers=auth_headers(),
        json={"asset_key": "piece_jade"},
    )
    assert response.status_code == 402
