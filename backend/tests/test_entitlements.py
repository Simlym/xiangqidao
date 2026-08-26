from datetime import datetime, timedelta

from app.entitlements import entitlement_payload, membership_active
from app.models import User


def make_user(**values):
    defaults = {"username": "member", "password_hash": "x", "role": "user", "plan": "free"}
    defaults.update(values)
    return User(**defaults)


def test_free_user_has_no_ai_features():
    result = entitlement_payload(make_user())
    assert result["active"] is False
    assert result["features"] == []


def test_active_pro_user_has_cloud_ai_features():
    user = make_user(plan="pro", membership_expires_at=datetime.utcnow() + timedelta(days=1))
    result = entitlement_payload(user)
    assert result["active"] is True
    assert set(result["features"]) == {"ai_analysis", "ai_training", "cloud_engine"}


def test_expired_membership_is_inactive_but_admin_is_active():
    expired = make_user(plan="pro", membership_expires_at=datetime.utcnow() - timedelta(seconds=1))
    admin = make_user(role="admin")
    assert membership_active(expired) is False
    assert membership_active(admin) is True
