"""
Comprehensive Unit Tests for Organization Programs Router (TDD)

Test Coverage: 6 endpoints, 70%+ target coverage
Router: backend/routers/organization_programs.py

Endpoints:
1. GET /{org_id}/programs - List organization materials
2. GET /{org_id}/programs/{program_id} - Get material details
3. POST /{org_id}/programs - Create organization material
4. PUT /{org_id}/programs/{program_id} - Update organization material
5. DELETE /{org_id}/programs/{program_id} - Soft delete material
6. POST /{org_id}/programs/{program_id}/copy-to-classroom - Copy material to classroom

Test Strategy:
- Permission-based testing (org_owner, org_admin, teacher)
- manage_materials permission enforcement
- is_template=True for organization programs
- Soft delete validation
- Deep copy validation with source_metadata
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
import uuid
from datetime import datetime

from models import (
    Teacher,
    Organization,
    TeacherOrganization,
    Program,
    Lesson,
    Content,
    ContentItem,
    ContentType,
    Classroom,
)
from auth import create_access_token, get_password_hash
from services.casbin_service import get_casbin_service


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def test_db(shared_test_session: Session):
    """Provide test database session"""
    return shared_test_session


@pytest.fixture
def org_owner(test_db: Session):
    """Create organization owner teacher"""
    teacher = Teacher(
        email=f"org_owner_{uuid.uuid4().hex[:8]}@test.com",
        password_hash=get_password_hash("password123"),
        name="Org Owner",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)
    return teacher


@pytest.fixture
def org_admin(test_db: Session):
    """Create org admin teacher"""
    teacher = Teacher(
        email=f"org_admin_{uuid.uuid4().hex[:8]}@test.com",
        password_hash=get_password_hash("password123"),
        name="Org Admin",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)
    return teacher


@pytest.fixture
def regular_teacher(test_db: Session):
    """Create regular teacher"""
    teacher = Teacher(
        email=f"teacher_{uuid.uuid4().hex[:8]}@test.com",
        password_hash=get_password_hash("password123"),
        name="Regular Teacher",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)
    return teacher


@pytest.fixture
def test_org(test_db: Session, org_owner: Teacher):
    """Create test organization with owner"""
    org = Organization(
        name=f"Test Org {uuid.uuid4().hex[:8]}",
        display_name="Test Organization",
        is_active=True,
    )
    test_db.add(org)
    test_db.commit()
    test_db.refresh(org)

    # Add owner relationship
    owner_rel = TeacherOrganization(
        teacher_id=org_owner.id,
        organization_id=org.id,
        role="org_owner",
        is_active=True,
    )
    test_db.add(owner_rel)
    test_db.commit()

    # Setup Casbin permissions
    casbin_service = get_casbin_service()
    casbin_service.add_role_for_user(org_owner.id, "org_owner", f"org-{org.id}")

    return org


@pytest.fixture
def test_org_admin_with_permission(
    test_db: Session, org_admin: Teacher, test_org: Organization
):
    """Add org_admin to org with manage_materials permission"""
    admin_rel = TeacherOrganization(
        teacher_id=org_admin.id,
        organization_id=test_org.id,
        role="org_admin",
        is_active=True,
    )
    test_db.add(admin_rel)
    test_db.commit()

    # Grant manage_materials permission
    casbin_service = get_casbin_service()
    casbin_service.add_role_for_user(org_admin.id, "org_admin", f"org-{test_org.id}")

    return org_admin


@pytest.fixture
def test_org_with_materials(
    test_db: Session, test_org: Organization, org_owner: Teacher
):
    """Create organization with sample materials"""
    materials = []

    for i in range(3):
        # Create organization program (is_template=True)
        program = Program(
            name=f"Org Material {i+1}",
            description=f"Organization material {i+1}",
            is_template=True,  # Organization materials are templates
            teacher_id=org_owner.id,
            organization_id=test_org.id,  # Use organization_id column
            is_active=True,
        )
        test_db.add(program)
        test_db.flush()

        # Create lesson
        lesson = Lesson(
            program_id=program.id,
            name=f"Lesson {i+1}",
            description=f"Test lesson {i+1}",
            order_index=0,
        )
        test_db.add(lesson)
        test_db.flush()

        # Create content
        content = Content(
            lesson_id=lesson.id,
            type=ContentType.READING_ASSESSMENT,
            title=f"Content {i+1}",
            order_index=0,
        )
        test_db.add(content)
        test_db.flush()

        # Create content items
        for j in range(2):
            item = ContentItem(
                content_id=content.id,
                text=f"Test text {i+1}-{j+1}",
                translation=f"翻譯 {i+1}-{j+1}",
                order_index=j,
            )
            test_db.add(item)

        materials.append(program)

    test_db.commit()
    for m in materials:
        test_db.refresh(m)

    return materials


@pytest.fixture
def test_teacher_with_classroom(
    test_db: Session, regular_teacher: Teacher, test_org: Organization
):
    """Create teacher with a classroom in the organization"""
    # Add teacher to org
    teacher_rel = TeacherOrganization(
        teacher_id=regular_teacher.id,
        organization_id=test_org.id,
        role="teacher",
        is_active=True,
    )
    test_db.add(teacher_rel)
    test_db.commit()

    # Create classroom
    classroom = Classroom(
        name="Test Classroom",
        teacher_id=regular_teacher.id,
        description="Test classroom",
    )
    test_db.add(classroom)
    test_db.commit()
    test_db.refresh(classroom)

    return {"teacher": regular_teacher, "classroom": classroom}


@pytest.fixture
def owner_headers(org_owner: Teacher):
    """Generate auth headers for org owner"""
    token = create_access_token({"sub": str(org_owner.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers(org_admin: Teacher):
    """Generate auth headers for org admin"""
    token = create_access_token({"sub": str(org_admin.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def teacher_headers(regular_teacher: Teacher):
    """Generate auth headers for regular teacher"""
    token = create_access_token({"sub": str(regular_teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# Test Cases: List Organization Materials (GET)
# ============================================================================


class TestListOrganizationMaterials:
    """Test suite for GET /{org_id}/programs"""

    def test_org_owner_can_list_materials(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """org_owner can list all organization materials"""
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        assert all(item["is_template"] is True for item in data)

    def test_org_admin_can_list_materials(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_org_admin_with_permission: Teacher,
        admin_headers: dict,
    ):
        """org_admin with manage_materials permission can list materials"""
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=admin_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3

    def test_regular_teacher_gets_403(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        teacher_headers: dict,
    ):
        """Regular teacher without permission gets 403"""
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=teacher_headers,
        )

        assert response.status_code == 403
        assert "permission" in response.json()["detail"].lower()

    def test_empty_list_when_no_materials(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """Returns empty list when organization has no materials"""
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data == []

    def test_only_shows_active_materials(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Only shows active materials (is_active=True)"""
        # Soft delete one material
        test_org_with_materials[0].is_active = False
        test_db.commit()

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2  # Only 2 active materials
        assert all(item["is_active"] is True for item in data)


