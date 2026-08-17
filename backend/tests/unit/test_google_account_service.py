"""Google 登入帳號解析／建立測試（Issue #740）。

涵蓋：
- 全新 Google 帳號 → 建 Identity + Teacher（has_password=False）+ oauth_identities
- 既有已驗證 email 老師 → 自動綁定，不建新老師，原密碼不受影響
- 既有未驗證 email 老師 → 拒絕
- Google 端 email 未驗證 → 拒絕
- 重複登入 → 走 provider 命中，不重複建 row
- 既有 1Campus 老師 + 同 email Google → 同一 Teacher 多一筆 oauth_identities
"""

import pytest
from auth import get_password_hash
from models.oauth_identity import OAuthIdentity
from models.user import Identity, Teacher
from services.google_account_service import (
    GoogleAccountNotVerifiedError,
    GoogleAccountService,
    GoogleEmailNotVerifiedError,
)


def _login(db, **overrides):
    kwargs = {
        "google_sub": "google-sub-001",
        "email": "teacher@example.com",
        "email_verified": True,
        "name": "Google Teacher",
        "picture": "https://lh3.googleusercontent.com/avatar",
    }
    kwargs.update(overrides)
    return GoogleAccountService.find_or_create_teacher(db, **kwargs)


class TestNewAccount:
    def test_creates_identity_teacher_and_oauth_row(self, shared_test_session):
        db = shared_test_session

        teacher, action = _login(db, email="brand-new@example.com")

        assert action == "created"
        assert teacher.email == "brand-new@example.com"
        assert teacher.has_password is False
        assert teacher.password_hash is None
        assert teacher.email_verified is True
        assert teacher.identity_id is not None

        oauth = (
            db.query(OAuthIdentity).filter(OAuthIdentity.teacher_id == teacher.id).one()
        )
        assert oauth.provider == "google"
        assert oauth.provider_user_id == "google-sub-001"
        assert oauth.provider_email == "brand-new@example.com"
        # identity_id 要補上，才能跟同一 Identity 的其他 provider 對得起來
        assert oauth.identity_id == teacher.identity_id

    def test_second_login_reuses_existing_binding(self, shared_test_session):
        db = shared_test_session

        first, action1 = _login(db, google_sub="sub-repeat", email="repeat@example.com")
        second, action2 = _login(
            db, google_sub="sub-repeat", email="repeat@example.com"
        )

        assert action1 == "created"
        assert action2 == "existing"
        assert first.id == second.id
        assert (
            db.query(OAuthIdentity)
            .filter(OAuthIdentity.provider_user_id == "sub-repeat")
            .count()
            == 1
        )


class TestExistingAccount:
    def test_links_to_verified_teacher_without_touching_password(
        self, shared_test_session
    ):
        db = shared_test_session

        identity = Identity(
            email="verified@example.com", email_verified=True, is_active=True
        )
        db.add(identity)
        db.flush()
        existing = Teacher(
            name="Existing Teacher",
            email="verified@example.com",
            password_hash=get_password_hash("secret123"),
            has_password=True,
            identity_id=identity.id,
            is_active=True,
            email_verified=True,
        )
        db.add(existing)
        db.commit()
        original_hash = existing.password_hash

        teacher, action = _login(
            db, google_sub="sub-link", email="verified@example.com"
        )

        assert action == "linked"
        assert teacher.id == existing.id
        # 雙密碼路徑並存：Google 綁定不影響 Duotopia 密碼
        assert teacher.password_hash == original_hash
        assert teacher.has_password is True
        assert (
            db.query(Teacher).filter(Teacher.email == "verified@example.com").count()
            == 1
        )

    def test_rejects_unverified_existing_teacher(self, shared_test_session):
        db = shared_test_session

        identity = Identity(
            email="unverified@example.com", email_verified=False, is_active=True
        )
        db.add(identity)
        db.flush()
        db.add(
            Teacher(
                name="Unverified Teacher",
                email="unverified@example.com",
                password_hash=get_password_hash("secret123"),
                has_password=True,
                identity_id=identity.id,
                is_active=True,
                email_verified=False,
            )
        )
        db.commit()

        with pytest.raises(GoogleAccountNotVerifiedError):
            _login(db, google_sub="sub-unverified", email="unverified@example.com")

    def test_email_match_is_case_insensitive(self, shared_test_session):
        db = shared_test_session

        identity = Identity(
            email="MiXeD@example.com", email_verified=True, is_active=True
        )
        db.add(identity)
        db.flush()
        existing = Teacher(
            name="Mixed Case",
            email="MiXeD@example.com",
            password_hash=get_password_hash("secret123"),
            identity_id=identity.id,
            is_active=True,
            email_verified=True,
        )
        db.add(existing)
        db.commit()

        teacher, action = _login(db, google_sub="sub-mixed", email="mixed@example.com")

        assert action == "linked"
        assert teacher.id == existing.id

    def test_one_campus_teacher_gets_second_provider_row(self, shared_test_session):
        db = shared_test_session

        identity = Identity(
            email="dual@example.com",
            email_verified=True,
            is_active=True,
            one_campus_uuid="uuid-dual",
            one_campus_account="dual@example.com",
        )
        db.add(identity)
        db.flush()
        teacher_row = Teacher(
            name="Dual Provider",
            email="dual@example.com",
            password_hash=None,
            has_password=False,
            identity_id=identity.id,
            is_active=True,
            email_verified=True,
        )
        db.add(teacher_row)
        db.flush()
        db.add(
            OAuthIdentity(
                teacher_id=teacher_row.id,
                identity_id=identity.id,
                provider="1campus",
                provider_user_id="uuid-dual",
                provider_email="dual@example.com",
            )
        )
        db.commit()

        teacher, action = _login(db, google_sub="sub-dual", email="dual@example.com")

        assert action == "linked"
        assert teacher.id == teacher_row.id
        providers = {
            row.provider
            for row in db.query(OAuthIdentity)
            .filter(OAuthIdentity.teacher_id == teacher_row.id)
            .all()
        }
        assert providers == {"1campus", "google"}


class TestUnverifiedGoogleEmail:
    def test_rejects_when_google_says_unverified(self, shared_test_session):
        with pytest.raises(GoogleEmailNotVerifiedError):
            _login(
                shared_test_session,
                google_sub="sub-google-unverified",
                email="nope@example.com",
                email_verified=False,
            )

    def test_rejects_when_email_missing(self, shared_test_session):
        with pytest.raises(GoogleEmailNotVerifiedError):
            _login(shared_test_session, google_sub="sub-no-email", email=None)
