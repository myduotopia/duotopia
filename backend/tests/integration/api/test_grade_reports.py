"""Integration tests for the grade-report endpoints (issue #708 PR-2)."""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from auth import get_password_hash
from database import Base, get_db
from main import app
from models import (
    Assignment,
    Classroom,
    ClassroomStudent,
    Student,
    StudentAssignment,
    SubscriptionPeriod,
    Teacher,
)


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_grade_reports.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _enable_fk(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)


@pytest.fixture(scope="function")
def fresh_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _login(email: str = "t1@test.com", password: str = "pw") -> dict:
    res = client.post(
        "/api/auth/teacher/login",
        json={"email": email, "password": password},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def seeded(fresh_db):
    """Seed: teacher T1 with classroom C1 containing two students and three
    assignments across categories. T2 owns a separate classroom for the
    permission test."""
    db = TestingSessionLocal()
    now = datetime.now(timezone.utc)

    # Two teachers, each with a subscription period so they can call the API.
    for tid, email in [(1, "t1@test.com"), (2, "t2@test.com")]:
        db.add(
            Teacher(
                id=tid,
                name=f"Teacher {tid}",
                email=email,
                password_hash=get_password_hash("pw"),
                email_verified=True,
                is_active=True,
            )
        )
    db.commit()
    for tid in (1, 2):
        db.add(
            SubscriptionPeriod(
                teacher_id=tid,
                plan_name="Tutor Teachers",
                amount_paid=299,
                quota_total=2000,
                quota_used=0,
                start_date=now,
                end_date=now + timedelta(days=30),
                payment_method="credit_card",
            )
        )
    db.commit()

    # Classrooms
    db.add(Classroom(id=1, name="301", teacher_id=1, is_active=True))
    db.add(Classroom(id=2, name="OtherClass", teacher_id=2, is_active=True))
    db.commit()

    # Students in C1 (T1's classroom): 01 王小明, 02 林小花
    db.add(
        Student(
            id=11,
            name="王小明",
            student_number="01",
            email="s11@test.com",
            password_hash=get_password_hash("pw"),
            is_active=True,
        )
    )
    db.add(
        Student(
            id=12,
            name="林小花",
            student_number="02",
            email="s12@test.com",
            password_hash=get_password_hash("pw"),
            is_active=True,
        )
    )
    db.commit()
    db.add(ClassroomStudent(classroom_id=1, student_id=11, is_active=True))
    db.add(ClassroomStudent(classroom_id=1, student_id=12, is_active=True))
    db.commit()

    # Three assignments owned by T1 in C1 across categories.
    # Dates: 30 days ago, 20 days ago, 10 days ago — used in date-range test.
    base = now - timedelta(days=30)
    a_listening = Assignment(
        id=101,
        title="Unit 1 Listening Quiz",
        classroom_id=1,
        teacher_id=1,
        practice_mode="rearrangement",
        play_audio=True,
        score_category="listening",
        is_active=True,
        created_at=base,
    )
    a_reading = Assignment(
        id=102,
        title="Chapter 1 Reading",
        classroom_id=1,
        teacher_id=1,
        practice_mode="word_cloze",
        play_audio=False,
        score_category="reading",
        is_active=True,
        created_at=base + timedelta(days=10),
    )
    a_speaking = Assignment(
        id=103,
        title="Self-Introduction",
        classroom_id=1,
        teacher_id=1,
        practice_mode="word_reading",
        play_audio=False,
        score_category="speaking",
        is_active=True,
        created_at=base + timedelta(days=20),
    )
    for a in (a_listening, a_reading, a_speaking):
        db.add(a)
    db.commit()

    # StudentAssignment scores. 王小明 has all three; 林小花 only has two.
    db.add(
        StudentAssignment(
            assignment_id=101,
            student_id=11,
            teacher_id=1,
            classroom_id=1,
            title="Unit 1 Listening Quiz",
            score=88,
            is_active=True,
        )
    )
    db.add(
        StudentAssignment(
            assignment_id=102,
            student_id=11,
            teacher_id=1,
            classroom_id=1,
            title="Chapter 1 Reading",
            score=76,
            is_active=True,
        )
    )
    db.add(
        StudentAssignment(
            assignment_id=103,
            student_id=11,
            teacher_id=1,
            classroom_id=1,
            title="Self-Introduction",
            score=95,
            is_active=True,
        )
    )
    db.add(
        StudentAssignment(
            assignment_id=101,
            student_id=12,
            teacher_id=1,
            classroom_id=1,
            title="Unit 1 Listening Quiz",
            score=75,
            is_active=True,
        )
    )
    # 林小花 has no row for assignment 102 (intentional — leave blank).
    db.add(
        StudentAssignment(
            assignment_id=103,
            student_id=12,
            teacher_id=1,
            classroom_id=1,
            title="Self-Introduction",
            score=88,
            is_active=True,
        )
    )
    db.commit()
    db.close()
    return {
        "classroom_id": 1,
        "other_classroom_id": 2,
        "assignment_ids": [101, 102, 103],
        "student_ids": [11, 12],
        "assignment_listening_id": 101,
        "assignment_reading_id": 102,
        "assignment_speaking_id": 103,
    }


def _load(content: bytes):
    return load_workbook(io.BytesIO(content), data_only=True)


# ---------------------------------------------------------------------------
# Class grade report
# ---------------------------------------------------------------------------


def test_class_grade_report_happy_path(seeded):
    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/grade-report",
        headers=headers,
        json={"assignment_ids": seeded["assignment_ids"]},
    )
    assert res.status_code == 200, res.text
    assert "spreadsheetml" in res.headers["content-type"]
    assert "Content-Disposition" in res.headers
    assert "filename*=UTF-8''" in res.headers["Content-Disposition"]

    wb = _load(res.content)
    ws = wb.active
    # Title row mentions class name.
    assert "301" in str(ws.cell(row=1, column=1).value)
    # Static headers
    assert ws.cell(row=3, column=1).value == "座號"
    assert ws.cell(row=3, column=2).value == "姓名"
    assert ws.cell(row=3, column=3).value == "個人平均"
    # Categories appear in 聽力 → 閱讀 → 寫作 → 口說 order
    banner_cells = [
        str(c.value)
        for c in ws[3]
        if c.value and c.value not in ("座號", "姓名", "個人平均", "班級平均")
    ]
    assert banner_cells == ["聽力", "閱讀", "口說"]
    # 王小明 row: student_number 01, has scores 88 / 76 / 95
    student_rows = [r for r in ws.iter_rows(min_row=6, max_row=7, values_only=True)]
    names = [r[1] for r in student_rows]
    assert "王小明" in names
    assert "林小花" in names
    # Footer: 班級平均
    last_row = list(ws.iter_rows(values_only=True))[-1]
    assert last_row[0] == "班級平均"


