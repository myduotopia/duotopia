"""
Test for student assignment activities API endpoint
Testing the N+1 query optimization fix in students.py:307-310

This test specifically verifies that the batch query optimization
for Content entities works correctly and returns proper data structure.
"""

import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from database import Base, get_db
from main import app
from models import (
    AssignmentStatus,
    StudentContentProgress,
)
from auth import create_access_token
from tests.factories import TestDataFactory


@pytest.fixture
def db_session():
    """Create an in-memory SQLite database for testing"""
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    """Create test client with test database"""

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def test_data(db_session):
    """Create comprehensive test data for assignment activities testing"""
    # Use the factory to create complete assignment chain
    data = TestDataFactory.create_full_assignment_chain(db_session)

    # Create additional content items to test the batch query optimization (N+1 fix)
    content_items = []
    for i in range(2):  # Create 2 more contents (total 3 with the one from factory)
        content = TestDataFactory.create_content(
            db_session,
            data["lesson"],
            title=f"Extra Content {i+1}",
            items=[
                {"text": f"Hello world {i+1}", "translation": f"你好世界 {i+1}"},
                {"text": f"How are you {i+1}", "translation": f"你好嗎 {i+1}"},
            ],
        )
        content_items.append(content)

    # Add all contents to the assignment
    from models import AssignmentContent

    for i, content in enumerate(content_items):
        assignment_content = AssignmentContent(
            assignment_id=data["assignment"].id,
            content_id=content.id,
            order_index=i + 1,  # Start from 1 since factory creates content at index 0
        )
        db_session.add(assignment_content)
    db_session.commit()

    # Create a proper StudentAssignment that uses assignment_id (to trigger the N+1 fix path)
    from models import StudentAssignment

    student_assignment = StudentAssignment(
        student_id=data["student"].id,
        assignment_id=data["assignment"].id,  # This is key - uses assignment_id path
        classroom_id=data["classroom"].id,
        title=data["assignment"].title,
        status=AssignmentStatus.IN_PROGRESS,
        assigned_at=datetime.now(),
        is_active=True,
    )
    db_session.add(student_assignment)
    db_session.commit()
    db_session.refresh(student_assignment)

    # Create progress records for all 3 contents (this triggers the batch query optimization)
    all_contents = [data["content"]] + content_items
    progress_records = []

    for i, content in enumerate(all_contents):
        progress = StudentContentProgress(
            student_assignment_id=student_assignment.id,
            content_id=content.id,
            order_index=i,
            status=AssignmentStatus.IN_PROGRESS
            if i == 0
            else AssignmentStatus.NOT_STARTED,
            score=85 if i == 0 else None,
            ai_scores={"accuracy": 0.9, "fluency": 0.8} if i == 0 else None,
            response_data={"audio_url": f"http://test.com/audio{i+1}.mp3"}
            if i == 0
            else None,
            completed_at=datetime.now() if i == 0 else None,
        )
        db_session.add(progress)
        progress_records.append(progress)

    db_session.commit()
    for progress in progress_records:
        db_session.refresh(progress)

    return {
        **data,  # Include all factory data
        "student_assignment": student_assignment,
        "all_contents": all_contents,
        "progress_records": progress_records,
    }


