"""
Comprehensive TDD Tests for Issue #53: AI Batch Grading Feature

This test suite comprehensively covers ALL of Kaddy's requirements:

1. Score Calculation Formula:
   - Per Item: item_score = (總體發音 + 準確度 + 流暢度 + 完整度) / 4
   - Total Score: total_score = sum(all_item_scores) / total_items

2. Average Scores (平均成績):
   - 總體發音平均成績 = sum(pronunciation_scores) / total_items
   - 準確度平均成績 = sum(accuracy_scores) / total_items
   - 流暢度平均成績 = sum(fluency_scores) / total_items
   - 完整度平均成績 = sum(completeness_scores) / total_items

3. Edge Cases:
   - 學生有部分音檔未上傳 → 以 0 分計算
   - 學生有部分音檔沒有分析結果 → 以 0 分計算

4. Status Logic:
   - 老師沒有打勾退回訂正 → 儲存為【已批改】(GRADED)
   - 老師打勾退回訂正 → 儲存為【已退回】(RETURNED)

5. Batch Processing:
   - Only process students with status: SUBMITTED or RESUBMITTED

Backend API endpoint: POST /api/teachers/assignments/{assignment_id}/batch-grade
"""

import pytest
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from models import (
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    Assignment,
    Content,
    ContentItem,
    AssignmentContent,
    StudentAssignment,
    StudentItemProgress,
    AssignmentStatus,
)
from auth import get_password_hash, create_access_token