def test_class_grade_report_rejects_assignments_in_other_classroom(seeded):
    """T1 cannot include an ID that belongs to T2's classroom."""
    # Seed an extra assignment owned by T2 in their classroom.
    db = TestingSessionLocal()
    db.add(
        Assignment(
            id=999,
            title="Other classroom assignment",
            classroom_id=seeded["other_classroom_id"],
            teacher_id=2,
            practice_mode="reading",
            play_audio=False,
            score_category="speaking",
            is_active=True,
        )
    )
    db.commit()
    db.close()

    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/grade-report",
        headers=headers,
        json={"assignment_ids": [seeded["assignment_listening_id"], 999]},
    )
    assert res.status_code == 404


def test_class_grade_report_404_for_classroom_not_owned(seeded):
    headers = _login()  # T1
    res = client.post(
        f"/api/teachers/classrooms/{seeded['other_classroom_id']}/grade-report",
        headers=headers,
        json={"assignment_ids": [seeded["assignment_listening_id"]]},
    )
    assert res.status_code == 404


def test_class_grade_report_rejects_empty_selection(seeded):
    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/grade-report",
        headers=headers,
        json={"assignment_ids": []},
    )
    assert res.status_code == 422


def test_class_grade_report_unauthenticated_returns_401(seeded):
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/grade-report",
        json={"assignment_ids": seeded["assignment_ids"]},
    )
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# Student grade report
# ---------------------------------------------------------------------------


