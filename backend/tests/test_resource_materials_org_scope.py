"""
Resource Materials — organization scope permissions (Issue #1162)

機構視圖下的一般老師（role=teacher）要能「瀏覽」資源教材包，
但「複製到機構」仍需 manage_materials 權限。

- GET  /api/resource-materials?scope=organization   → 任何 active 機構成員可讀
- GET  /api/resource-materials/copy-status?scope=organization → 同上，非成員 403
- POST /api/resource-materials/{id}/copy (organization) → 仍需 manage_materials
"""

import uuid

import pytest
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash
from core.config import settings
from models import Organization, Program, Teacher, TeacherOrganization
from services.casbin_service import get_casbin_service


def _make_teacher(db: Session, email: str, name: str) -> Teacher:
    teacher = Teacher(
        email=email,
        password_hash=get_password_hash("password123"),
        name=name,
        is_active=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def _headers(teacher: Teacher) -> dict:
    token = create_access_token({"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def resource_account(shared_test_session: Session):
    existing = (
        shared_test_session.query(Teacher)
        .filter(Teacher.email == settings.RESOURCE_ACCOUNT_EMAIL)
        .first()
    )
    if existing:
        return existing
    return _make_teacher(
        shared_test_session, settings.RESOURCE_ACCOUNT_EMAIL, "Resource Account"
    )


@pytest.fixture
def resource_programs(shared_test_session: Session, resource_account: Teacher):
    """每種 visibility 各一個資源教材包"""
    programs = {}
    for visibility in ("public", "organization_only", "individual_only", "private"):
        program = Program(
            name=f"RM {visibility} {uuid.uuid4().hex[:6]}",
            teacher_id=resource_account.id,
            is_template=True,
            is_active=True,
            visibility=visibility,
        )
        shared_test_session.add(program)
        programs[visibility] = program
    shared_test_session.commit()
    return programs


@pytest.fixture
def org(shared_test_session: Session):
    organization = Organization(
        name=f"Org {uuid.uuid4().hex[:8]}",
        display_name="Test Org",
        is_active=True,
    )
    shared_test_session.add(organization)
    shared_test_session.commit()
    shared_test_session.refresh(organization)
    return organization


@pytest.fixture
def org_teacher(shared_test_session: Session, org: Organization):
    """機構一般老師：active 成員，沒有 manage_materials"""
    teacher = _make_teacher(
        shared_test_session, f"t_{uuid.uuid4().hex[:8]}@test.com", "Org Teacher"
    )
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="teacher",
            is_active=True,
        )
    )
    shared_test_session.commit()
    get_casbin_service().add_role_for_user(teacher.id, "teacher", f"org-{org.id}")
    return teacher


@pytest.fixture
def org_owner(shared_test_session: Session, org: Organization):
    teacher = _make_teacher(
        shared_test_session, f"own_{uuid.uuid4().hex[:8]}@test.com", "Org Owner"
    )
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
    )
    shared_test_session.commit()
    get_casbin_service().add_role_for_user(teacher.id, "org_owner", f"org-{org.id}")
    return teacher


@pytest.fixture
def outsider(shared_test_session: Session):
    """不屬於該機構的老師"""
    return _make_teacher(
        shared_test_session, f"o_{uuid.uuid4().hex[:8]}@test.com", "Outsider"
    )


class TestListOrganizationScope:
    def test_org_teacher_can_list(
        self, test_client, org, org_teacher, resource_programs
    ):
        res = test_client.get(
            "/api/resource-materials",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(org_teacher),
        )

        assert res.status_code == 200
        ids = {m["id"] for m in res.json()["materials"]}
        assert resource_programs["public"].id in ids
        assert resource_programs["organization_only"].id in ids
        assert resource_programs["individual_only"].id not in ids
        assert resource_programs["private"].id not in ids
        assert res.json()["can_copy"] is False

    def test_org_owner_can_copy_flag(self, test_client, org, org_owner):
        res = test_client.get(
            "/api/resource-materials",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(org_owner),
        )

        assert res.status_code == 200
        assert res.json()["can_copy"] is True

    def test_individual_scope_can_copy_flag(self, test_client, outsider):
        res = test_client.get(
            "/api/resource-materials",
            params={"scope": "individual"},
            headers=_headers(outsider),
        )

        assert res.status_code == 200
        assert res.json()["can_copy"] is True

    def test_non_member_forbidden(self, test_client, org, outsider):
        res = test_client.get(
            "/api/resource-materials",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(outsider),
        )

        assert res.status_code == 403


class TestCopyStatusOrganizationScope:
    def test_org_teacher_can_read(self, test_client, org, org_teacher):
        res = test_client.get(
            "/api/resource-materials/copy-status",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(org_teacher),
        )

        assert res.status_code == 200

    def test_non_member_forbidden(self, test_client, org, outsider):
        res = test_client.get(
            "/api/resource-materials/copy-status",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(outsider),
        )

        assert res.status_code == 403

    def test_invalid_org_id_rejected(self, test_client, org_teacher):
        res = test_client.get(
            "/api/resource-materials/copy-status",
            params={"scope": "organization", "organization_id": "not-a-uuid"},
            headers=_headers(org_teacher),
        )

        assert res.status_code == 400


class TestCopyToOrganization:
    def test_org_teacher_cannot_copy(
        self, test_client, org, org_teacher, resource_programs
    ):
        res = test_client.post(
            f"/api/resource-materials/{resource_programs['public'].id}/copy",
            json={"target_type": "organization", "organization_id": str(org.id)},
            headers=_headers(org_teacher),
        )

        assert res.status_code == 403