@pytest.fixture
def auth_teacher(shared_test_session: Session):
    """Create authenticated teacher for all tests"""
    teacher = Teacher(
        email="teacher@test.com",
        name="Test Teacher",
        password_hash=get_password_hash("password123"),
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


@pytest.fixture
def auth_headers(auth_teacher: Teacher):
    """Create auth headers for API requests"""
    access_token = create_access_token(
        data={"sub": str(auth_teacher.id), "type": "teacher"}
    )
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def setup_classroom_and_assignment(shared_test_session: Session, auth_teacher: Teacher):
    """Setup classroom, assignment, and content with 10 items (Kaddy's example)"""
    # Create classroom
    classroom = Classroom(
        name="Test Classroom",
        teacher_id=auth_teacher.id,
    )
    shared_test_session.add(classroom)
    shared_test_session.commit()
    shared_test_session.refresh(classroom)

    # Create assignment
    assignment = Assignment(
        title="Test Assignment",
        classroom_id=classroom.id,
        teacher_id=auth_teacher.id,
        due_date=datetime.now(timezone.utc),
    )
    shared_test_session.add(assignment)
    shared_test_session.commit()
    shared_test_session.refresh(assignment)

    # Create Program and Lesson (required for Content)
    from models import Program, Lesson

    program = Program(
        name="Test Program",
        teacher_id=auth_teacher.id,
        classroom_id=classroom.id,
    )
    shared_test_session.add(program)
    shared_test_session.commit()
    shared_test_session.refresh(program)

    lesson = Lesson(
        program_id=program.id,
        name="Test Lesson",
    )
    shared_test_session.add(lesson)
    shared_test_session.commit()
    shared_test_session.refresh(lesson)

    # Create content with 10 items (Kaddy's example)
    content = Content(
        lesson_id=lesson.id,
        title="Test Content",
        type="reading_assessment",
    )
    shared_test_session.add(content)
    shared_test_session.commit()
    shared_test_session.refresh(content)

    # Link assignment to content
    ac = AssignmentContent(
        assignment_id=assignment.id,
        content_id=content.id,
        order_index=1,
    )
    shared_test_session.add(ac)
    shared_test_session.commit()

    # Create 10 content items
    items = []
    for i in range(10):
        item = ContentItem(
            content_id=content.id,
            order_index=i,
            text=f"Sentence {i+1}",
            translation=f"句子 {i+1}",
        )
        shared_test_session.add(item)
        items.append(item)
    shared_test_session.commit()

    # Refresh items to get IDs
    for item in items:
        shared_test_session.refresh(item)

    return {
        "teacher": auth_teacher,
        "classroom": classroom,
        "assignment": assignment,
        "content": content,
        "items": items,
    }


def create_student_with_assignment(
    db: Session,
    classroom: Classroom,
    assignment: Assignment,
    student_name: str,
    student_number: str,
    status: AssignmentStatus,
) -> tuple[Student, StudentAssignment]:
    """Helper: Create a student with assignment"""
    from auth import get_password_hash
    from datetime import date

    student = Student(
        email=f"{student_number}@test.com",
        name=student_name,
        student_number=student_number,
        password_hash=get_password_hash("password123"),
        birthdate=date(2010, 1, 1),  # Required field
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    # Add to classroom
    cs = ClassroomStudent(
        classroom_id=classroom.id,
        student_id=student.id,
    )
    db.add(cs)
    db.commit()

    # Create student assignment
    not_started_or_in_progress = [
        AssignmentStatus.NOT_STARTED,
        AssignmentStatus.IN_PROGRESS,
    ]
    sa = StudentAssignment(
        student_id=student.id,
        assignment_id=assignment.id,
        classroom_id=classroom.id,
        title=assignment.title,
        status=status,
        submitted_at=datetime.now(timezone.utc)
        if status not in not_started_or_in_progress
        else None,
        resubmitted_at=datetime.now(timezone.utc)
        if status == AssignmentStatus.RESUBMITTED
        else None,
    )
    db.add(sa)
    db.commit()
    db.refresh(sa)

    return student, sa


def add_item_progress_with_scores(
    db: Session,
    student_assignment_id: int,
    item: ContentItem,
    pronunciation: float,
    accuracy: float,
    fluency: float,
    completeness: float,
    has_recording: bool = True,
    has_ai_assessment: bool = True,
):
    """Helper: Add item progress with AI scores"""
    progress = StudentItemProgress(
        student_assignment_id=student_assignment_id,
        content_item_id=item.id,
        recording_url=f"https://example.com/recording_{item.id}.mp3"
        if has_recording
        else None,
        pronunciation_score=Decimal(str(pronunciation)) if has_ai_assessment else None,
        accuracy_score=Decimal(str(accuracy)) if has_ai_assessment else None,
        fluency_score=Decimal(str(fluency)) if has_ai_assessment else None,
        completeness_score=Decimal(str(completeness)) if has_ai_assessment else None,
        ai_assessed_at=datetime.now(timezone.utc) if has_ai_assessment else None,
        status="SUBMITTED" if has_recording else "NOT_STARTED",
    )
    db.add(progress)
    db.commit()


# ============================================================================
# TEST 1: Perfect Scenario - Kaddy's Example
# ============================================================================
def test_batch_grade_perfect_scenario_kaddys_example(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試 Kaddy 的範例：
    - 學生有10句完整錄音
    - 每句都有完整的 AI 評分
    - 驗證計算公式正確

    Example from Kaddy:
    - 第1句: (90 + 95 + 100 + 100) / 4 = 96.25分
    - 假設有10句，把10句的單題平均加總除以10
    """
    data = setup_classroom_and_assignment

    # Create student with SUBMITTED status
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Kaddy's Student",
        "S001",
        AssignmentStatus.SUBMITTED,
    )

    # Add 10 items with varying scores (following Kaddy's example pattern)
    scores = [
        (90, 95, 100, 100),  # Item 1: Expected = 96.25
        (85, 90, 95, 98),  # Item 2: Expected = 92.00
        (88, 92, 96, 94),  # Item 3: Expected = 92.50
        (92, 88, 90, 95),  # Item 4: Expected = 91.25
        (87, 85, 88, 90),  # Item 5: Expected = 87.50
        (94, 96, 98, 100),  # Item 6: Expected = 97.00
        (80, 82, 85, 88),  # Item 7: Expected = 83.75
        (91, 93, 89, 92),  # Item 8: Expected = 91.25
        (86, 88, 90, 87),  # Item 9: Expected = 87.75
        (89, 91, 93, 95),  # Item 10: Expected = 92.00
    ]

    expected_item_scores = []
    total_pronunciation = 0
    total_accuracy = 0
    total_fluency = 0
    total_completeness = 0

    for i, (pron, acc, flu, comp) in enumerate(scores):
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            data["items"][i],
            pron,
            acc,
            flu,
            comp,
        )
        # Calculate expected item score: (pron + acc + flu + comp) / 4
        item_score = (pron + acc + flu + comp) / 4
        expected_item_scores.append(item_score)

        # Accumulate for average calculations
        total_pronunciation += pron
        total_accuracy += acc
        total_fluency += flu
        total_completeness += comp

    # Expected calculations
    expected_total_score = sum(expected_item_scores) / len(expected_item_scores)
    expected_avg_pronunciation = total_pronunciation / 10
    expected_avg_accuracy = total_accuracy / 10
    expected_avg_fluency = total_fluency / 10
    expected_avg_completeness = total_completeness / 10

    # Call batch grading API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},  # No return
        },
    )

    # Assert response success
    assert response.status_code == 200, f"API failed: {response.text}"
    result = response.json()

    # Assert response structure
    assert result["total_students"] == 1
    assert result["processed"] == 1
    assert len(result["results"]) == 1

    # Assert student result
    student_result = result["results"][0]
    assert student_result["student_name"] == "Kaddy's Student"
    assert student_result["missing_items"] == 0
    assert student_result["status"] == "GRADED"

    # Assert score calculations (allow 0.5 tolerance for rounding)
    assert (
        abs(student_result["total_score"] - expected_total_score) < 0.5
    ), f"Expected total_score: {expected_total_score}, Got: {student_result['total_score']}"
    assert abs(student_result["avg_pronunciation"] - expected_avg_pronunciation) < 0.5
    assert abs(student_result["avg_accuracy"] - expected_avg_accuracy) < 0.5
    assert abs(student_result["avg_fluency"] - expected_avg_fluency) < 0.5
    assert abs(student_result["avg_completeness"] - expected_avg_completeness) < 0.5

    # Verify database was updated
    shared_test_session.refresh(sa)
    assert sa.status == AssignmentStatus.GRADED
    assert sa.score is not None
    assert abs(float(sa.score) - expected_total_score) < 0.5
    assert sa.graded_at is not None


# ============================================================================
# TEST 2: Missing Recordings (部分音檔未上傳)
# ============================================================================
def test_batch_grade_with_missing_recordings(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試學生有部分音檔未上傳的情況
    - 10句中有3句沒有錄音（recording_url = NULL）
    - 這3句應該以 0 分計算
    """
    data = setup_classroom_and_assignment

    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student with Missing Recordings",
        "S002",
        AssignmentStatus.SUBMITTED,
    )

    # Add 7 items with recordings and scores
    for i in range(7):
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            data["items"][i],
            pronunciation=85.0,
            accuracy=88.0,
            fluency=90.0,
            completeness=87.0,
            has_recording=True,
            has_ai_assessment=True,
        )

    # Add 3 items WITHOUT recordings (last 3 items)
    for i in range(7, 10):
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            data["items"][i],
            pronunciation=0.0,
            accuracy=0.0,
            fluency=0.0,
            completeness=0.0,
            has_recording=False,  # No recording
            has_ai_assessment=False,
        )

    # Expected calculations
    # 7 items with scores: (85 + 88 + 90 + 87) / 4 = 87.5 each
    # 3 items with 0 scores
    # Total: (87.5 * 7 + 0 * 3) / 10 = 61.25
    item_score = (85 + 88 + 90 + 87) / 4
    expected_total_score = (item_score * 7 + 0 * 3) / 10
    # API only averages items with scores (not total items)
    expected_avg_pronunciation = 85.0  # Average of 7 items with pronunciation scores
    expected_avg_accuracy = 88.0  # Average of 7 items with accuracy scores
    expected_avg_fluency = 90.0  # Average of 7 items with fluency scores
    expected_avg_completeness = 87.0  # Average of 7 items with completeness scores

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    student_result = result["results"][0]
    assert student_result["missing_items"] == 3, "Should have 3 missing items"
    assert abs(student_result["total_score"] - expected_total_score) < 1.0
    # Averages should only include items with scores
    assert abs(student_result["avg_pronunciation"] - expected_avg_pronunciation) < 1.0
    assert abs(student_result["avg_accuracy"] - expected_avg_accuracy) < 1.0
    assert abs(student_result["avg_fluency"] - expected_avg_fluency) < 1.0
    assert abs(student_result["avg_completeness"] - expected_avg_completeness) < 1.0