def test_student_grade_report_happy_path_two_students(seeded):
    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/student-grade-report",
        headers=headers,
        json={"student_ids": seeded["student_ids"]},
    )
    assert res.status_code == 200, res.text

    wb = _load(res.content)
    # One sheet per selected student.
    assert len(wb.sheetnames) == 2
    # Sheet titles include class name + student number + name (truncated to
    # 31 chars by openpyxl).
    assert any("王小明" in name for name in wb.sheetnames)
    assert any("林小花" in name for name in wb.sheetnames)

    # 王小明 sheet should have:
    #   - row 1 header mentioning student's name
    #   - row 3 column headers
    #   - a 總平均 row near the bottom
    sheet = next(wb[s] for s in wb.sheetnames if "王小明" in s)
    assert "王小明" in str(sheet.cell(row=1, column=1).value)
    headers_row = [sheet.cell(row=3, column=c).value for c in range(1, 5)]
    assert headers_row == ["類別", "作業名稱", "派發日期", "分數"]
    rows = list(sheet.iter_rows(values_only=True))
    assert rows[-1][0] == "總平均"
    # Wang has 88 / 76 / 95 → avg 86.3 (rounded to 1dp)
    assert rows[-1][3] == pytest.approx(86.3)


def test_student_grade_report_single_student_uses_named_file(seeded):
    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/student-grade-report",
        headers=headers,
        json={"student_ids": [11]},
    )
    assert res.status_code == 200
    # RFC-5987 filename* should carry "王小明" url-encoded.
    cd = res.headers["Content-Disposition"]
    assert "%E7%8E%8B%E5%B0%8F%E6%98%8E" in cd  # 王小明 percent-encoded


def test_student_grade_report_respects_date_range(seeded):
    """Only the listening assignment (created 30 days ago) should fall outside
    a tight window around the reading + speaking dates."""
    today = datetime.now(timezone.utc).date()
    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/student-grade-report",
        headers=headers,
        json={
            "student_ids": [11],
            "start_date": (today - timedelta(days=25)).isoformat(),
            "end_date": today.isoformat(),
        },
    )
    assert res.status_code == 200
    wb = _load(res.content)
    sheet = wb[wb.sheetnames[0]]
    # Listening (30 days ago) excluded, so 聽力 banner should not appear.
    all_text = " ".join(
        str(c.value) for row in sheet.iter_rows() for c in row if c.value
    )
    assert "▌ 聽力" not in all_text
    assert "▌ 閱讀" in all_text
    assert "▌ 口說" in all_text


def test_student_grade_report_404_for_student_outside_classroom(seeded):
    # Seed a student who is NOT enrolled in classroom 1.
    db = TestingSessionLocal()
    db.add(
        Student(
            id=99,
            name="Outsider",
            student_number="99",
            email="outsider@test.com",
            password_hash=get_password_hash("pw"),
            is_active=True,
        )
    )
    db.commit()
    db.close()

    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/student-grade-report",
        headers=headers,
        json={"student_ids": [11, 99]},
    )
    assert res.status_code == 404


def test_student_grade_report_rejects_inverted_date_range(seeded):
    today = datetime.now(timezone.utc).date()
    headers = _login()
    res = client.post(
        f"/api/teachers/classrooms/{seeded['classroom_id']}/student-grade-report",
        headers=headers,
        json={
            "student_ids": [11],
            "start_date": today.isoformat(),
            "end_date": (today - timedelta(days=1)).isoformat(),
        },
    )
    assert res.status_code == 422