# ============================================================================
# Test Cases: Get Material Details (GET)
# ============================================================================


class TestGetMaterialDetails:
    """Test suite for GET /{org_id}/programs/{program_id}"""

    def test_org_owner_can_get_details(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """org_owner can get material details"""
        material = test_org_with_materials[0]

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == material.id
        assert data["name"] == material.name
        assert data["is_template"] is True

    def test_org_admin_can_get_details(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_org_admin_with_permission: Teacher,
        admin_headers: dict,
    ):
        """org_admin with permission can get material details"""
        material = test_org_with_materials[0]

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=admin_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == material.id

    def test_regular_teacher_gets_403(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        teacher_headers: dict,
    ):
        """Regular teacher gets 403"""
        material = test_org_with_materials[0]

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=teacher_headers,
        )

        assert response.status_code == 403

    def test_404_when_material_not_exists(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """Returns 404 when material doesn't exist"""
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/99999",
            headers=owner_headers,
        )

        assert response.status_code == 404

    def test_includes_lessons_contents_items(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Response includes lessons, contents, and items"""
        material = test_org_with_materials[0]

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "lessons" in data
        assert len(data["lessons"]) > 0
        assert "contents" in data["lessons"][0]
        assert "items" in data["lessons"][0]["contents"][0]


# ============================================================================
# Test Cases: Program-Direct Contents (Issue #587/#847)
# ============================================================================


class TestProgramDirectContents:
    """
    Issue #847: contents living directly under a program (lesson_id IS NULL)
    must be returned by both the list and detail endpoints, otherwise the
    org-materials UI cannot show them and the card count is wrong.
    """

    def _add_program_direct_content(
        self, test_db: Session, program: Program, title: str = "Program Content"
    ) -> Content:
        content = Content(
            lesson_id=None,
            program_id=program.id,
            type=ContentType.READING_ASSESSMENT,
            title=title,
            order_index=0,
            is_active=True,
        )
        test_db.add(content)
        test_db.flush()
        test_db.add(
            ContentItem(
                content_id=content.id,
                text="direct item",
                translation="直屬項目",
                order_index=0,
            )
        )
        test_db.commit()
        test_db.refresh(content)
        return content

    def test_detail_includes_program_direct_contents(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Detail endpoint returns program-level contents with items."""
        material = test_org_with_materials[0]
        content = self._add_program_direct_content(test_db, material)

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "contents" in data
        ids = [c["id"] for c in data["contents"]]
        assert content.id in ids
        direct = next(c for c in data["contents"] if c["id"] == content.id)
        assert direct["lesson_id"] is None
        assert direct["program_id"] == material.id
        assert direct["items_count"] == 1

    def test_list_includes_program_direct_contents(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """List endpoint returns program-level contents for each material."""
        material = test_org_with_materials[0]
        content = self._add_program_direct_content(test_db, material)

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        target = next(p for p in data if p["id"] == material.id)
        assert content.id in [c["id"] for c in target["contents"]]


# ============================================================================
# Test Cases: Create Material (POST)
# ============================================================================


class TestCreateMaterial:
    """Test suite for POST /{org_id}/programs"""

    def test_org_owner_can_create_with_permission(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """org_owner can create organization material"""
        payload = {
            "name": "New Org Material",
            "description": "Test material",
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs",
            json=payload,
            headers=owner_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == payload["name"]
        assert data["is_template"] is True  # Automatically set

    def test_org_admin_can_create_with_permission(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_admin_with_permission: Teacher,
        admin_headers: dict,
    ):
        """org_admin with manage_materials permission can create"""
        payload = {
            "name": "Admin Created Material",
            "description": "Test",
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs",
            json=payload,
            headers=admin_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == payload["name"]

    def test_regular_teacher_gets_403(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        teacher_headers: dict,
    ):
        """Regular teacher without permission gets 403"""
        payload = {
            "name": "Unauthorized Material",
            "description": "Should fail",
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs",
            json=payload,
            headers=teacher_headers,
        )

        assert response.status_code == 403

    def test_sets_is_template_true_automatically(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """Organization materials automatically have is_template=True"""
        payload = {
            "name": "Template Material",
            "description": "Test",
            "is_template": False,  # Even if explicitly set to False
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs",
            json=payload,
            headers=owner_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["is_template"] is True  # Forced to True

    def test_sets_organization_id_correctly(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """Organization ID is correctly set in organization_id column"""
        payload = {
            "name": "Org Material",
            "description": "Test",
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs",
            json=payload,
            headers=owner_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert "organization_id" in data
        assert data["organization_id"] == str(test_org.id)

    def test_validates_required_fields(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """Validates required fields (name)"""
        payload = {
            "description": "Missing name field",
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs",
            json=payload,
            headers=owner_headers,
        )

        assert response.status_code == 422  # Validation error


# ============================================================================
# Test Cases: Update Material (PUT)
# ============================================================================


class TestUpdateMaterial:
    """Test suite for PUT /{org_id}/programs/{program_id}"""

    def test_org_owner_can_update(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """org_owner can update material"""
        material = test_org_with_materials[0]
        payload = {
            "name": "Updated Material Name",
            "description": "Updated description",
        }

        response = test_client.put(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            json=payload,
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == payload["name"]
        assert data["description"] == payload["description"]

    def test_org_admin_can_update_with_permission(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_org_admin_with_permission: Teacher,
        admin_headers: dict,
    ):
        """org_admin with permission can update"""
        material = test_org_with_materials[0]
        payload = {
            "name": "Admin Updated",
        }

        response = test_client.put(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            json=payload,
            headers=admin_headers,
        )

        assert response.status_code == 200

    def test_regular_teacher_gets_403(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        teacher_headers: dict,
    ):
        """Regular teacher gets 403"""
        material = test_org_with_materials[0]
        payload = {
            "name": "Unauthorized Update",
        }

        response = test_client.put(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            json=payload,
            headers=teacher_headers,
        )

        assert response.status_code == 403

    def test_404_when_material_not_exists(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        owner_headers: dict,
    ):
        """Returns 404 when material doesn't exist"""
        payload = {
            "name": "Non-existent Material",
        }

        response = test_client.put(
            f"/api/organizations/{test_org.id}/programs/99999",
            json=payload,
            headers=owner_headers,
        )

        assert response.status_code == 404

    def test_cannot_update_to_different_organization(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Cannot change organization_id via update"""
        material = test_org_with_materials[0]
        different_org_id = str(uuid.uuid4())

        payload = {
            "name": "Updated Name",
            "organization_id": different_org_id,  # Try to change org_id
        }

        response = test_client.put(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            json=payload,
            headers=owner_headers,
        )

        # Should either ignore the change or return error
        assert response.status_code in [200, 400]
        if response.status_code == 200:
            data = response.json()
            # Organization ID should remain unchanged
            assert data["organization_id"] == str(test_org.id)


# ============================================================================
# Test Cases: Soft Delete Material (DELETE)
# ============================================================================


class TestSoftDeleteMaterial:
    """Test suite for DELETE /{org_id}/programs/{program_id}"""

    def test_org_owner_can_delete(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """org_owner can soft delete material"""
        material = test_org_with_materials[0]

        response = test_client.delete(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        assert response.status_code == 200

        # Verify soft delete
        test_db.refresh(material)
        assert material.is_active is False

    def test_org_admin_can_delete_with_permission(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_org_admin_with_permission: Teacher,
        admin_headers: dict,
    ):
        """org_admin with permission can delete"""
        material = test_org_with_materials[0]

        response = test_client.delete(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=admin_headers,
        )

        assert response.status_code == 200

    def test_regular_teacher_gets_403(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        teacher_headers: dict,
    ):
        """Regular teacher gets 403"""
        material = test_org_with_materials[0]

        response = test_client.delete(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=teacher_headers,
        )

        assert response.status_code == 403

    def test_sets_is_active_false(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Soft delete sets is_active=False (not hard delete)"""
        material = test_org_with_materials[0]
        material_id = material.id

        response = test_client.delete(
            f"/api/organizations/{test_org.id}/programs/{material_id}",
            headers=owner_headers,
        )

        assert response.status_code == 200

        # Material still exists in database
        deleted_material = (
            test_db.query(Program).filter(Program.id == material_id).first()
        )
        assert deleted_material is not None
        assert deleted_material.is_active is False

    def test_deleted_materials_not_in_list(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Deleted materials don't appear in list endpoint"""
        material = test_org_with_materials[0]

        # Delete material
        test_client.delete(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        # List materials
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=owner_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2  # Only 2 active materials remain
        assert all(item["id"] != material.id for item in data)

    def test_can_still_retrieve_by_id_for_audit(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        """Can still retrieve deleted material by ID (for audit purposes)"""
        material = test_org_with_materials[0]

        # Delete material
        test_client.delete(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        # Try to retrieve by ID
        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        # Should either return with is_active=False or 404
        # Implementation decision: allow retrieving for audit
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            data = response.json()
            assert data["is_active"] is False


# ============================================================================
# Test Cases: Copy to Classroom (POST)
# ============================================================================


class TestCopyToClassroom:
    """Test suite for POST /{org_id}/programs/{program_id}/copy-to-classroom"""

    def test_teacher_can_copy_org_material_to_classroom(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_teacher_with_classroom: dict,
        teacher_headers: dict,
    ):
        """Teacher can copy organization material to their classroom"""
        material = test_org_with_materials[0]
        classroom = test_teacher_with_classroom["classroom"]

        payload = {
            "classroom_id": classroom.id,
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs/{material.id}/copy-to-classroom",
            json=payload,
            headers=teacher_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["classroom_id"] == classroom.id
        assert data["is_template"] is False  # Copied version is not template

    def test_deep_copy_program_lessons_contents_items(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_teacher_with_classroom: dict,
        teacher_headers: dict,
    ):
        """Deep copy includes Program → Lessons → Contents → Items"""
        material = test_org_with_materials[0]
        classroom = test_teacher_with_classroom["classroom"]

        # Get original structure
        original_lessons = (
            test_db.query(Lesson).filter(Lesson.program_id == material.id).all()
        )
        original_lesson_count = len(original_lessons)

        payload = {
            "classroom_id": classroom.id,
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs/{material.id}/copy-to-classroom",
            json=payload,
            headers=teacher_headers,
        )

        assert response.status_code == 201
        data = response.json()

        # Verify deep copy
        assert "lessons" in data
        assert len(data["lessons"]) == original_lesson_count

        for lesson in data["lessons"]:
            assert "contents" in lesson
            assert len(lesson["contents"]) > 0

            for content in lesson["contents"]:
                assert "items" in content
                assert len(content["items"]) > 0

    def test_source_metadata_set_correctly(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_teacher_with_classroom: dict,
        teacher_headers: dict,
    ):
        """source_metadata correctly identifies origin"""
        material = test_org_with_materials[0]
        classroom = test_teacher_with_classroom["classroom"]

        payload = {
            "classroom_id": classroom.id,
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs/{material.id}/copy-to-classroom",
            json=payload,
            headers=teacher_headers,
        )

        assert response.status_code == 201
        data = response.json()

        metadata = data["source_metadata"]
        assert metadata["organization_id"] == str(test_org.id)
        assert metadata["program_id"] == material.id
        assert metadata["program_name"] == material.name
        assert metadata["source_type"] == "org_template"
        assert "organization_name" in metadata

    def test_copied_material_is_independent(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        test_teacher_with_classroom: dict,
        teacher_headers: dict,
        owner_headers: dict,
    ):
        """Copied material can be edited without affecting original"""
        material = test_org_with_materials[0]
        classroom = test_teacher_with_classroom["classroom"]

        # Copy material
        payload = {
            "classroom_id": classroom.id,
        }

        copy_response = test_client.post(
            f"/api/organizations/{test_org.id}/programs/{material.id}/copy-to-classroom",
            json=payload,
            headers=teacher_headers,
        )

        assert copy_response.status_code == 201
        copied_material = copy_response.json()

        # Update copied material (would need a teacher programs endpoint)
        # This test verifies that IDs are different
        assert copied_material["id"] != material.id

        # Verify original is unchanged
        original_response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{material.id}",
            headers=owner_headers,
        )

        assert original_response.status_code == 200
        original_data = original_response.json()
        assert original_data["name"] == material.name

    def test_cannot_copy_to_classroom_in_different_organization(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        regular_teacher: Teacher,
        teacher_headers: dict,
    ):
        """Cannot copy to classroom in a different organization"""
        material = test_org_with_materials[0]

        # Create classroom NOT in the organization
        external_classroom = Classroom(
            name="External Classroom",
            teacher_id=regular_teacher.id,
            description="Not in organization",
        )
        test_db.add(external_classroom)
        test_db.commit()
        test_db.refresh(external_classroom)

        payload = {
            "classroom_id": external_classroom.id,
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs/{material.id}/copy-to-classroom",
            json=payload,
            headers=teacher_headers,
        )

        # Should fail - classroom must be in same organization
        assert response.status_code == 403

    def test_404_when_source_material_not_exists(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_teacher_with_classroom: dict,
        teacher_headers: dict,
    ):
        """Returns 404 when source material doesn't exist"""
        classroom = test_teacher_with_classroom["classroom"]

        payload = {
            "classroom_id": classroom.id,
        }

        response = test_client.post(
            f"/api/organizations/{test_org.id}/programs/99999/copy-to-classroom",
            json=payload,
            headers=teacher_headers,
        )

        assert response.status_code == 404


# ============================================================================
# Test Cases: Assignment copies must not appear in org materials (#785)
# ============================================================================


class TestAssignmentCopyExcludedFromOrgMaterials:
    """Regression for #785: dispatched-assignment Content copies are stored
    under the same Lesson as the template, but must NOT show up in the
    organization materials listing or detail response."""

    def _add_assignment_copy(self, test_db: Session, original: Content) -> Content:
        copy = Content(
            lesson_id=original.lesson_id,
            type=original.type,
            title=original.title,
            order_index=original.order_index,
            is_active=True,
            is_assignment_copy=True,
            source_content_id=original.id,
        )
        test_db.add(copy)
        test_db.commit()
        test_db.refresh(copy)
        return copy

    def test_list_excludes_assignment_copies(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        for program in test_org_with_materials:
            for lesson in program.lessons:
                for content in lesson.contents:
                    self._add_assignment_copy(test_db, content)

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs",
            headers=owner_headers,
        )
        assert response.status_code == 200
        data = response.json()
        for program in data:
            for lesson in program["lessons"]:
                assert (
                    len(lesson["contents"]) == 1
                ), "assignment copies leaked into materials list"

    def test_detail_excludes_assignment_copies(
        self,
        test_client: TestClient,
        test_db: Session,
        test_org: Organization,
        test_org_with_materials: list,
        owner_headers: dict,
    ):
        program = test_org_with_materials[0]
        original_content = program.lessons[0].contents[0]
        self._add_assignment_copy(test_db, original_content)
        self._add_assignment_copy(test_db, original_content)

        response = test_client.get(
            f"/api/organizations/{test_org.id}/programs/{program.id}",
            headers=owner_headers,
        )
        assert response.status_code == 200
        data = response.json()
        contents = data["lessons"][0]["contents"]
        assert len(contents) == 1
        assert contents[0]["id"] == original_content.id


# ============================================================================
# Summary
# ============================================================================

"""
Test Summary:
- Total test classes: 6
- Total test methods: 36
- Coverage areas:
  * Permission validation (org_owner, org_admin, teacher)
  * manage_materials permission enforcement
  * is_template=True enforcement for org materials
  * Soft delete functionality
  * Deep copy with source_metadata
  * Cross-organization isolation

Expected Coverage: 70%+

To run tests:
    pytest backend/tests/test_organization_programs.py -v
        --cov=backend/routers/organization_programs --cov-report=term-missing

Note: This is a TDD test file. The router implementation (backend/routers/organization_programs.py)
needs to be created to make these tests pass.
"""