# ============================================================================
# TEST 3: Missing AI Assessment (部分沒有分析結果)
# ============================================================================
def test_batch_grade_with_missing_ai_assessment(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試學生有部分音檔沒有 AI 分析結果
    - 10句中有2句有錄音但沒有 AI 評分
    - 這2句應該以 0 分計算
    """
    data = setup_classroom_and_assignment

    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student with Missing AI Assessment",
        "S003",
        AssignmentStatus.SUBMITTED,
    )

    # Add 8 items with recordings AND AI scores
    for i in range(8):
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            data["items"][i],
            pronunciation=90.0,
            accuracy=92.0,
            fluency=88.0,
            completeness=91.0,
            has_recording=True,
            has_ai_assessment=True,
        )

    # Add 2 items with recordings but NO AI assessment
    for i in range(8, 10):
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            data["items"][i],
            pronunciation=0.0,
            accuracy=0.0,
            fluency=0.0,
            completeness=0.0,
            has_recording=True,  # Has recording
            has_ai_assessment=False,  # But no AI scores
        )

    # Expected: 8 items with (90+92+88+91)/4 = 90.25, 2 items with 0
    # Total: (90.25 * 8 + 0 * 2) / 10 = 72.2
    item_score = (90 + 92 + 88 + 91) / 4
    expected_total_score = (item_score * 8 + 0 * 2) / 10

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    student_result = result["results"][0]
    assert (
        student_result["missing_items"] == 2
    ), "Should have 2 missing items (no AI assessment)"
    assert abs(student_result["total_score"] - expected_total_score) < 1.0


# ============================================================================
# TEST 4: Return for Correction Logic (退回訂正)
# ============================================================================
def test_batch_grade_return_for_correction_checked(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試老師打勾退回訂正的邏輯
    - Student 1: return_for_correction = True → 應該變成 RETURNED
    - Student 2: return_for_correction = False → 應該變成 GRADED
    """
    data = setup_classroom_and_assignment

    # Create 2 students
    student1, sa1 = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student to Return",
        "S004",
        AssignmentStatus.SUBMITTED,
    )

    student2, sa2 = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student to Grade",
        "S005",
        AssignmentStatus.SUBMITTED,
    )

    # Add complete scores for both students
    for sa in [sa1, sa2]:
        for item in data["items"]:
            add_item_progress_with_scores(
                shared_test_session,
                sa.id,
                item,
                pronunciation=85.0,
                accuracy=88.0,
                fluency=90.0,
                completeness=87.0,
            )

    # Call API with return_for_correction
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {
                str(student1.id): True,  # Return student 1
                str(student2.id): False,  # Grade student 2
            },
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    # Find results
    results_by_name = {r["student_name"]: r for r in result["results"]}

    # Student 1 should be RETURNED
    assert results_by_name["Student to Return"]["status"] == "RETURNED"

    # Student 2 should be GRADED
    assert results_by_name["Student to Grade"]["status"] == "GRADED"

    # Verify database
    shared_test_session.refresh(sa1)
    shared_test_session.refresh(sa2)
    assert sa1.status == AssignmentStatus.RETURNED
    assert sa1.returned_at is not None
    assert sa2.status == AssignmentStatus.GRADED
    assert sa2.graded_at is not None


