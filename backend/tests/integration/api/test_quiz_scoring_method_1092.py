"""Issue #1092: 打字類小考評分方式 — API 層整合測試。

* create：打字小考未帶 ``quiz_scoring_method`` → 422 ``QUIZ_SCORING_METHOD_REQUIRED``；
  D/E 沒帶 points → 422 ``QUIZ_SCORING_POINTS_REQUIRED``；選擇題小考不需要、存 NULL。
* PATCH：評分設定有變 → 同 transaction 重算已交卷學生（``recomputed_count``）、清掉
  老師手動扣分、RETURNED 學生 status 不變、沒交卷的不重算分數；未變更 → 不重算。
* 大小寫開關變更 → 重判 is_correct、同步 session.correct_count（含還沒交卷的
  session：只重判 is_correct / correct_count、不寫分數）；學生 start 時也會重判。
* 學生端作答帶 ``typed_words`` → 存進 answer_data、prior_answer 保留空格位置；
  批改頁每題回 ``default_deduction`` / ``deduction_detail``、quiz_settings 帶設定。
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from auth import get_password_hash
from database import Base, get_db
from main import app
from models import (
    Assignment,
    AssignmentContent,
    AssignmentStatus,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    PracticeAnswer,
    PracticeSession,
    Program,
    Student,
    StudentAssignment,
    StudentItemProgress,
    Teacher,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_quiz_scoring_method_1092.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


client = TestClient(app)


@pytest.fixture(scope="function")
def setup_database():
    # 每個測試重新綁定本模組的 engine（多個 quiz 測試檔共用同一個 app）
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


# 兩題 → per_q = 50
_ITEMS = [(1, "look forward to", "期待"), (2, "apple", "蘋果")]


def _seed_base() -> None:
    """老師、班級、3 位學生、一份 2 題的教材（content 1）。"""
    db = TestingSessionLocal()
    db.add(
        Teacher(
            id=1,
            name="t",
            email="teacher@test.com",
            password_hash=get_password_hash("password123"),
            email_verified=True,
            is_active=True,
        )
    )
    db.add(Classroom(id=1, name="c", teacher_id=1, is_active=True))
    for sid in (1, 2, 3):
        db.add(
            Student(
                id=sid,
                name=f"s{sid}",
                email=f"student{sid}@test.com",
                password_hash=get_password_hash("password123"),
                email_verified=True,
                is_active=True,
                birthdate=datetime(2010, 1, 1).date(),
            )
        )
    db.commit()
    for sid in (1, 2, 3):
        db.add(ClassroomStudent(classroom_id=1, student_id=sid, is_active=True))
    db.add(
        Program(
            id=1, name="p", teacher_id=1, level="A1", is_template=False, is_active=True
        )
    )
    db.commit()
    db.add(Lesson(id=1, name="l", program_id=1, order_index=1, is_active=True))
    db.commit()
    db.add(
        Content(
            id=1,
            lesson_id=1,
            title="vocab",
            type=ContentType.VOCABULARY_SET,
            order_index=1,
            is_active=True,
        )
    )
    db.commit()
    for order, (item_id, text, translation) in enumerate(_ITEMS, start=1):
        db.add(
            ContentItem(
                id=item_id,
                content_id=1,
                order_index=order,
                text=text,
                translation=translation,
            )
        )
    db.commit()
    db.close()


def _seed_quiz(method="whole_question", case_sensitive=None) -> None:
    """拼寫小考 assignment 1（直接掛 content 1）：

    * sa 1：SUBMITTED，item1 打 ``look forwerd to``（錯 1 字）、item2 ``Apple`` 對；
      老師手動把 item1 扣分改成 10、總分改 90。
    * sa 2：RETURNED（曾退回），第一次 completed session 同上答案。
    * sa 3：IN_PROGRESS，沒有 completed session（分數不應被重算；PATCH 仍會重判
      其作答中 session 的 is_correct / correct_count）。
    """
    _seed_base()
    db = TestingSessionLocal()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode="word_spelling_quiz",
            shuffle_questions=False,
            is_active=True,
            quiz_scoring_method=method,
            quiz_case_sensitive=case_sensitive,
        )
    )
    db.commit()
    db.add(AssignmentContent(assignment_id=1, content_id=1, order_index=1))
    now = datetime.now(timezone.utc)
    statuses = {
        1: AssignmentStatus.SUBMITTED,
        2: AssignmentStatus.RETURNED,
        3: AssignmentStatus.IN_PROGRESS,
    }
    for sid, st in statuses.items():
        db.add(
            StudentAssignment(
                id=sid,
                assignment_id=1,
                student_id=sid,
                classroom_id=1,
                title="quiz",
                status=st,
                score=90.0 if sid == 1 else (50.0 if sid == 2 else None),
                submitted_at=now if sid != 3 else None,
                returned_at=now if sid == 2 else None,
                is_active=True,
                assigned_at=now,
            )
        )
    db.commit()
    for sid in (1, 2, 3):
        session = PracticeSession(
            id=sid,
            student_id=sid,
            student_assignment_id=sid,
            practice_mode="word_spelling_quiz",
            words_practiced=2,
            correct_count=1,
            started_at=now,
            completed_at=now if sid != 3 else None,
        )
        db.add(session)
        db.commit()
        db.add(
            PracticeAnswer(
                practice_session_id=sid,
                content_item_id=1,
                is_correct=False,
                time_spent_seconds=0,
                answer_data={
                    "type": "word_spelling_quiz",
                    "typed_answer": "look forwerd to",
                    "typed_words": ["look", "forwerd", "to"],
                    "correct_answer": "look forward to",
                },
            )
        )
        db.add(
            PracticeAnswer(
                practice_session_id=sid,
                content_item_id=2,
                is_correct=True,
                time_spent_seconds=0,
                answer_data={
                    "type": "word_spelling_quiz",
                    "typed_answer": "Apple",
                    "correct_answer": "apple",
                },
            )
        )
    db.add(
        StudentItemProgress(
            student_assignment_id=1,
            content_item_id=1,
            status="NOT_STARTED",
            teacher_review_score=10,
        )
    )
    db.commit()
    db.close()


def _teacher_headers() -> dict:
    resp = client.post(
        "/api/auth/teacher/login",
        json={"email": "teacher@test.com", "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _student_headers(student_id: int = 1) -> dict:
    resp = client.post(
        "/api/auth/student/login", json={"id": student_id, "password": "password123"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _patch(headers: dict, **body):
    return client.patch("/api/teachers/assignments/1", headers=headers, json=body)


def _sa(sa_id: int) -> StudentAssignment:
    db = TestingSessionLocal()
    try:
        return db.query(StudentAssignment).filter_by(id=sa_id).one()
    finally:
        db.close()


def _manual_deduction(sa_id: int, item_id: int):
    db = TestingSessionLocal()
    try:
        ip = (
            db.query(StudentItemProgress)
            .filter_by(student_assignment_id=sa_id, content_item_id=item_id)
            .first()
        )
        if ip is None or ip.teacher_review_score is None:
            return None
        return float(ip.teacher_review_score)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------


def _create_payload(practice_mode: str, **extra) -> dict:
    return {
        "title": "quiz",
        "classroom_id": 1,
        "content_ids": [1],
        "student_ids": [],
        "practice_mode": practice_mode,
        **extra,
    }


@pytest.mark.parametrize("mode", ["word_spelling_quiz", "word_cloze_quiz"])
def test_create_typed_quiz_requires_scoring_method(setup_database, mode):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload(mode),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "QUIZ_SCORING_METHOD_REQUIRED"


@pytest.mark.parametrize("method", ["fixed_per_word", "fixed_per_letter"])
def test_create_fixed_methods_require_points(setup_database, method):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload("word_spelling_quiz", quiz_scoring_method=method),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "QUIZ_SCORING_POINTS_REQUIRED"


@pytest.mark.parametrize("points", [0, -1, 100.5])
def test_create_rejects_out_of_range_points(setup_database, points):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload(
            "word_spelling_quiz",
            quiz_scoring_method="fixed_per_letter",
            quiz_scoring_points=points,
        ),
    )
    assert resp.status_code == 422, resp.text


def test_create_rejects_unknown_method(setup_database):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload("word_spelling_quiz", quiz_scoring_method="bogus"),
    )
    assert resp.status_code == 422, resp.text


def test_create_stores_scoring_settings(setup_database):
    _seed_base()
    headers = _teacher_headers()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=headers,
        json=_create_payload(
            "word_spelling_quiz",
            quiz_scoring_method="fixed_per_letter",
            quiz_scoring_points=0.5,
            quiz_case_sensitive=True,
        ),
    )
    assert resp.status_code == 200, resp.text
    assignment_id = resp.json()["assignment_id"]
    detail = client.get(f"/api/teachers/assignments/{assignment_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["quiz_scoring_method"] == "fixed_per_letter"
    assert body["quiz_scoring_points"] == 0.5
    assert body["quiz_case_sensitive"] is True


def test_create_non_points_method_drops_points(setup_database):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload(
            "word_spelling_quiz",
            quiz_scoring_method="per_word",
            quiz_scoring_points=3,
        ),
    )
    assert resp.status_code == 200, resp.text
    db = TestingSessionLocal()
    try:
        a = db.query(Assignment).filter_by(id=resp.json()["assignment_id"]).one()
        assert a.quiz_scoring_method == "per_word"
        assert a.quiz_scoring_points is None
    finally:
        db.close()


def test_create_selection_quiz_needs_no_method_and_stores_null(setup_database):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload(
            "word_selection_quiz", quiz_scoring_method="per_word", show_image=False
        ),
    )
    assert resp.status_code == 200, resp.text
    db = TestingSessionLocal()
    try:
        a = db.query(Assignment).filter_by(id=resp.json()["assignment_id"]).one()
        assert a.quiz_scoring_method is None
        assert a.quiz_scoring_points is None
        assert a.quiz_case_sensitive is None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# PATCH → recompute
# ---------------------------------------------------------------------------


def test_patch_method_change_recomputes_submitted_students(setup_database):
    _seed_quiz(method="whole_question")
    headers = _teacher_headers()
    assert _manual_deduction(1, 1) == 10.0

    resp = _patch(headers, quiz_scoring_method="per_word")
    assert resp.status_code == 200, resp.text
    # sa 1（SUBMITTED）+ sa 2（RETURNED）；sa 3 沒有 completed session
    assert resp.json()["recomputed_count"] == 2

    # per_q = 50；item1 錯 1/3 字 → 16.7；item2 對 → 0 → 83.3
    sa1 = _sa(1)
    assert sa1.score == 83.3
    assert sa1.status == AssignmentStatus.SUBMITTED
    # 老師手動扣分被新算法取代
    assert _manual_deduction(1, 1) is None

    sa2 = _sa(2)
    assert sa2.score == 83.3
    assert sa2.status == AssignmentStatus.RETURNED  # 訂正中狀態不變
    assert sa2.returned_at is not None

    sa3 = _sa(3)
    assert sa3.score is None
    assert sa3.status == AssignmentStatus.IN_PROGRESS


def test_patch_without_scoring_change_does_not_recompute(setup_database):
    _seed_quiz(method="whole_question")
    headers = _teacher_headers()

    # 相同 method → 有效值沒變
    resp = _patch(headers, quiz_scoring_method="whole_question")
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 0
    # 只改標題
    resp = _patch(headers, title="renamed")
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 0
    # 明確 null ＝ 不變更
    resp = _patch(headers, quiz_scoring_method=None, quiz_case_sensitive=None)
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 0

    assert _sa(1).score == 90.0
    assert _manual_deduction(1, 1) == 10.0


def test_patch_null_method_to_whole_question_is_not_a_change(setup_database):
    """舊作業（NULL）存成 whole_question：有效值相同 → 不重算、不清手動扣分。"""
    _seed_quiz(method=None)
    resp = _patch(_teacher_headers(), quiz_scoring_method="whole_question")
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 0
    assert _sa(1).score == 90.0
    assert _manual_deduction(1, 1) == 10.0


def test_patch_fixed_method_requires_points(setup_database):
    _seed_quiz(method="per_word")
    resp = _patch(_teacher_headers(), quiz_scoring_method="fixed_per_word")
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "QUIZ_SCORING_POINTS_REQUIRED"
    assert _sa(1).score == 90.0  # rollback：沒有重算
    # 422 前已 setattr 的 method 不會被 commit（session rollback）
    db = TestingSessionLocal()
    try:
        assignment = db.query(Assignment).filter_by(id=1).one()
        assert assignment.quiz_scoring_method == "per_word"
        assert assignment.quiz_scoring_points is None
    finally:
        db.close()


def test_patch_fixed_points_change_recomputes(setup_database):
    _seed_quiz(method="per_word")
    headers = _teacher_headers()
    resp = _patch(headers, quiz_scoring_method="fixed_per_word", quiz_scoring_points=5)
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 2
    assert _sa(1).score == 95.0  # 錯 1 字 × 5

    resp = _patch(headers, quiz_scoring_points=5)  # 同值
    assert resp.json()["recomputed_count"] == 0

    resp = _patch(headers, quiz_scoring_points=2)
    assert resp.json()["recomputed_count"] == 2
    assert _sa(1).score == 98.0


def test_patch_case_sensitive_rejudges_is_correct(setup_database):
    _seed_quiz(method="whole_question")
    resp = _patch(_teacher_headers(), quiz_case_sensitive=True)
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 2

    db = TestingSessionLocal()
    try:
        ans = (
            db.query(PracticeAnswer)
            .filter_by(practice_session_id=1, content_item_id=2)
            .one()
        )
        assert ans.is_correct is False  # Apple ≠ apple（分大小寫）
        session = db.query(PracticeSession).filter_by(id=1).one()
        assert session.correct_count == 0
        # 還沒交卷的 sa 3 session 也重判（只改 is_correct / correct_count，不寫分數）
        assert db.query(PracticeSession).filter_by(id=3).one().correct_count == 0
    finally:
        db.close()
    assert _sa(1).score == 0.0


def test_patch_scoring_fields_ignored_for_selection_quiz(setup_database):
    _seed_base()
    db = TestingSessionLocal()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode="word_selection_quiz",
            is_active=True,
        )
    )
    db.commit()
    db.close()
    resp = _patch(_teacher_headers(), quiz_scoring_method="per_word")
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 0
    db = TestingSessionLocal()
    try:
        assert db.query(Assignment).filter_by(id=1).one().quiz_scoring_method is None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 學生端作答 + 批改頁
# ---------------------------------------------------------------------------


def _seed_fresh_quiz(
    method: str, points=None, mode: str = "word_spelling_quiz"
) -> None:
    _seed_base()
    db = TestingSessionLocal()
    if mode == "word_cloze_quiz":
        # 克漏字：正解為 cloze_answer（例句中的實際字形）
        for item_id, sentence, answer in [
            (1, "I looked forward to the trip.", "looked forward to"),
            (2, "She ate an apple.", "apple"),
        ]:
            item = db.query(ContentItem).filter_by(id=item_id).one()
            item.example_sentence = sentence
            item.example_sentence_translation = "譯"
            item.cloze_answer = answer
        db.commit()
    db.add(
        Assignment(
            id=1,
            title="quiz",
            classroom_id=1,
            teacher_id=1,
            practice_mode=mode,
            shuffle_questions=False,
            is_active=True,
            quiz_scoring_method=method,
            quiz_scoring_points=points,
        )
    )
    db.commit()
    db.add(AssignmentContent(assignment_id=1, content_id=1, order_index=1))
    db.add(
        StudentAssignment(
            id=1,
            assignment_id=1,
            student_id=1,
            classroom_id=1,
            title="quiz",
            status=AssignmentStatus.NOT_STARTED,
            is_active=True,
            assigned_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    db.close()


def test_typed_words_flow_scores_by_method(setup_database):
    _seed_fresh_quiz("per_word")
    s_headers = _student_headers(1)
    start = client.get(
        "/api/students/assignments/1/vocabulary/spelling_quiz/start",
        headers=s_headers,
    )
    assert start.status_code == 200, start.text
    body = start.json()
    assert body["quiz_scoring_method"] == "per_word"
    assert body["quiz_case_sensitive"] is False
    session_id = body["session_id"]

    # 跳過第 1 格直接填第 2、3 格
    resp = client.post(
        "/api/students/assignments/1/vocabulary/spelling_quiz/answer",
        headers=s_headers,
        json={
            "content_item_id": 1,
            "typed_answer": "forward to",
            "typed_words": ["", "forward", "to"],
            "time_spent_seconds": 0,
            "session_id": session_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_correct"] is False

    # prior_answer 保留空格位置
    again = client.get(
        "/api/students/assignments/1/vocabulary/spelling_quiz/start",
        headers=s_headers,
    )
    prior = {w["content_item_id"]: w["prior_answer"] for w in again.json()["words"]}
    assert prior[1] == " forward to"

    # item 2 不作答 → 交卷：item1 扣 50/3 → 16.7、item2 扣 50 → 33.3
    done = client.post(
        "/api/students/assignments/1/vocabulary/spelling_quiz/complete",
        headers=s_headers,
        json={"session_id": session_id},
    )
    assert done.status_code == 200, done.text
    assert done.json()["score"] == 33.3

    db = TestingSessionLocal()
    try:
        ans = db.query(PracticeAnswer).filter_by(content_item_id=1).one()
        assert ans.answer_data["typed_words"] == ["", "forward", "to"]
    finally:
        db.close()

    view = client.get(
        "/api/teachers/assignments/1/submissions/1", headers=_teacher_headers()
    )
    assert view.status_code == 200, view.text
    data = view.json()
    assert data["quiz_settings"]["quiz_scoring_method"] == "per_word"
    assert data["quiz_settings"]["quiz_scoring_points"] is None
    by_item = {q["content_item_id"]: q for q in data["submissions"]}
    assert by_item[1]["student_answer"] == "＿ forward to"
    assert by_item[1]["default_deduction"] == 16.7
    assert by_item[1]["deduction_detail"] == {
        "word_total": 3,
        "wrong_words": 1,
        "wrong_letters": 4,
    }
    assert by_item[2]["default_deduction"] == 50.0
    assert by_item[2]["deduction_detail"] is None


def test_legacy_answer_without_typed_words_unchanged(setup_database):
    """舊前端不送 typed_words：is_correct 與 #828 相同（不分大小寫整串比對），
    answer_data 不多 typed_words 欄位。"""
    _seed_fresh_quiz(None)
    s_headers = _student_headers(1)
    session_id = client.get(
        "/api/students/assignments/1/vocabulary/spelling_quiz/start",
        headers=s_headers,
    ).json()["session_id"]
    resp = client.post(
        "/api/students/assignments/1/vocabulary/spelling_quiz/answer",
        headers=s_headers,
        json={
            "content_item_id": 2,
            "typed_answer": " APPLE ",
            "time_spent_seconds": 0,
            "session_id": session_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_correct"] is True
    db = TestingSessionLocal()
    try:
        ans = db.query(PracticeAnswer).filter_by(content_item_id=2).one()
        assert "typed_words" not in ans.answer_data
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Commit 3：作答中改開關、數值驗證、typed_answer 由 typed_words 產生
# ---------------------------------------------------------------------------


def _start(s_headers: dict, mode_path: str = "spelling_quiz") -> int:
    resp = client.get(
        f"/api/students/assignments/1/vocabulary/{mode_path}/start",
        headers=s_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["session_id"]


def _answer(s_headers, session_id, item_id, typed_answer, typed_words=None, path=""):
    body = {
        "content_item_id": item_id,
        "typed_answer": typed_answer,
        "time_spent_seconds": 0,
        "session_id": session_id,
    }
    if typed_words is not None:
        body["typed_words"] = typed_words
    resp = client.post(
        f"/api/students/assignments/1/vocabulary/{path or 'spelling_quiz'}/answer",
        headers=s_headers,
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _complete(s_headers, session_id, path="spelling_quiz"):
    resp = client.post(
        f"/api/students/assignments/1/vocabulary/{path}/complete",
        headers=s_headers,
        json={"session_id": session_id},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_case_toggle_mid_quiz_rejudges_in_progress_answers(setup_database):
    """作答中（IN_PROGRESS）答 Apple 對 apple 為對；老師改成分大小寫後交卷 →
    該題改判錯、整題扣分、答對題數不含它（PATCH 只重判作答中 session 的 is_correct、
    不寫分數；交卷時以目前設定再重判並算分）。"""
    _seed_fresh_quiz("whole_question")
    s_headers = _student_headers(1)
    session_id = _start(s_headers)
    assert _answer(
        s_headers, session_id, 1, "look forward to", ["look", "forward", "to"]
    )["is_correct"]
    assert _answer(s_headers, session_id, 2, "Apple", ["Apple"])["is_correct"]

    resp = _patch(_teacher_headers(), quiz_case_sensitive=True)
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 0  # 沒有人交卷

    done = _complete(s_headers, session_id)
    assert done["score"] == 50.0
    assert done["correct_count"] == 1

    db = TestingSessionLocal()
    try:
        ans = db.query(PracticeAnswer).filter_by(content_item_id=2).one()
        assert ans.is_correct is False
        assert (
            db.query(PracticeSession).filter_by(id=session_id).one().correct_count == 1
        )
    finally:
        db.close()


def test_null_method_complete_equals_legacy_formula(setup_database):
    """method=NULL 走 /complete：與舊公式 100 − 錯題數 × 100/N 相同（舊前端、不送 typed_words）。"""
    _seed_fresh_quiz(None)
    s_headers = _student_headers(1)
    session_id = _start(s_headers)
    assert not _answer(s_headers, session_id, 1, "look forwerd to")["is_correct"]
    assert _answer(s_headers, session_id, 2, " APPLE ")["is_correct"]
    done = _complete(s_headers, session_id)
    assert done["score"] == round(max(0.0, min(100.0, 100.0 - 1 * (100 / 2))), 1)
    assert done["correct_count"] == 1


def test_cloze_quiz_answer_path_scores_by_method(setup_database):
    """克漏字小考：正解為 cloze_answer，逐格判分、存 typed_words。"""
    _seed_fresh_quiz("per_word", mode="word_cloze_quiz")
    s_headers = _student_headers(1)
    session_id = _start(s_headers, "cloze_quiz")
    res = _answer(
        s_headers,
        session_id,
        1,
        "looked forwerd to",
        ["looked", "forwerd", "to"],
        path="cloze_quiz",
    )
    assert res["is_correct"] is False
    assert res["correct_answer"] == "looked forward to"
    # item1 錯 1/3 字 → 50/3 → 16.7；item2 未作答 → 50 → 33.3
    done = _complete(s_headers, session_id, "cloze_quiz")
    assert done["score"] == 33.3
    db = TestingSessionLocal()
    try:
        ans = db.query(PracticeAnswer).filter_by(content_item_id=1).one()
        assert ans.answer_data["type"] == "word_cloze_quiz"
        assert ans.answer_data["typed_words"] == ["looked", "forwerd", "to"]
    finally:
        db.close()


def test_typed_answer_is_derived_from_typed_words(setup_database):
    """client 送的 typed_answer 與 typed_words 不一致 → 存的 typed_answer 由 typed_words 產生，
    學生複盤頁與老師批改頁顯示同一份答案。"""
    _seed_fresh_quiz("per_word")
    s_headers = _student_headers(1)
    session_id = _start(s_headers)
    res = _answer(s_headers, session_id, 1, "look forward to", ["", "forward", "to"])
    assert res["is_correct"] is False  # 判分以 typed_words 為準
    db = TestingSessionLocal()
    try:
        ans = db.query(PracticeAnswer).filter_by(content_item_id=1).one()
        assert ans.answer_data["typed_answer"] == "forward to"
    finally:
        db.close()
    _complete(s_headers, session_id)
    review = client.get(
        "/api/students/assignments/1/vocabulary/spelling_quiz/review",
        headers=s_headers,
    )
    assert review.status_code == 200, review.text
    by_item = {w["content_item_id"]: w for w in review.json()["words"]}
    assert by_item[1]["student_answer"] == "forward to"


def test_case_toggle_during_revision_does_not_deadlock(setup_database):
    """訂正中改大小寫開關不會卡死：
    答 Apple（不分大小寫 → 對）→ 交卷 → 退回訂正（訂正 session 帶著「已答對」的 Apple）
    → 老師改成分大小寫 → start 回傳該題 prior_is_correct=False（解鎖）→ 學生改答 apple
    → /complete 成功；分數仍是重算後的第一次作答分數（訂正不覆寫）。"""
    _seed_fresh_quiz("whole_question")
    s_headers = _student_headers(1)
    t_headers = _teacher_headers()
    first = _start(s_headers)
    assert not _answer(
        s_headers, first, 1, "look forwerd to", ["look", "forwerd", "to"]
    )["is_correct"]
    assert _answer(s_headers, first, 2, "Apple", ["Apple"])["is_correct"]
    assert _complete(s_headers, first)["score"] == 50.0

    back = client.post(
        "/api/teachers/assignments/1/return-for-revision",
        headers=t_headers,
        json={"student_id": 1},
    )
    assert back.status_code == 200, back.text
    assert _sa(1).status == AssignmentStatus.RETURNED

    resp = _patch(t_headers, quiz_case_sensitive=True)
    assert resp.status_code == 200, resp.text
    assert resp.json()["recomputed_count"] == 1
    # 第一次作答重算：兩題都錯 → 0；訂正中狀態不變
    assert _sa(1).score == 0.0
    assert _sa(1).status == AssignmentStatus.RETURNED

    start = client.get(
        "/api/students/assignments/1/vocabulary/spelling_quiz/start",
        headers=s_headers,
    )
    assert start.status_code == 200, start.text
    revision_session = start.json()["session_id"]
    assert revision_session != first
    prior = {w["content_item_id"]: w for w in start.json()["words"]}
    assert prior[2]["prior_is_correct"] is False  # 解鎖，可重答

    assert _answer(
        s_headers, revision_session, 1, "look forward to", ["look", "forward", "to"]
    )["is_correct"]
    assert _answer(s_headers, revision_session, 2, "apple", ["apple"])["is_correct"]
    done = _complete(s_headers, revision_session)
    assert done["score"] == 0.0
    sa = _sa(1)
    assert sa.status == AssignmentStatus.RESUBMITTED
    assert sa.score == 0.0  # 凍結的是重算後的第一次作答分數


def test_start_self_heals_stale_revision_session(setup_database):
    """設定已改但訂正 session 沒被重算（例如舊資料）→ start 時自行重判並解鎖。"""
    _seed_fresh_quiz("whole_question")
    s_headers = _student_headers(1)
    first = _start(s_headers)
    _answer(s_headers, first, 2, "Apple", ["Apple"])
    _complete(s_headers, first)
    back = client.post(
        "/api/teachers/assignments/1/return-for-revision",
        headers=_teacher_headers(),
        json={"student_id": 1},
    )
    assert back.status_code == 200, back.text
    # 直接改 DB（不經 PATCH → 不會觸發 recompute），模擬過期的訂正 session
    db = TestingSessionLocal()
    try:
        db.query(Assignment).filter_by(id=1).one().quiz_case_sensitive = True
        db.commit()
    finally:
        db.close()
    start = client.get(
        "/api/students/assignments/1/vocabulary/spelling_quiz/start",
        headers=s_headers,
    )
    assert start.status_code == 200, start.text
    prior = {w["content_item_id"]: w for w in start.json()["words"]}
    assert prior[2]["prior_is_correct"] is False


@pytest.mark.parametrize(
    "raw_points",
    [
        "NaN",
        "Infinity",
        "-Infinity",
        "0.05",
        "1.25",
        "0",
        "100.1",
        "1e30",
        "-1",
    ],
)
def test_create_rejects_invalid_points_values(setup_database, raw_points):
    """扣分：0.1～100、最多一位小數；NaN / Infinity 一律 422（不是 500）。"""
    _seed_base()
    body = (
        '{"title": "quiz", "classroom_id": 1, "content_ids": [1], '
        '"student_ids": [], "practice_mode": "word_spelling_quiz", '
        '"quiz_scoring_method": "fixed_per_letter", '
        f'"quiz_scoring_points": {raw_points}}}'
    )
    resp = client.post(
        "/api/teachers/assignments/create",
        headers={**_teacher_headers(), "Content-Type": "application/json"},
        content=body,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("points", [0.1, 2.5, 100])
def test_create_accepts_one_decimal_points(setup_database, points):
    _seed_base()
    resp = client.post(
        "/api/teachers/assignments/create",
        headers=_teacher_headers(),
        json=_create_payload(
            "word_spelling_quiz",
            quiz_scoring_method="fixed_per_word",
            quiz_scoring_points=points,
        ),
    )
    assert resp.status_code == 200, resp.text


def test_patch_rejects_two_decimal_points(setup_database):
    _seed_quiz(method="fixed_per_word")
    db = TestingSessionLocal()
    try:
        db.query(Assignment).filter_by(id=1).one().quiz_scoring_points = 1
        db.commit()
    finally:
        db.close()
    resp = _patch(_teacher_headers(), quiz_scoring_points=0.25)
    assert resp.status_code == 422, resp.text
    assert _sa(1).score == 90.0


def test_start_resume_without_setting_change_does_not_commit(setup_database):
    """續考（設定沒變）→ 重判沒改到值就不另外 commit。

    _start_quiz_session 本身續考時就會 commit 一次（#828 既有行為），這裡確認
    _existing_typed_answers_rejudged 不再多加一次。"""
    _seed_fresh_quiz("whole_question")
    s_headers = _student_headers(1)
    first = _start(s_headers)
    _answer(s_headers, first, 2, "apple", ["apple"])

    commits = []

    def _count_commit(conn):
        commits.append(conn)

    event.listen(engine, "commit", _count_commit)
    try:
        start = client.get(
            "/api/students/assignments/1/vocabulary/spelling_quiz/start",
            headers=s_headers,
        )
    finally:
        event.remove(engine, "commit", _count_commit)
    assert start.status_code == 200, start.text
    assert start.json()["session_id"] == first
    assert len(commits) == 1
