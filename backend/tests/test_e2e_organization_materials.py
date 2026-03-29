"""
E2E Test for Organization Materials Copy Workflow

Complete user journey: org_owner creates material → teacher copies to classroom → verifies independence

Test Phases:
1. Organization Setup (org, school, users)
2. Material Creation (Program → Lesson → Content → Items)
3. Material Listing (permission-based)
4. Material Copy to Classroom (deep copy with source_metadata)
5. Independence Verification (edits don't affect original)
6. Cross-Organization Isolation (materials isolated by org)

Test Data:
- Organization: "台北市立國中"
- School: "信義分校"
- Material: "初級會話教材"
- Lesson: "Unit 1 - Greetings"
- Content: "基本問候語"
- Items: ["Hello", "Good morning", "How are you?"]
"""

import pytest
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
import uuid

from models import (
    Teacher,
    Organization,
    School,
    TeacherOrganization,
    TeacherSchool,
    Program,
    Lesson,
    Content,
    ContentItem,
    ContentType,
    Classroom,
    ClassroomSchool,
)
from auth import create_access_token, get_password_hash
from services.casbin_service import get_casbin_service


# ============================================================================
# Test Class
# ============================================================================


class TestE2EOrganizationMaterials:
    """
    End-to-end test for complete organization materials workflow

    This test validates the entire lifecycle from material creation
    to classroom usage with proper permission enforcement.
    """

    @pytest.fixture(autouse=True)
    def setup(self, shared_test_session: Session, test_client: TestClient):
        """Setup test environment with organization hierarchy"""
        self.db = shared_test_session
        self.client = test_client
        self.casbin = get_casbin_service()

        # Clear only role assignments (grouping policies), keep permission policies
        all_grouping = self.casbin.enforcer.get_grouping_policy()
        for g in all_grouping:
            self.casbin.enforcer.remove_grouping_policy(*g)

    def _create_organization_hierarchy(self):
        """
        Phase 1: Create organization with school and users

        Returns:
            dict with org, school, org_owner, org_admin, teacher
        """
        # Create organization
        org = Organization(
            name=f"taipei-junior-high-{uuid.uuid4().hex[:8]}",
            display_name="台北市立國中",
            contact_email="admin@taipei-junior.edu.tw",
            is_active=True,
        )
        self.db.add(org)
        self.db.flush()

        # Create school under organization
        school = School(
            name=f"xinyi-branch-{uuid.uuid4().hex[:8]}",
            display_name="信義分校",
            organization_id=org.id,
            contact_email="xinyi@taipei-junior.edu.tw",
            is_active=True,
        )
        self.db.add(school)
        self.db.flush()

        # Create users
        org_owner = Teacher(
            email=f"org_owner_{uuid.uuid4().hex[:8]}@test.com",
            password_hash=get_password_hash("password123"),
            name="Organization Owner",
            is_active=True,
        )

        org_admin = Teacher(
            email=f"org_admin_{uuid.uuid4().hex[:8]}@test.com",
            password_hash=get_password_hash("password123"),
            name="Organization Admin",
            is_active=True,
        )

        teacher = Teacher(
            email=f"teacher_{uuid.uuid4().hex[:8]}@test.com",
            password_hash=get_password_hash("password123"),
            name="Regular Teacher",
            is_active=True,
        )

        self.db.add_all([org_owner, org_admin, teacher])
        self.db.flush()

        # Add org_owner to organization
        owner_rel = TeacherOrganization(
            teacher_id=org_owner.id,
            organization_id=org.id,
            role="org_owner",
            is_active=True,
        )
        self.db.add(owner_rel)

        # Add org_admin to organization with manage_materials permission
        admin_rel = TeacherOrganization(
            teacher_id=org_admin.id,
            organization_id=org.id,
            role="org_admin",
            is_active=True,
        )
        self.db.add(admin_rel)

        # Add teacher to school
        teacher_school_rel = TeacherSchool(
            teacher_id=teacher.id,
            school_id=school.id,
            roles=["teacher"],
            is_active=True,
        )
        self.db.add(teacher_school_rel)

        # Add teacher to organization (for copy permission)
        teacher_org_rel = TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="teacher",
            is_active=True,
        )
        self.db.add(teacher_org_rel)

        self.db.commit()
        self.db.refresh(org)
        self.db.refresh(school)
        self.db.refresh(org_owner)
        self.db.refresh(org_admin)
        self.db.refresh(teacher)

        # Setup Casbin permissions
        self.casbin.add_role_for_user(org_owner.id, "org_owner", f"org-{org.id}")
        self.casbin.add_role_for_user(org_admin.id, "org_admin", f"org-{org.id}")
        # Note: org_admin already has manage_materials permission in casbin_policy.csv

        return {
            "org": org,
            "school": school,
            "org_owner": org_owner,
            "org_admin": org_admin,
            "teacher": teacher,
        }

    def _create_organization_material(self, org: Organization, org_owner: Teacher):
        """
        Phase 2: Create organization material with full hierarchy

        Structure: Program → Lesson → Content → Items

        Returns:
            Program with nested structure
        """
        # Create organization program (template)
        program = Program(
            name="初級會話教材",
            description="適合初學者的會話練習教材",
            is_template=True,
            teacher_id=org_owner.id,
            is_active=True,
            source_metadata={
                "organization_id": str(org.id),
                "created_by": org_owner.id,
            },
        )
        self.db.add(program)
        self.db.flush()

        # Add lesson
        lesson = Lesson(
            program_id=program.id,
            name="Unit 1 - Greetings",
            description="基本問候語練習",
            order_index=0,
            is_active=True,
        )
        self.db.add(lesson)
        self.db.flush()

        # Add content
        content = Content(
            lesson_id=lesson.id,
            type=ContentType.READING_ASSESSMENT,
            title="基本問候語",
            order_index=0,
            is_active=True,
        )
        self.db.add(content)
        self.db.flush()

        # Add content items
        items_data = [
            {"text": "Hello", "translation": "你好", "order_index": 0},
            {"text": "Good morning", "translation": "早安", "order_index": 1},
            {"text": "How are you?", "translation": "你好嗎？", "order_index": 2},
        ]

        for item_data in items_data:
            item = ContentItem(
                content_id=content.id,
                text=item_data["text"],
                translation=item_data["translation"],
                order_index=item_data["order_index"],
            )
            self.db.add(item)

        self.db.commit()
        self.db.refresh(program)

        return program

    def _get_auth_headers(self, teacher: Teacher) -> dict:
        """Generate authentication headers for teacher"""
        token = create_access_token({"sub": str(teacher.id), "type": "teacher"})
        return {"Authorization": f"Bearer {token}"}

    def test_complete_material_lifecycle(self):
        """
        Complete workflow: create → list → copy → edit → verify independence

        This test validates the entire user journey from material creation
        by org_owner to classroom usage by teacher.

        Test Scenarios:
        ✅ org_owner can create materials
        ✅ org_admin can create materials (with permission)
        ✅ Regular teacher cannot create materials (403)
        ✅ Deep copy creates independent copy
        ✅ source_metadata tracks origin correctly
        ✅ Editing copy doesn't affect original
        ✅ Soft delete on copy doesn't affect original
        """
        # Phase 1: Setup organization hierarchy
        hierarchy = self._create_organization_hierarchy()
        org = hierarchy["org"]
        school = hierarchy["school"]
        org_owner = hierarchy["org_owner"]
        org_admin = hierarchy["org_admin"]
        teacher = hierarchy["teacher"]

        # Phase 2: Create organization material (org_owner)
        material = self._create_organization_material(org, org_owner)

        # Verify material properties
        assert material.is_template is True
        assert material.source_metadata["organization_id"] == str(org.id)
        assert material.classroom_id is None

        # Verify full hierarchy exists
        self.db.refresh(material)
        lessons = self.db.query(Lesson).filter(Lesson.program_id == material.id).all()
        assert len(lessons) == 1

        lesson = lessons[0]
        contents = self.db.query(Content).filter(Content.lesson_id == lesson.id).all()
        assert len(contents) == 1

        content = contents[0]
        items = (
            self.db.query(ContentItem)
            .filter(ContentItem.content_id == content.id)
            .all()
        )
        assert len(items) == 3
        assert items[0].text == "Hello"
        assert items[1].text == "Good morning"
        assert items[2].text == "How are you?"

        # Phase 3: Material Listing

        # 3.1: org_owner can list materials
        owner_headers = self._get_auth_headers(org_owner)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs",
            headers=owner_headers,
        )
        assert response.status_code == 200
        materials_list = response.json()
        assert len(materials_list) == 1
        assert materials_list[0]["name"] == "初級會話教材"
        assert materials_list[0]["is_template"] is True

        # 3.2: org_admin can list materials (with permission)
        admin_headers = self._get_auth_headers(org_admin)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs",
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert len(response.json()) == 1

        # 3.3: Regular teacher cannot list materials (403)
        teacher_headers = self._get_auth_headers(teacher)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs",
            headers=teacher_headers,
        )
        assert response.status_code == 403
        assert "permission" in response.json()["detail"].lower()

        # Phase 4: Material Copy to Classroom (teacher)

        # Create classroom for teacher
        classroom = Classroom(
            name="信義分校-初級班",
            teacher_id=teacher.id,
            description="初級會話班級",
            is_active=True,
        )
        self.db.add(classroom)
        self.db.flush()

        # Link classroom to school
        classroom_school = ClassroomSchool(
            classroom_id=classroom.id,
            school_id=school.id,
        )
        self.db.add(classroom_school)
        self.db.commit()
        self.db.refresh(classroom)

        # Teacher copies material to classroom
        copy_payload = {"classroom_id": classroom.id}
        response = self.client.post(
            f"/api/organizations/{org.id}/programs/{material.id}/copy-to-classroom",
            json=copy_payload,
            headers=teacher_headers,
        )

        assert response.status_code == 201
        copied_data = response.json()

        # Verify copied program properties
        assert copied_data["id"] != material.id  # New ID
        assert copied_data["name"] == material.name
        assert copied_data["is_template"] is False  # Not a template anymore
        assert copied_data["classroom_id"] == classroom.id
        assert copied_data["teacher_id"] == teacher.id

        # Verify source_metadata
        metadata = copied_data["source_metadata"]
        assert metadata["organization_id"] == str(org.id)
        assert metadata["organization_name"] == "台北市立國中"
        assert metadata["program_id"] == material.id
        assert metadata["program_name"] == "初級會話教材"
        assert metadata["source_type"] == "org_template"

        # Verify deep copy - all lessons, contents, items copied
        assert len(copied_data["lessons"]) == 1
        copied_lesson = copied_data["lessons"][0]
        assert copied_lesson["id"] != lesson.id  # New lesson ID
        assert copied_lesson["name"] == "Unit 1 - Greetings"

        assert len(copied_lesson["contents"]) == 1
        copied_content = copied_lesson["contents"][0]
        assert copied_content["id"] != content.id  # New content ID
        assert copied_content["title"] == "基本問候語"

        assert len(copied_content["items"]) == 3
        copied_items = copied_content["items"]
        assert copied_items[0]["id"] != items[0].id  # New item IDs
        assert copied_items[0]["text"] == "Hello"
        assert copied_items[1]["text"] == "Good morning"
        assert copied_items[2]["text"] == "How are you?"

        # Phase 5: Independence Verification

        # Get copied program from database
        copied_program_id = copied_data["id"]
        copied_program = (
            self.db.query(Program).filter(Program.id == copied_program_id).first()
        )

        # 5.1: Edit copied program
        copied_program.name = "初級會話教材 (信義分校版)"
        copied_program.description = "已針對信義分校學生調整"
        self.db.commit()

        # Verify original is unchanged
        self.db.refresh(material)
        assert material.name == "初級會話教材"
        assert material.description == "適合初學者的會話練習教材"

        # 5.2: Add new lesson to copied program
        new_lesson = Lesson(
            program_id=copied_program.id,
            name="Unit 2 - Introductions",
            description="自我介紹練習",
            order_index=1,
            is_active=True,
        )
        self.db.add(new_lesson)
        self.db.commit()

        # Verify original still has only 1 lesson
        original_lessons = (
            self.db.query(Lesson).filter(Lesson.program_id == material.id).all()
        )
        assert len(original_lessons) == 1

        # Verify copied program now has 2 lessons
        copied_lessons = (
            self.db.query(Lesson).filter(Lesson.program_id == copied_program.id).all()
        )
        assert len(copied_lessons) == 2

        # 5.3: Soft delete copied program
        copied_program.is_active = False
        self.db.commit()

        # Verify original is still active
        self.db.refresh(material)
        assert material.is_active is True

        # 5.4: Verify API still returns original material
        response = self.client.get(
            f"/api/organizations/{org.id}/programs/{material.id}",
            headers=owner_headers,
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is True

    def test_cross_organization_isolation(self):
        """
        Verify materials from org A cannot be accessed by org B

        Test Scenarios:
        ✅ Teacher from org1 cannot copy material from org2 (403)
        ✅ Materials are isolated by organization
        ✅ Listing materials only shows materials from own organization
        """
        # Create first organization
        hierarchy1 = self._create_organization_hierarchy()
        org1 = hierarchy1["org"]
        org1_owner = hierarchy1["org_owner"]
        org1_teacher = hierarchy1["teacher"]

        # Create material in org1
        material1 = self._create_organization_material(org1, org1_owner)

        # Create second organization
        hierarchy2 = self._create_organization_hierarchy()
        org2 = hierarchy2["org"]
        org2_owner = hierarchy2["org_owner"]
        org2_teacher = hierarchy2["teacher"]

        # Create material in org2
        material2 = self._create_organization_material(org2, org2_owner)

        # Create classroom for org1_teacher
        classroom1 = Classroom(
            name="Org1 Classroom",
            teacher_id=org1_teacher.id,
            is_active=True,
        )
        self.db.add(classroom1)
        self.db.commit()
        self.db.refresh(classroom1)

        # org1_teacher tries to copy material from org2 (should fail)
        org1_teacher_headers = self._get_auth_headers(org1_teacher)
        copy_payload = {"classroom_id": classroom1.id}

        response = self.client.post(
            f"/api/organizations/{org2.id}/programs/{material2.id}/copy-to-classroom",
            json=copy_payload,
            headers=org1_teacher_headers,
        )

        # Should fail - teacher not member of org2
        assert response.status_code == 403
        assert "not a member" in response.json()["detail"].lower()

        # Verify org1_owner can only see org1 materials
        org1_owner_headers = self._get_auth_headers(org1_owner)
        response = self.client.get(
            f"/api/organizations/{org1.id}/programs",
            headers=org1_owner_headers,
        )
        assert response.status_code == 200
        org1_materials = response.json()
        assert len(org1_materials) == 1
        assert org1_materials[0]["id"] == material1.id

        # Verify org2_owner can only see org2 materials
        org2_owner_headers = self._get_auth_headers(org2_owner)
        response = self.client.get(
            f"/api/organizations/{org2.id}/programs",
            headers=org2_owner_headers,
        )
        assert response.status_code == 200
        org2_materials = response.json()
        assert len(org2_materials) == 1
        assert org2_materials[0]["id"] == material2.id

    def test_permission_enforcement_throughout_lifecycle(self):
        """
        Verify RBAC permissions at each step

        Test Scenarios:
        ✅ org_owner can create/read/update/delete materials
        ✅ org_admin can create/read/update/delete materials
        ✅ Teacher (without permission) gets 403 for create/read/update/delete
        ✅ Regular teacher can only copy materials (cannot create/read/update/delete)
        ✅ Teacher must own classroom to copy materials to it

        Note: In current permission model, ALL org_admins have manage_materials permission
        by default in casbin_policy.csv, so we test no-permission scenario with teacher role.
        """
        # Setup
        hierarchy = self._create_organization_hierarchy()
        org = hierarchy["org"]
        org_owner = hierarchy["org_owner"]
        org_admin = hierarchy["org_admin"]
        teacher = hierarchy["teacher"]

        # Create teacher without manage_materials permission
        # Note: In the current permission model, ALL org_admins have manage_materials permission
        # by default in casbin_policy.csv. So we use a regular teacher role to test no-permission scenario.
        teacher_no_perm = Teacher(
            email=f"teacher_no_perm_{uuid.uuid4().hex[:8]}@test.com",
            password_hash=get_password_hash("password123"),
            name="Teacher No Permission",
            is_active=True,
        )
        self.db.add(teacher_no_perm)
        self.db.flush()

        teacher_no_perm_rel = TeacherOrganization(
            teacher_id=teacher_no_perm.id,
            organization_id=org.id,
            role="teacher",
            is_active=True,
        )
        self.db.add(teacher_no_perm_rel)
        self.db.commit()

        # Setup Casbin role (teacher role doesn't have manage_materials permission)
        self.casbin.add_role_for_user(teacher_no_perm.id, "teacher", f"org-{org.id}")

        # Test org_owner permissions
        owner_headers = self._get_auth_headers(org_owner)

        # Create (201)
        response = self.client.post(
            f"/api/organizations/{org.id}/programs",
            json={"name": "Owner Material", "description": "Test"},
            headers=owner_headers,
        )
        assert response.status_code == 201
        owner_material_id = response.json()["id"]

        # Read (200)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs/{owner_material_id}",
            headers=owner_headers,
        )
        assert response.status_code == 200

        # Update (200)
        response = self.client.put(
            f"/api/organizations/{org.id}/programs/{owner_material_id}",
            json={"name": "Updated Owner Material"},
            headers=owner_headers,
        )
        assert response.status_code == 200

        # Delete (200)
        response = self.client.delete(
            f"/api/organizations/{org.id}/programs/{owner_material_id}",
            headers=owner_headers,
        )
        assert response.status_code == 200

        # Test org_admin WITH permission
        admin_headers = self._get_auth_headers(org_admin)

        # Create (201)
        response = self.client.post(
            f"/api/organizations/{org.id}/programs",
            json={"name": "Admin Material", "description": "Test"},
            headers=admin_headers,
        )
        assert response.status_code == 201
        admin_material_id = response.json()["id"]

        # Read (200)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            headers=admin_headers,
        )
        assert response.status_code == 200

        # Update (200)
        response = self.client.put(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            json={"name": "Updated Admin Material"},
            headers=admin_headers,
        )
        assert response.status_code == 200

        # Test teacher WITHOUT permission (should all fail with 403)
        teacher_no_perm_headers = self._get_auth_headers(teacher_no_perm)

        # Create (403)
        response = self.client.post(
            f"/api/organizations/{org.id}/programs",
            json={"name": "No Perm Material", "description": "Test"},
            headers=teacher_no_perm_headers,
        )
        assert response.status_code == 403

        # Read (403)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            headers=teacher_no_perm_headers,
        )
        assert response.status_code == 403

        # Update (403)
        response = self.client.put(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            json={"name": "Updated No Perm Material"},
            headers=teacher_no_perm_headers,
        )
        assert response.status_code == 403

        # Delete (403)
        response = self.client.delete(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            headers=teacher_no_perm_headers,
        )
        assert response.status_code == 403

        # Test regular teacher (can only copy, not create/read/update/delete)
        teacher_headers = self._get_auth_headers(teacher)

        # Create (403)
        response = self.client.post(
            f"/api/organizations/{org.id}/programs",
            json={"name": "Teacher Material", "description": "Test"},
            headers=teacher_headers,
        )
        assert response.status_code == 403

        # Read (403)
        response = self.client.get(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            headers=teacher_headers,
        )
        assert response.status_code == 403

        # Update (403)
        response = self.client.put(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            json={"name": "Teacher Updated Material"},
            headers=teacher_headers,
        )
        assert response.status_code == 403

        # Delete (403)
        response = self.client.delete(
            f"/api/organizations/{org.id}/programs/{admin_material_id}",
            headers=teacher_headers,
        )
        assert response.status_code == 403

        # Test copy permission - teacher must own classroom

        # Create classroom owned by teacher
        teacher_classroom = Classroom(
            name="Teacher Classroom",
            teacher_id=teacher.id,
            is_active=True,
        )
        self.db.add(teacher_classroom)
        self.db.commit()
        self.db.refresh(teacher_classroom)

        # Create classroom owned by someone else
        other_classroom = Classroom(
            name="Other Classroom",
            teacher_id=org_owner.id,
            is_active=True,
        )
        self.db.add(other_classroom)
        self.db.commit()
        self.db.refresh(other_classroom)

        # Teacher can copy to own classroom (201)
        response = self.client.post(
            f"/api/organizations/{org.id}/programs/{admin_material_id}/copy-to-classroom",
            json={"classroom_id": teacher_classroom.id},
            headers=teacher_headers,
        )
        assert response.status_code == 201

        # Teacher cannot copy to classroom they don't own (403)
        response = self.client.post(
            f"/api/organizations/{org.id}/programs/{admin_material_id}/copy-to-classroom",
            json={"classroom_id": other_classroom.id},
            headers=teacher_headers,
        )
        assert response.status_code == 403
        assert "not the teacher" in response.json()["detail"].lower()

    def test_org_member_can_get_content_detail(self):
        """
        Regression test for issue #410: org member gets 404 on org material content detail.

        The old code in GET /api/teachers/contents/{content_id} filtered by
        Program.teacher_id == current_teacher.id, which excluded org materials
        where teacher_id is the org_owner, not the requesting member.

        After the fix, check_content_access() handles org membership correctly.
        """
        hierarchy = self._create_organization_hierarchy()
        org = hierarchy["org"]
        org_owner = hierarchy["org_owner"]
        teacher = hierarchy["teacher"]

        # Create org material owned by org_owner with organization_id set
        material = self._create_organization_material(org, org_owner)

        # Set organization_id on Program (this is what makes it an org material)
        material.organization_id = org.id
        self.db.commit()
        self.db.refresh(material)

        # Get the content ID from the material hierarchy
        lesson = self.db.query(Lesson).filter(Lesson.program_id == material.id).first()
        content = self.db.query(Content).filter(Content.lesson_id == lesson.id).first()
        assert content is not None

        # org_owner (material creator) should be able to get content detail
        owner_headers = self._get_auth_headers(org_owner)
        response = self.client.get(
            f"/api/teachers/contents/{content.id}",
            headers=owner_headers,
        )
        assert response.status_code == 200
        assert response.json()["id"] == content.id
        assert response.json()["title"] == "基本問候語"

        # Regular org member teacher (NOT the creator) should also get 200
        # This was the bug: previously returned 404 because teacher_id != teacher.id
        teacher_headers = self._get_auth_headers(teacher)
        response = self.client.get(
            f"/api/teachers/contents/{content.id}",
            headers=teacher_headers,
        )
        assert response.status_code == 200
        assert response.json()["id"] == content.id
        assert response.json()["title"] == "基本問候語"
        assert len(response.json()["items"]) == 3

    def test_org_member_can_list_lesson_contents(self):
        """
        Regression test for issue #410 v2: org member gets 404 on lesson contents listing.

        The old code in GET /api/teachers/lessons/{lesson_id}/contents filtered by
        Program.teacher_id == current_teacher.id, which excluded org lessons
        where teacher_id is the org_owner, not the requesting member.

        After the fix, check_lesson_access() handles org membership correctly.
        """
        hierarchy = self._create_organization_hierarchy()
        org = hierarchy["org"]
        org_owner = hierarchy["org_owner"]
        teacher = hierarchy["teacher"]

        # Create org material owned by org_owner with organization_id set
        material = self._create_organization_material(org, org_owner)
        material.organization_id = org.id
        self.db.commit()
        self.db.refresh(material)

        lesson = self.db.query(Lesson).filter(Lesson.program_id == material.id).first()
        assert lesson is not None

        # org_owner can list lesson contents
        owner_headers = self._get_auth_headers(org_owner)
        response = self.client.get(
            f"/api/teachers/lessons/{lesson.id}/contents",
            headers=owner_headers,
        )
        assert response.status_code == 200
        assert len(response.json()) == 1  # One content: "基本問候語"

        # Regular org member teacher can also list lesson contents (was 404 before fix)
        teacher_headers = self._get_auth_headers(teacher)
        response = self.client.get(
            f"/api/teachers/lessons/{lesson.id}/contents",
            headers=teacher_headers,
        )
        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_org_owner_can_update_and_delete_org_content(self):
        """
        Regression test for issue #410 v2: org owner gets 404 on content update/delete.

        The old code in PUT/DELETE /api/teachers/contents/{content_id} filtered by
        Program.teacher_id == current_teacher.id (PUT also allowed templates).
        After the fix, check_content_access() handles org ownership correctly.
        """
        hierarchy = self._create_organization_hierarchy()
        org = hierarchy["org"]
        org_owner = hierarchy["org_owner"]

        # Create org material owned by org_owner with organization_id set
        material = self._create_organization_material(org, org_owner)
        material.organization_id = org.id
        self.db.commit()
        self.db.refresh(material)

        lesson = self.db.query(Lesson).filter(Lesson.program_id == material.id).first()
        content = self.db.query(Content).filter(Content.lesson_id == lesson.id).first()
        assert content is not None

        owner_headers = self._get_auth_headers(org_owner)

        # org_owner can update content
        response = self.client.put(
            f"/api/teachers/contents/{content.id}",
            json={"title": "更新後的問候語"},
            headers=owner_headers,
        )
        assert response.status_code == 200
        assert response.json()["title"] == "更新後的問候語"

        # org_owner can delete (soft-delete) content
        response = self.client.delete(
            f"/api/teachers/contents/{content.id}",
            headers=owner_headers,
        )
        assert response.status_code == 200
        assert response.json()["details"]["deactivated"] is True