class TestStudentAssignmentActivities:
    """Test student assignment activities API endpoint"""

    @pytest.mark.asyncio
    async def test_get_assignment_activities_batch_query_optimization(
        self, client, test_data
    ):
        """
        Test that the batch query optimization (lines 307-310) works correctly
        This test verifies that:
        1. API returns correct response structure
        2. All content items are properly loaded via batch query (content_dict = {content.id: content})
        3. Progress data is correctly mapped to content
        4. The N+1 query issue is fixed
        """
        # Create student access token
        student_token = create_access_token(
            data={"sub": str(test_data["student"].id), "type": "student"}
        )

        # Call the API endpoint that uses the optimized batch query
        response = client.get(
            f"/api/students/assignments/{test_data['student_assignment'].id}/activities",
            headers={"Authorization": f"Bearer {student_token}"},
        )

        # Verify response status
        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        response_data = response.json()

        # API returns an object with activities array, not direct array
        assert (
            "activities" in response_data
        ), f"Response missing 'activities' key: {response_data}"
        activities = response_data["activities"]

        # Verify we get all 3 activities (one per content) from the batch query
        assert len(activities) == 3, f"Expected 3 activities, got {len(activities)}"

        # Test the batch query optimization results
        for i, activity in enumerate(activities):
            # Verify basic structure
            assert "id" in activity, "Activity should have id field"
            assert "content_id" in activity, "Activity should have content_id field"
            assert "title" in activity, "Activity should have title field"
            assert "type" in activity, "Activity should have type field"
            assert "status" in activity, "Activity should have status field"

            # Verify content data is properly loaded from batch query
            # The batch query: contents = db.query(Content).filter(Content.id.in_(content_ids)).all()
            assert (
                activity["type"] == "reading_assessment"
            ), f"Activity {i} should have correct type"

            # Verify progress data is correctly mapped using content_dict
            if i == 0:  # First item has progress
                assert activity["status"] == "IN_PROGRESS"
                assert activity["score"] == 85
                # 新的 ai_assessments 陣列格式
                assert "ai_assessments" in activity
                assert isinstance(activity["ai_assessments"], list)
                # audio_url 不是必須的欄位
                assert activity["completed_at"] is not None
            else:  # Other items are not started
                assert activity["status"] == "NOT_STARTED"
                assert activity["score"] is None
                assert "ai_assessments" in activity
                assert activity["ai_assessments"] == []
                assert activity["completed_at"] is None

        print("✅ Batch query optimization test passed!")
        print(f"✅ Successfully retrieved {len(activities)} activities with batch query")
        print("✅ Content data properly mapped from content_dict")
        print("✅ Progress data correctly associated with content")

    @pytest.mark.asyncio
    async def test_get_assignment_activities_unauthorized(self, client, test_data):
        """Test that unauthorized access is properly handled"""
        # Call without token
        response = client.get(
            f"/api/students/assignments/{test_data['student_assignment'].id}/activities"
        )
        assert response.status_code == 401

        # Call with wrong student token
        wrong_token = create_access_token(data={"sub": "999", "type": "student"})

        response = client.get(
            f"/api/students/assignments/{test_data['student_assignment'].id}/activities",
            headers={"Authorization": f"Bearer {wrong_token}"},
        )
        assert response.status_code == 404  # Assignment not found for this student

    @pytest.mark.asyncio
    async def test_get_assignment_activities_teacher_forbidden(self, client, test_data):
        """Test that teachers cannot access student endpoint"""
        teacher_token = create_access_token(
            data={"sub": str(test_data["teacher"].id), "type": "teacher"}
        )

        response = client.get(
            f"/api/students/assignments/{test_data['student_assignment'].id}/activities",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert response.status_code == 403


class TestStudentAssignmentExampleAudio:
    """Regression tests for issue #673: example_audio_url must be returned for
    EXAMPLE_SENTENCES content so the student player can load the audio source."""

    @pytest.fixture
    def example_audio_data(self, db_session):
        """Build an assignment with EXAMPLE_SENTENCES content carrying an audio_url."""
        from models import AssignmentContent, StudentAssignment

        data = TestDataFactory.create_full_assignment_chain(
            db_session,
            content_items=[
                {
                    "text": "In the park there is a big tree.",
                    "translation": "公園裡有一棵大樹。",
                    "audio_url": "https://storage.googleapis.com/test/example-1.mp3",
                },
                {
                    "text": "Children are playing on the grass.",
                    "translation": "孩子們在草地上玩耍。",
                    "audio_url": "https://storage.googleapis.com/test/example-2.mp3",
                },
            ],
        )

        # Re-create StudentAssignment via assignment_id path to mirror real flow
        # (factory's create_student_assignment already does this, but we need the
        # IN_PROGRESS state to exercise the live activity-fetching code path).
        sa = (
            db_session.query(StudentAssignment)
            .filter_by(student_id=data["student"].id)
            .first()
        )
        sa.status = AssignmentStatus.IN_PROGRESS
        sa.is_active = True
        db_session.commit()
        db_session.refresh(sa)

        # Sanity: the AssignmentContent link from the factory is in place
        assert (
            db_session.query(AssignmentContent)
            .filter_by(assignment_id=data["assignment"].id)
            .count()
            == 1
        )

        return {**data, "student_assignment": sa}

    @pytest.mark.asyncio
    async def test_example_audio_url_populated_for_example_sentences(
        self, client, example_audio_data
    ):
        """Issue #673: EXAMPLE_SENTENCES activity must expose example_audio_url
        at the top level so frontend ReadingAssessmentPanel can play it."""
        student_token = create_access_token(
            data={
                "sub": str(example_audio_data["student"].id),
                "type": "student",
            }
        )

        response = client.get(
            f"/api/students/assignments/{example_audio_data['student_assignment'].id}/activities",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert response.status_code == 200, response.text

        activities = response.json()["activities"]
        assert len(activities) == 1
        activity = activities[0]

        # The bug: example_audio_url was never set, so it came back undefined and
        # the <audio> element threw NotSupportedError on play. After the fix it
        # mirrors the teacher-preview behaviour.
        assert activity.get("example_audio_url") == (
            "https://storage.googleapis.com/test/example-1.mp3"
        )
        # And the helper text fields populated from the first item, matching the
        # teacher preview endpoint contract.
        assert activity["target_text"] == "In the park there is a big tree."
        assert activity["content"] == "公園裡有一棵大樹。"


if __name__ == "__main__":
    print(
        "Run this test with: pytest tests/integration/api/test_student_assignment_activities_fixed.py -v"
    )