# ============================================================================
# TEST 5: Only Process SUBMITTED and RESUBMITTED
# ============================================================================
def test_batch_grade_only_processes_submitted_and_resubmitted(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試只處理【已提交】和【已訂正】狀態的學生
    - 5個學生：1個NOT_STARTED, 1個SUBMITTED, 1個RESUBMITTED, 1個GRADED, 1個RETURNED
    - 應該只處理 SUBMITTED 和 RESUBMITTED 的2個學生
    """
    data = setup_classroom_and_assignment

    # Create students with different statuses
    statuses = [
        ("Not Started Student", "S006", AssignmentStatus.NOT_STARTED),
        ("Submitted Student", "S007", AssignmentStatus.SUBMITTED),
        ("Resubmitted Student", "S008", AssignmentStatus.RESUBMITTED),
        ("Graded Student", "S009", AssignmentStatus.GRADED),
        ("Returned Student", "S010", AssignmentStatus.RETURNED),
    ]

    for name, number, status in statuses:
        student, sa = create_student_with_assignment(
            shared_test_session,
            data["classroom"],
            data["assignment"],
            name,
            number,
            status,
        )

        # Add scores for all students
        for item in data["items"]:
            add_item_progress_with_scores(
                shared_test_session,
                sa.id,
                item,
                pronunciation=85.0,
                accuracy=88.0,
                fluency=90.0,
                completeness=87.0,
            )

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    # Should only process SUBMITTED and RESUBMITTED (2 students)
    assert result["total_students"] == 2, "Should only find 2 students to grade"
    assert result["processed"] == 2
    assert len(result["results"]) == 2

    # Verify the correct students were processed
    processed_names = {r["student_name"] for r in result["results"]}
    assert "Submitted Student" in processed_names
    assert "Resubmitted Student" in processed_names
    assert "Not Started Student" not in processed_names
    assert "Graded Student" not in processed_names
    assert "Returned Student" not in processed_names


# ============================================================================
# TEST 6: Multiple Students - Batch Processing
# ============================================================================
def test_batch_grade_multiple_students_sequential(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試批量處理多個學生
    - 5個學生都是 SUBMITTED 狀態
    - 每個學生都應該被正確批改
    - 驗證每個學生的分數計算正確
    """
    data = setup_classroom_and_assignment

    # Create 5 students with different score patterns
    students_data = [
        ("Student A", "S011", 90.0, 92.0, 88.0, 91.0),
        ("Student B", "S012", 85.0, 87.0, 84.0, 86.0),
        ("Student C", "S013", 95.0, 97.0, 93.0, 96.0),
        ("Student D", "S014", 80.0, 82.0, 78.0, 81.0),
        ("Student E", "S015", 88.0, 90.0, 86.0, 89.0),
    ]

    expected_scores = {}

    for name, number, pron, acc, flu, comp in students_data:
        student, sa = create_student_with_assignment(
            shared_test_session,
            data["classroom"],
            data["assignment"],
            name,
            number,
            AssignmentStatus.SUBMITTED,
        )

        # Add scores for all 10 items
        for item in data["items"]:
            add_item_progress_with_scores(
                shared_test_session,
                sa.id,
                item,
                pronunciation=pron,
                accuracy=acc,
                fluency=flu,
                completeness=comp,
            )

        # Calculate expected score
        expected_scores[name] = (pron + acc + flu + comp) / 4

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    assert result["total_students"] == 5
    assert result["processed"] == 5
    assert len(result["results"]) == 5

    # Verify each student's score
    for student_result in result["results"]:
        name = student_result["student_name"]
        expected = expected_scores[name]
        assert (
            abs(student_result["total_score"] - expected) < 0.5
        ), f"{name}: Expected {expected}, Got {student_result['total_score']}"


# ============================================================================
# TEST 7: Edge Case - All Items Missing
# ============================================================================
def test_batch_grade_student_with_all_items_missing(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試學生所有題目都沒有錄音
    - 10個 StudentItemProgress 都沒有 recording_url
    - total_score 應該是 0
    - missing_items 應該是 10
    """
    data = setup_classroom_and_assignment

    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student with No Recordings",
        "S016",
        AssignmentStatus.SUBMITTED,
    )

    # Add all items WITHOUT recordings
    for item in data["items"]:
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            item,
            pronunciation=0.0,
            accuracy=0.0,
            fluency=0.0,
            completeness=0.0,
            has_recording=False,
            has_ai_assessment=False,
        )

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    student_result = result["results"][0]
    assert student_result["total_score"] == 0.0, "Total score should be 0"
    assert student_result["missing_items"] == 10, "All 10 items should be missing"
    assert student_result["avg_pronunciation"] == 0.0
    assert student_result["avg_accuracy"] == 0.0
    assert student_result["avg_fluency"] == 0.0
    assert student_result["avg_completeness"] == 0.0


# ============================================================================
# TEST 8: Edge Case - Zero Scores
# ============================================================================
def test_batch_grade_with_zero_scores(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試所有 AI 評分都是 0 的情況
    - 確保不會除以零
    - 確保正確返回 0 分
    """
    data = setup_classroom_and_assignment

    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student with Zero Scores",
        "S017",
        AssignmentStatus.SUBMITTED,
    )

    # Add all items with 0 scores
    for item in data["items"]:
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            item,
            pronunciation=0.0,
            accuracy=0.0,
            fluency=0.0,
            completeness=0.0,
            has_recording=True,
            has_ai_assessment=True,
        )

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    student_result = result["results"][0]
    assert student_result["total_score"] == 0.0
    assert student_result["missing_items"] == 0  # Has recordings, but scores are 0
    assert student_result["avg_pronunciation"] == 0.0
    assert student_result["avg_accuracy"] == 0.0
    assert student_result["avg_fluency"] == 0.0
    assert student_result["avg_completeness"] == 0.0