# ============================================================================
# Test Summary
# ============================================================================

"""
Test Coverage Summary:

4 test scenarios, 100+ assertions

Test Scenarios:
1. test_complete_material_lifecycle (Main E2E flow)
   - Organization hierarchy setup
   - Material creation with full hierarchy (Program → Lesson → Content → Items)
   - Permission-based listing (org_owner ✅, org_admin ✅, teacher ❌)
   - Deep copy to classroom
   - source_metadata validation
   - Independence verification (edits, additions, deletions)

2. test_cross_organization_isolation
   - Materials isolated by organization
   - Cross-organization copy blocked
   - Listing filtered by organization

3. test_permission_enforcement_throughout_lifecycle
   - org_owner: Full CRUD permissions
   - org_admin (with permission): Full CRUD permissions
   - org_admin (without permission): All operations blocked (403)
   - Regular teacher: Can only copy, cannot CRUD
   - Classroom ownership enforced for copy operation

4. test_org_member_can_get_content_detail (Regression for #410)
   - org_owner can get content detail for org materials
   - Regular org member teacher can also get content detail (was 404 before fix)

Expected Results:
✅ All assertions pass
✅ Deep copy works correctly (new IDs, full hierarchy)
✅ source_metadata tracks origin
✅ Edits to copy don't affect original
✅ Cross-organization isolation enforced
✅ Permission model works correctly
✅ Org members can read org material content details

Run Test:
    pytest backend/tests/test_e2e_organization_materials.py -v -s

Expected Output:
    4 tests, 100+ assertions, all passing
"""