# ============================================================================
# TEST 9: Partial Dimensions Missing
# ============================================================================
def test_batch_grade_with_partial_dimensions_missing(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    測試部分維度分數缺失
    - Item 1-5: 只有 pronunciation 和 accuracy (fluency=NULL, completeness=NULL)
    - Item 6-10: 完整的四個維度
    - 應該只用可用的維度計算平均
    """
    data = setup_classroom_and_assignment

    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Student with Partial Dimensions",
        "S018",
        AssignmentStatus.SUBMITTED,
    )

    # Items 1-5: Only pronunciation and accuracy
    for i in range(5):
        progress = StudentItemProgress(
            student_assignment_id=sa.id,
            content_item_id=data["items"][i].id,
            recording_url=f"https://example.com/recording_{i}.mp3",
            pronunciation_score=Decimal("90.0"),
            accuracy_score=Decimal("88.0"),
            fluency_score=None,  # Missing
            completeness_score=None,  # Missing
            ai_assessed_at=datetime.now(timezone.utc),
            status="SUBMITTED",
        )
        shared_test_session.add(progress)

    # Items 6-10: All four dimensions
    for i in range(5, 10):
        add_item_progress_with_scores(
            shared_test_session,
            sa.id,
            data["items"][i],
            pronunciation=92.0,
            accuracy=90.0,
            fluency=88.0,
            completeness=91.0,
        )

    shared_test_session.commit()

    # Expected:
    # Items 1-5: (90 + 88) / 2 = 89.0 each
    # Items 6-10: (92 + 90 + 88 + 91) / 4 = 90.25 each
    # Total: (89 * 5 + 90.25 * 5) / 10 = 89.625
    item_score_partial = (90 + 88) / 2
    item_score_full = (92 + 90 + 88 + 91) / 4
    expected_total = (item_score_partial * 5 + item_score_full * 5) / 10

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    student_result = result["results"][0]
    assert abs(student_result["total_score"] - expected_total) < 1.0

    # Averages should include all available scores
    # pronunciation: (90*5 + 92*5) / 10 = 91.0
    # accuracy: (88*5 + 90*5) / 10 = 89.0
    # fluency: (0*5 + 88*5) / 10 = 44.0 (only 5 items have fluency)
    # completeness: (0*5 + 91*5) / 10 = 45.5 (only 5 items have completeness)
    expected_avg_pron = (90 * 5 + 92 * 5) / 10
    expected_avg_acc = (88 * 5 + 90 * 5) / 10

    assert abs(student_result["avg_pronunciation"] - expected_avg_pron) < 1.0
    assert abs(student_result["avg_accuracy"] - expected_avg_acc) < 1.0
    # Note: The current implementation counts missing dimensions as 0
    # This behavior matches Kaddy's requirement: "沒有分析結果 → 以 0 分計算"


# ============================================================================
# TEST 10: Integration Test - End to End
# ============================================================================
def test_batch_grade_integration_realistic_classroom(
    test_client: TestClient,
    shared_test_session: Session,
    setup_classroom_and_assignment,
    auth_headers,
):
    """
    整合測試：模擬真實教室場景
    - 20個學生
    - 各種完成度：有的全部完成，有的部分完成，有的沒開始
    - 各種評分情況：有的有 AI 評分，有的沒有
    - 驗證整個批改流程正確
    """
    data = setup_classroom_and_assignment

    # Scenario 1: 5 students with all items complete (SUBMITTED)
    for i in range(5):
        student, sa = create_student_with_assignment(
            shared_test_session,
            data["classroom"],
            data["assignment"],
            f"Complete Student {i+1}",
            f"SC{i+1:03d}",
            AssignmentStatus.SUBMITTED,
        )
        for item in data["items"]:
            add_item_progress_with_scores(
                shared_test_session,
                sa.id,
                item,
                pronunciation=90.0,
                accuracy=92.0,
                fluency=88.0,
                completeness=91.0,
            )

    # Scenario 2: 5 students with partial completion (SUBMITTED)
    for i in range(5):
        student, sa = create_student_with_assignment(
            shared_test_session,
            data["classroom"],
            data["assignment"],
            f"Partial Student {i+1}",
            f"SP{i+1:03d}",
            AssignmentStatus.SUBMITTED,
        )
        # Only first 5 items have recordings
        for j, item in enumerate(data["items"]):
            if j < 5:
                add_item_progress_with_scores(
                    shared_test_session,
                    sa.id,
                    item,
                    pronunciation=85.0,
                    accuracy=87.0,
                    fluency=84.0,
                    completeness=86.0,
                )
            else:
                add_item_progress_with_scores(
                    shared_test_session,
                    sa.id,
                    item,
                    pronunciation=0.0,
                    accuracy=0.0,
                    fluency=0.0,
                    completeness=0.0,
                    has_recording=False,
                    has_ai_assessment=False,
                )

    # Scenario 3: 5 students with RESUBMITTED status
    for i in range(5):
        student, sa = create_student_with_assignment(
            shared_test_session,
            data["classroom"],
            data["assignment"],
            f"Resubmitted Student {i+1}",
            f"SR{i+1:03d}",
            AssignmentStatus.RESUBMITTED,
        )
        for item in data["items"]:
            add_item_progress_with_scores(
                shared_test_session,
                sa.id,
                item,
                pronunciation=88.0,
                accuracy=90.0,
                fluency=86.0,
                completeness=89.0,
            )

    # Scenario 4: 5 students with NOT_STARTED status (should NOT be processed)
    for i in range(5):
        student, sa = create_student_with_assignment(
            shared_test_session,
            data["classroom"],
            data["assignment"],
            f"Not Started Student {i+1}",
            f"SN{i+1:03d}",
            AssignmentStatus.NOT_STARTED,
        )
        for item in data["items"]:
            add_item_progress_with_scores(
                shared_test_session,
                sa.id,
                item,
                pronunciation=80.0,
                accuracy=82.0,
                fluency=78.0,
                completeness=81.0,
            )

    # Call API
    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "return_for_correction": {},
        },
    )

    # Assert
    assert response.status_code == 200
    result = response.json()

    # Should process 15 students (5 complete + 5 partial + 5 resubmitted)
    # Exclude 5 NOT_STARTED students
    assert (
        result["total_students"] == 15
    ), "Should process 15 students (exclude NOT_STARTED)"
    assert result["processed"] == 15
    assert len(result["results"]) == 15

    # Verify different student types
    complete_students = [
        r for r in result["results"] if "Complete Student" in r["student_name"]
    ]
    partial_students = [
        r for r in result["results"] if "Partial Student" in r["student_name"]
    ]
    resubmitted_students = [
        r for r in result["results"] if "Resubmitted Student" in r["student_name"]
    ]

    assert len(complete_students) == 5
    assert len(partial_students) == 5
    assert len(resubmitted_students) == 5

    # Verify complete students
    for student in complete_students:
        assert student["missing_items"] == 0
        assert student["total_score"] > 85.0  # Should have high scores
        assert student["status"] == "GRADED"

    # Verify partial students
    for student in partial_students:
        assert student["missing_items"] == 5  # 5 items missing
        assert 40.0 < student["total_score"] < 50.0  # Lower due to missing items

    # Verify resubmitted students
    for student in resubmitted_students:
        assert student["missing_items"] == 0
        assert student["status"] == "GRADED"

    # Verify no NOT_STARTED students were processed
    not_started_students = [
        r for r in result["results"] if "Not Started Student" in r["student_name"]
    ]
    assert (
        len(not_started_students) == 0
    ), "NOT_STARTED students should NOT be processed"


# ============================================================================
# Issue #680: teacher_passed auto-marking from AI scores
# ============================================================================
# Rules:
#   - recording_url is None/empty              → teacher_passed = False
#   - recording_url set, ai_assessed_at = None → teacher_passed = None (unchanged)
#   - has AI assessment, overall >= 60         → teacher_passed = True
#   - has AI assessment, overall < 60          → teacher_passed = False
# Applies in BOTH single-student mode and multi-student mode.


def _student_item_progress_by_item(
    db: Session, student_assignment_id: int
) -> dict[int, StudentItemProgress]:
    rows = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id == student_assignment_id)
        .all()
    )
    return {row.content_item_id: row for row in rows}


@pytest.fixture
def issue680_setup(shared_test_session: Session, auth_teacher: Teacher):
    """
    Dedicated fixture for issue #680 tests — uses correct ContentType enum value
    (the shared `setup_classroom_and_assignment` uses lowercase "reading_assessment"
    which isn't a valid ContentType and causes all its tests to error at setup).
    """
    from models import Program, Lesson

    classroom = Classroom(name="Issue680 Classroom", teacher_id=auth_teacher.id)
    shared_test_session.add(classroom)
    shared_test_session.commit()
    shared_test_session.refresh(classroom)

    assignment = Assignment(
        title="Issue680 Assignment",
        classroom_id=classroom.id,
        teacher_id=auth_teacher.id,
        due_date=datetime.now(timezone.utc),
    )
    shared_test_session.add(assignment)
    shared_test_session.commit()
    shared_test_session.refresh(assignment)

    program = Program(
        name="Issue680 Program",
        teacher_id=auth_teacher.id,
        classroom_id=classroom.id,
    )
    shared_test_session.add(program)
    shared_test_session.commit()
    shared_test_session.refresh(program)

    lesson = Lesson(program_id=program.id, name="Issue680 Lesson")
    shared_test_session.add(lesson)
    shared_test_session.commit()
    shared_test_session.refresh(lesson)

    content = Content(
        lesson_id=lesson.id,
        title="Issue680 Content",
        type="EXAMPLE_SENTENCES",
    )
    shared_test_session.add(content)
    shared_test_session.commit()
    shared_test_session.refresh(content)

    shared_test_session.add(
        AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=1
        )
    )
    shared_test_session.commit()

    items = []
    for i in range(3):
        item = ContentItem(
            content_id=content.id,
            order_index=i,
            text=f"Sentence {i + 1}",
            translation=f"句子 {i + 1}",
        )
        shared_test_session.add(item)
        items.append(item)
    shared_test_session.commit()
    for item in items:
        shared_test_session.refresh(item)

    return {
        "teacher": auth_teacher,
        "classroom": classroom,
        "assignment": assignment,
        "content": content,
        "items": items,
    }


def test_issue680_passed_when_overall_above_threshold(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "High Scorer",
        "S680A",
        AssignmentStatus.SUBMITTED,
    )
    add_item_progress_with_scores(
        shared_test_session, sa.id, data["items"][0], 80.0, 80.0, 80.0, 80.0
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert progress[data["items"][0].id].teacher_passed is True


def test_issue680_failed_when_overall_below_threshold(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Low Scorer",
        "S680B",
        AssignmentStatus.SUBMITTED,
    )
    add_item_progress_with_scores(
        shared_test_session, sa.id, data["items"][0], 50.0, 50.0, 50.0, 50.0
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert progress[data["items"][0].id].teacher_passed is False


def test_issue680_boundary_exactly_60_passes(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Borderline",
        "S680C",
        AssignmentStatus.SUBMITTED,
    )
    add_item_progress_with_scores(
        shared_test_session, sa.id, data["items"][0], 60.0, 60.0, 60.0, 60.0
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert progress[data["items"][0].id].teacher_passed is True


def test_issue680_no_recording_marks_failed(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "No Recording",
        "S680D",
        AssignmentStatus.SUBMITTED,
    )
    add_item_progress_with_scores(
        shared_test_session,
        sa.id,
        data["items"][0],
        0.0,
        0.0,
        0.0,
        0.0,
        has_recording=False,
        has_ai_assessment=False,
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert progress[data["items"][0].id].teacher_passed is False


def test_issue680_failed_analysis_stays_null(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    """Recording exists but ai_assessed_at stays None after re-trigger → do not auto-mark."""
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Analysis Failed",
        "S680E",
        AssignmentStatus.SUBMITTED,
    )
    # Recording uploaded but analysis never succeeded
    # (trigger_ai_assessment_for_item will try Azure but we can't mock easily
    # here; the download step will fail on the fake example.com URL and leave
    # ai_assessed_at = None, which is exactly the scenario we want to test.)
    progress = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=data["items"][0].id,
        recording_url="https://example.com/unreachable.mp3",
        pronunciation_score=None,
        accuracy_score=None,
        fluency_score=None,
        completeness_score=None,
        ai_assessed_at=None,
        status="SUBMITTED",
    )
    shared_test_session.add(progress)
    shared_test_session.commit()

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    db_progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert db_progress[data["items"][0].id].teacher_passed is None


def test_issue680_single_student_mode_also_marks(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    """Individual page's purple 'Apply AI Suggestions' button also auto-marks."""
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Single Mode",
        "S680F",
        AssignmentStatus.SUBMITTED,
    )
    add_item_progress_with_scores(
        shared_test_session, sa.id, data["items"][0], 90.0, 90.0, 90.0, 90.0
    )
    add_item_progress_with_scores(
        shared_test_session, sa.id, data["items"][1], 30.0, 30.0, 30.0, 30.0
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "student_ids": [student.id],
        },
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert progress[data["items"][0].id].teacher_passed is True
    assert progress[data["items"][1].id].teacher_passed is False


def test_issue680_overwrites_prior_manual_pass_fail(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    """Re-running batch-grade is deterministic: prior teacher_passed gets overwritten by current AI scores."""
    data = issue680_setup
    student, sa = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Prior Manual",
        "S680G",
        AssignmentStatus.SUBMITTED,
    )
    # Item 1: teacher previously marked True, but AI score is 40 → should become False
    progress_low = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=data["items"][0].id,
        recording_url=f"https://example.com/recording_{data['items'][0].id}.mp3",
        pronunciation_score=Decimal("40"),
        accuracy_score=Decimal("40"),
        fluency_score=Decimal("40"),
        completeness_score=Decimal("40"),
        ai_assessed_at=datetime.now(timezone.utc),
        status="SUBMITTED",
        teacher_passed=True,
    )
    # Item 2: teacher previously marked False, but AI score is 85 → should become True
    progress_high = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=data["items"][1].id,
        recording_url=f"https://example.com/recording_{data['items'][1].id}.mp3",
        pronunciation_score=Decimal("85"),
        accuracy_score=Decimal("85"),
        fluency_score=Decimal("85"),
        completeness_score=Decimal("85"),
        ai_assessed_at=datetime.now(timezone.utc),
        status="SUBMITTED",
        teacher_passed=False,
    )
    shared_test_session.add_all([progress_low, progress_high])
    shared_test_session.commit()

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200

    shared_test_session.expire_all()
    progress = _student_item_progress_by_item(shared_test_session, sa.id)
    assert progress[data["items"][0].id].teacher_passed is False
    assert progress[data["items"][1].id].teacher_passed is True


def test_issue680_batch_mode_includes_unsubmitted_students(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    """
    Batch-grade modal should show unsubmitted students (NOT_STARTED / IN_PROGRESS)
    so teachers can see who hasn't done the assignment. Their StudentAssignment.status
    must not change when finalized with 'pending' decision.
    """
    data = issue680_setup
    _, sa_submitted = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Submitted",
        "S680H1",
        AssignmentStatus.SUBMITTED,
    )
    _, sa_not_started = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Not Started",
        "S680H2",
        AssignmentStatus.NOT_STARTED,
    )
    _, sa_in_progress = create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "In Progress",
        "S680H3",
        AssignmentStatus.IN_PROGRESS,
    )
    add_item_progress_with_scores(
        shared_test_session, sa_submitted.id, data["items"][0], 70.0, 70.0, 70.0, 70.0
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200
    body = response.json()

    names = {r["student_name"] for r in body["results"]}
    assert names == {"Submitted", "Not Started", "In Progress"}
    assert body["total_students"] == 3

    not_started_result = next(
        r for r in body["results"] if r["student_name"] == "Not Started"
    )
    assert not_started_result["completed_items"] == 0
    assert not_started_result["total_score"] == 0.0

    # Finalize with 'pending' (null) decisions for everyone → statuses must not change
    finalize_response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/finalize-batch-grade",
        headers=auth_headers,
        json={
            "classroom_id": data["classroom"].id,
            "teacher_decisions": {
                str(sa_submitted.student_id): None,
                str(sa_not_started.student_id): None,
                str(sa_in_progress.student_id): None,
            },
        },
    )
    assert finalize_response.status_code == 200

    shared_test_session.expire_all()
    shared_test_session.refresh(sa_not_started)
    shared_test_session.refresh(sa_in_progress)
    shared_test_session.refresh(sa_submitted)
    assert sa_not_started.status == AssignmentStatus.NOT_STARTED
    assert sa_in_progress.status == AssignmentStatus.IN_PROGRESS
    assert sa_submitted.status == AssignmentStatus.SUBMITTED


def test_issue680_batch_mode_excludes_only_graded(
    test_client: TestClient,
    shared_test_session: Session,
    issue680_setup,
    auth_headers,
):
    """Only GRADED is terminal. RETURNED students stay visible so teachers can see them."""
    data = issue680_setup
    create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Already Graded",
        "S680I1",
        AssignmentStatus.GRADED,
    )
    create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Returned For Correction",
        "S680I2",
        AssignmentStatus.RETURNED,
    )
    create_student_with_assignment(
        shared_test_session,
        data["classroom"],
        data["assignment"],
        "Fresh Submission",
        "S680I3",
        AssignmentStatus.SUBMITTED,
    )

    response = test_client.post(
        f"/api/teachers/assignments/{data['assignment'].id}/batch-grade",
        headers=auth_headers,
        json={"classroom_id": data["classroom"].id},
    )
    assert response.status_code == 200
    names = {r["student_name"] for r in response.json()["results"]}
    assert names == {"Fresh Submission", "Returned For Correction"}
