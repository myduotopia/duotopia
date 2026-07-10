"""
Assignment detail and progress endpoints
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from sqlalchemy import text, func, case

from database import get_db
from models import (
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentItemProgress,
    PracticeSession,
    PracticeAnswer,
    AssignmentStatus,
)
from .dependencies import get_current_teacher
from .utils import compute_speaking_total_score
from .validators import LIVE_QUIZ_MODES

# Single source of truth for speaking-scored modes (Azure pronunciation assessment,
# score_category=speaking). Imported — not re-declared — so a new speaking mode added
# in score_category.py can't silently miss the #813 display fallback here.
from utils.score_category import _SPEAKING_MODES as _SPEAKING_SCORE_MODES

logger = logging.getLogger(__name__)

router = APIRouter()

# Auto-graded practice modes (matching students/assignments.py)
AUTO_GRADED_MODES = frozenset(
    {"rearrangement", "word_selection", "word_spelling", "word_cloze"}
)

# Modes that derive interim mastery from calculate_assignment_mastery() —
# all three accumulate correct/incorrect counts on
# StudentItemProgress.word_selection_data, which the PG function reads.
_MASTERY_FUNCTION_MODES = frozenset({"word_selection", "word_spelling", "word_cloze"})


def _get_total_item_count(assignment_id: int, db: Session) -> int:
    """Get total ContentItem count for an assignment via AssignmentContent → Content → ContentItem."""
    return (
        db.query(func.count(ContentItem.id))
        .join(Content, ContentItem.content_id == Content.id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .scalar()
        or 0
    )


def _get_canonical_items(assignment_id: int, db: Session):
    """The assignment's canonical ContentItem rows (AssignmentContent → Content → ContentItem).

    Invariant per assignment — callers hoist this out of per-student loops and
    pass it into _compute_interim_score to avoid an N+1 in the speaking fallback.
    """
    return (
        db.query(ContentItem)
        .join(Content, ContentItem.content_id == Content.id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .all()
    )


def _is_interim_score(sa, assignment) -> bool:
    """Check if a student assignment should show an interim (provisional) score."""
    return (
        sa is not None
        and sa.score is None
        and sa.status is not None
        and sa.status.value == "IN_PROGRESS"
        and assignment.practice_mode in AUTO_GRADED_MODES
    )


def _compute_interim_score(
    sa, assignment, db: Session, total_items: int | None = None, canonical_items=None
):
    """
    Compute display score for /progress endpoint.

    - sa.score 有值 → 直接回傳（fast path）
    - sa.score 為 None：
      * mastery-based modes (word_selection / word_spelling / word_cloze)
        不論 status 都呼叫 calculate_assignment_mastery 現算。
        Issue #807：歷史壞資料（GRADED 但 score=None，因 submit 端點曾漏寫）
        靠這條 fallback 仍能顯示正確分數，不需 backfill。
      * rearrangement：只在 IN_PROGRESS 時用 expected_score 平均（interim）。
        GRADED+score=None 視為資料異常，回 None（不替它重算）。

    Args:
        total_items: Pre-computed total item count to avoid redundant DB queries.
    """
    if sa.score is not None:
        return sa.score

    practice_mode = assignment.practice_mode

    # Mastery-based modes：score 為 None 時不論 status 都現算 mastery
    if practice_mode in _MASTERY_FUNCTION_MODES:
        try:
            result = db.execute(
                text("SELECT * FROM calculate_assignment_mastery(:sa_id)"),
                {"sa_id": sa.id},
            ).fetchone()
        except Exception:
            logger.warning(
                "calculate_assignment_mastery raised while computing display "
                "score for sa_id=%s mode=%s; returning None",
                sa.id,
                practice_mode,
                exc_info=True,
            )
            return None
        if result and result.current_mastery is not None:
            return min(100, round(float(result.current_mastery) * 100, 1))
        return None

    # Rearrangement：只在 IN_PROGRESS 算 interim
    if (
        sa.status
        and sa.status.value == "IN_PROGRESS"
        and practice_mode == "rearrangement"
    ):
        items = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == sa.id)
            .all()
        )
        valid_scores = [
            float(p.expected_score) for p in items if p.expected_score is not None
        ]
        if not valid_scores:
            return None
        if total_items is None:
            total_items = _get_total_item_count(assignment.id, db)
        if total_items == 0:
            return None
        return round(sum(valid_scores) / total_items, 1)

    # Speaking modes (例句朗讀 / 單字朗讀): sa.score is the batch-grade roll-up of
    # item-level AI scores. Issue #813 — some GRADED rows never got that roll-up
    # (item scores exist, sa.score=NULL) and surfaced as 0. Recompute from items.
    if practice_mode in _SPEAKING_SCORE_MODES:
        # Only recompute for a GRADED assignment — that's the #813 state (batch-grade
        # finalized status=GRADED but never wrote sa.score). For any other status
        # (SUBMITTED/RESUBMITTED/RETURNED/IN_PROGRESS) a NULL score is expected because
        # grading hasn't completed; computing a partial item-level average there would
        # render as a misleading FINAL score (speaking modes aren't in AUTO_GRADED_MODES,
        # so _is_interim_score is False and the UI shows no "~" marker).
        if not (sa.status and sa.status.value == "GRADED"):
            return None
        # canonical_items is invariant per assignment — callers pass it pre-fetched
        # to avoid re-querying once per student (this runs in per-student loops).
        if canonical_items is None:
            canonical_items = _get_canonical_items(assignment.id, db)
        if not canonical_items:
            return None
        progress_by_item = {
            p.content_item_id: p
            for p in db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == sa.id)
            .all()
        }
        return compute_speaking_total_score(canonical_items, progress_by_item)

    return None


@router.get("/{assignment_id}")
async def get_assignment_detail(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    取得作業詳細資訊（新架構）
    """
    # 取得作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # 取得內容列表
    assignment_contents = (
        db.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .order_by(AssignmentContent.order_index)
        .all()
    )

    # 優化：批次查詢所有 content，避免 N+1 問題
    content_ids = [ac.content_id for ac in assignment_contents]
    content_dict = {
        c.id: c for c in db.query(Content).filter(Content.id.in_(content_ids)).all()
    }

    contents = []
    for ac in assignment_contents:
        content = content_dict.get(ac.content_id)
        if content:
            contents.append(
                {
                    "id": content.id,
                    "title": content.title,
                    "type": (
                        content.type.value
                        if hasattr(content.type, "value")
                        else str(content.type)
                    ),
                    "order_index": ac.order_index,
                }
            )

    # 取得學生進度（使用 eager loading 避免 N+1）
    student_assignments = (
        db.query(StudentAssignment)
        .options(selectinload(StudentAssignment.content_progress))
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.is_active.is_(True),
        )
        .all()
    )

    # 收集已指派的學生 IDs
    student_ids = [sa.student_id for sa in student_assignments]

    # 取得班級的全部學生，並標示指派狀態
    all_students = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == assignment.classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .order_by(Student.student_number)
        .all()
    )

    # Pre-compute total item count once (avoids O(N) redundant queries in the loop)
    total_items = _get_total_item_count(assignment.id, db)

    # Speaking-mode fallback needs the assignment's canonical items; fetch once
    # here (invariant per assignment) and pass into _compute_interim_score so we
    # don't re-query per student.
    speaking_canonical_items = (
        _get_canonical_items(assignment.id, db)
        if assignment.practice_mode in _SPEAKING_SCORE_MODES
        else None
    )

    students_progress = []
    for student in all_students:
        # 檢查這個學生是否已被指派
        sa = None
        for student_assignment in student_assignments:
            if student_assignment.student_id == student.id:
                sa = student_assignment
                break

        is_assigned = sa is not None

        # 取得各內容進度（使用預先載入的資料，避免 N+1）
        content_progress = []
        if sa:  # 只有已指派的學生才有進度資料
            # 建立 content_id -> progress 的映射（從預先載入的資料）
            progress_map = {p.content_id: p for p in sa.content_progress}

            for content in contents:
                progress = progress_map.get(content["id"])

                if progress:
                    content_progress.append(
                        {
                            "content_id": content["id"],
                            "content_title": content["title"],
                            "status": (
                                progress.status.value
                                if progress.status
                                else "NOT_STARTED"
                            ),
                            "score": progress.score,
                            "checked": progress.checked,
                            "completed_at": (
                                progress.completed_at.isoformat()
                                if progress.completed_at
                                else None
                            ),
                        }
                    )

        students_progress.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "student_number": student.student_number,
                "is_assigned": is_assigned,
                "overall_status": (
                    sa.status.value
                    if sa and sa.status
                    else ("NOT_STARTED" if is_assigned else "unassigned")
                ),
                "submitted_at": (
                    sa.submitted_at.isoformat() if sa and sa.submitted_at else None
                ),
                "content_progress": content_progress,
                "score": (
                    _compute_interim_score(
                        sa,
                        assignment,
                        db,
                        total_items=total_items,
                        canonical_items=speaking_canonical_items,
                    )
                    if sa
                    else None
                ),
                "is_interim_score": _is_interim_score(sa, assignment),
            }
        )

    # Get content_type from first content
    content_type = contents[0]["type"] if contents else None

    return {
        "id": assignment.id,
        "title": assignment.title,
        "description": assignment.description,
        "classroom_id": assignment.classroom_id,
        "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
        "start_date": assignment.start_date.isoformat()
        if assignment.start_date
        else None,
        "created_at": (
            assignment.created_at.isoformat() if assignment.created_at else None
        ),
        "contents": contents,
        "student_ids": student_ids,
        "students_progress": students_progress,
        # 內容類型與作答模式
        "content_type": content_type,
        "practice_mode": assignment.practice_mode,
        "answer_mode": assignment.answer_mode,
        "time_limit_per_question": assignment.time_limit_per_question,
        "shuffle_questions": assignment.shuffle_questions,
        "play_audio": assignment.play_audio,
        "show_answer": assignment.show_answer,
        "score_category": assignment.score_category,
        "target_proficiency": assignment.target_proficiency,
        "show_translation": assignment.show_translation,
        "show_word": assignment.show_word,
        "show_image": assignment.show_image,
        "show_option_images": bool(getattr(assignment, "show_option_images", False)),
        # Issue #835: 編輯 sheet 讀回 live 模式原始值
        "quiz_time_limit_seconds": assignment.quiz_time_limit_seconds,
        "is_live_quiz": bool(getattr(assignment, "is_live_quiz", False)),
    }


@router.get("/{assignment_id}/progress")
async def get_assignment_progress(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """
    取得作業的學生進度
    """
    # 確認作業存在且屬於當前教師
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )

    # 取得學生作業進度
    student_assignments = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.is_active.is_(True),
        )
        .all()
    )

    # 取得班級全部學生
    all_students = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == assignment.classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .order_by(Student.student_number)
        .all()
    )

    # 優化：使用字典查找避免嵌套循環 O(N*M) 問題
    student_assignments_dict = {sa.student_id: sa for sa in student_assignments}

    # Pre-compute total item count once (avoids O(N) redundant queries in the loop)
    total_items = _get_total_item_count(assignment.id, db)

    # Speaking-mode fallback needs the assignment's canonical items; fetch once
    # here (invariant per assignment) and pass into _compute_interim_score so we
    # don't re-query per student.
    speaking_canonical_items = (
        _get_canonical_items(assignment.id, db)
        if assignment.practice_mode in _SPEAKING_SCORE_MODES
        else None
    )

    # 批改 hub 用的每生聚合（#830）：依作業類型擇一，迴圈外一次抓好避免 N+1。
    practice_mode = assignment.practice_mode or ""
    is_quiz = practice_mode.endswith("_quiz")
    is_speaking = practice_mode in _SPEAKING_SCORE_MODES
    sa_ids = [sa.id for sa in student_assignments]

    # 小考：每生「第一次 completed」session 的答對題數（與凍結分一致）
    quiz_correct_by_sa = {}
    if is_quiz and sa_ids:
        for sa_id, correct in (
            db.query(
                PracticeSession.student_assignment_id,
                PracticeSession.correct_count,
            )
            .filter(
                PracticeSession.student_assignment_id.in_(sa_ids),
                PracticeSession.practice_mode == practice_mode,
                PracticeSession.completed_at.isnot(None),
            )
            .order_by(
                PracticeSession.student_assignment_id,
                PracticeSession.id.asc(),
            )
            .all()
        ):
            if sa_id not in quiz_correct_by_sa:  # 取最小 id（第一次）
                quiz_correct_by_sa[sa_id] = correct or 0

    # 朗讀/口說：每生發音/準確度/流暢度平均。分母為「全部題數」(total_items)，
    # 未錄音/未評估的題視為 0（與總分 compute_speaking_total_score 一致），
    # 故用 SUM(score)/total_items，而非 AVG（AVG 只平均有評分的題）。
    reading_metrics_by_sa = {}
    if is_speaking and sa_ids and total_items:
        for sa_id, pron, acc, flu in (
            db.query(
                StudentItemProgress.student_assignment_id,
                func.sum(StudentItemProgress.pronunciation_score),
                func.sum(StudentItemProgress.accuracy_score),
                func.sum(StudentItemProgress.fluency_score),
            )
            .filter(StudentItemProgress.student_assignment_id.in_(sa_ids))
            .group_by(StudentItemProgress.student_assignment_id)
            .all()
        ):
            reading_metrics_by_sa[sa_id] = {
                "pronunciation": (
                    round(float(pron) / total_items, 1) if pron is not None else None
                ),
                "accuracy": (
                    round(float(acc) / total_items, 1) if acc is not None else None
                ),
                "fluency": (
                    round(float(flu) / total_items, 1) if flu is not None else None
                ),
            }

    progress_list = []
    for student in all_students:
        # 使用字典快速查找，O(1) 時間複雜度
        sa = student_assignments_dict.get(student.id)
        is_assigned = sa is not None

        progress_list.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "student_number": student.student_number,
                "is_assigned": is_assigned,
                "status": (
                    sa.status.value
                    if sa and sa.status
                    else ("NOT_STARTED" if is_assigned else "unassigned")
                ),
                "submission_date": (
                    sa.submitted_at.isoformat() if sa and sa.submitted_at else None
                ),
                "score": (
                    _compute_interim_score(
                        sa,
                        assignment,
                        db,
                        total_items=total_items,
                        canonical_items=speaking_canonical_items,
                    )
                    if sa
                    else None
                ),
                "is_interim_score": _is_interim_score(sa, assignment),
                # #861: 訂正紀錄時間（批改 hub 顯示「訂正日期」）。resubmitted_at =
                # 退回後重新提交的時間；returned_at = 老師退回訂正的時間。
                "resubmitted_at": (
                    sa.resubmitted_at.isoformat() if sa and sa.resubmitted_at else None
                ),
                "returned_at": (
                    sa.returned_at.isoformat() if sa and sa.returned_at else None
                ),
                # 批改 hub 欄位（#830）：依作業類型擇一，其餘為 None
                "correct_count": (
                    quiz_correct_by_sa.get(sa.id) if is_quiz and sa else None
                ),
                "total_questions": total_items if is_quiz else None,
                "metrics": (
                    reading_metrics_by_sa.get(sa.id) if is_speaking and sa else None
                ),
                "attempts": 1 if sa and sa.submitted_at else 0,
                "last_activity": (
                    sa.updated_at.isoformat()
                    if sa and sa.updated_at
                    else sa.created_at.isoformat()
                    if sa and sa.created_at
                    else None
                ),
                "timestamps": {
                    "started_at": (
                        sa.started_at.isoformat() if sa and sa.started_at else None
                    ),
                    "submitted_at": (
                        sa.submitted_at.isoformat() if sa and sa.submitted_at else None
                    ),
                    "graded_at": (
                        sa.graded_at.isoformat() if sa and sa.graded_at else None
                    ),
                    "returned_at": (
                        sa.returned_at.isoformat() if sa and sa.returned_at else None
                    ),
                    "resubmitted_at": (
                        sa.resubmitted_at.isoformat()
                        if sa and sa.resubmitted_at
                        else None
                    ),
                    "created_at": (
                        sa.created_at.isoformat() if sa and sa.created_at else None
                    ),
                    "updated_at": (
                        sa.updated_at.isoformat() if sa and sa.updated_at else None
                    ),
                },
            }
        )

    return progress_list


# ---------------------------------------------------------------------------
# Live quiz teacher controls (Issue #835)
# ---------------------------------------------------------------------------


def _get_owned_live_quiz_or_404(
    assignment_id: int, db: Session, teacher: Teacher
) -> Assignment:
    """取得老師擁有、且為 live quiz 的作業，否則 404/400。"""
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=404, detail="Assignment not found or you don't have permission"
        )
    # Issue #884 item 1: restrict live-quiz teacher ops to the whitelisted modes
    # (word_selection/spelling/cloze_quiz) that have student-side gates, so a
    # speaking_quiz can't be driven as a live quiz.
    practice_mode = assignment.practice_mode or ""
    if practice_mode not in LIVE_QUIZ_MODES or not getattr(
        assignment, "is_live_quiz", False
    ):
        raise HTTPException(
            status_code=400, detail="This is not a live quiz assignment"
        )
    return assignment


def _quiz_control_status(assignment: Assignment) -> dict:
    """老師端 open/close/狀態查詢共用的回應。"""
    opened_at = assignment.quiz_opened_at
    closed_at = assignment.quiz_closed_at
    if closed_at is not None:
        state = "closed"
    elif opened_at is not None:
        state = "open"
    else:
        state = "not_started"
    return {
        "assignment_id": assignment.id,
        "is_live_quiz": bool(getattr(assignment, "is_live_quiz", False)),
        "state": state,
        "opened_at": opened_at.isoformat() if opened_at else None,
        "closed_at": closed_at.isoformat() if closed_at else None,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/{assignment_id}/quiz/open")
async def open_live_quiz(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """老師按「開始考試 / 再次開始」：開放 live 考卷的閘門。

    Issue #835：不做「破壞性 reset」(不清空任何答案/進度)。三態：
    - 已收卷 (quiz_closed_at 非 null) → 「再次開始」(補考)：非破壞性重開 —— 清掉收卷
      閘門、刷新 quiz_opened_at(新一輪錨點)，但不動任何 student_assignment/答案，
      已交學生仍 SUBMITTED 由 _block_if_submitted 擋重考，缺考(NOT_STARTED)學生可進。
    - 尚未開始 (quiz_opened_at 為 null) → 第一次開始。
    - 已開放中 → idempotent no-op。
    """
    assignment = _get_owned_live_quiz_or_404(assignment_id, db, current_teacher)
    now = datetime.now(timezone.utc)
    if assignment.quiz_closed_at is not None:
        assignment.quiz_closed_at = None
        assignment.quiz_opened_at = now
        db.commit()
        db.refresh(assignment)
    elif assignment.quiz_opened_at is None:
        assignment.quiz_opened_at = now
        db.commit()
        db.refresh(assignment)
    return _quiz_control_status(assignment)


@router.post("/{assignment_id}/quiz/close")
async def close_live_quiz(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """老師按「收卷」：設 quiz_closed_at，並強制收尾所有 IN_PROGRESS 學生。

    - force-complete 走學生端同一條 score_and_finalize_quiz（#830 single source
      of truth），依學生「目前已有答案」計分。
    - NOT_STARTED 的學生維持未開始、不計分（缺席不算 0 分）。
    - 已 SUBMITTED/RESUBMITTED/GRADED 的學生（提早交卷）不動。
    """
    # Issue #835: 重用學生端同一條計分路徑（#830 single source of truth）。
    # 與 routers/teachers/assignment_ops.py 一致採函式內 lazy import：detail.py 在 import 期
    # 已被 quiz_assignments 鏈間接載入，top-level import 會 circular（students/assignments.py 無此鏈故可 top-level）。
    from routers.students.quiz_assignments import score_and_finalize_quiz

    assignment = _get_owned_live_quiz_or_404(assignment_id, db, current_teacher)
    practice_mode = assignment.practice_mode

    from services.realtime_broadcast import broadcast_quiz_closed

    # 重複收卷 idempotent：closed_at 已設則不覆寫時間，僅再收尾殘留 IN_PROGRESS。
    # 先 commit 關閘門：個別學生計分失敗不該 rollback 整筆收卷（否則閘門被退回、
    # 老師拿到 500、學生繼續作答）；且 closed_at 一落地，answer 端的
    # _guard_live_gate 立即回 409，server-side 即時止血。
    was_already_closed = assignment.quiz_closed_at is not None
    if not was_already_closed:
        assignment.quiz_closed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(assignment)

        # Issue #835 點 1：閘門一關就先推 Realtime broadcast，讓全班即時跳離考卷頁。
        # 刻意放在逐生計分迴圈「之前」→ 大班級不會被數十次 DB round-trip 拖過推播時機。
        # 只在「本次真的關閉」時推播，重複收卷不重發 broadcast（避免混亂 log）。
        # broadcast_quiz_closed 永不拋例外；未設定/失敗時學生端 polling fallback 接手。
        await broadcast_quiz_closed(
            assignment.id, assignment.quiz_closed_at.isoformat()
        )

    in_progress = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment.id,
            StudentAssignment.is_active.is_(True),
            StudentAssignment.status == AssignmentStatus.IN_PROGRESS,
        )
        .all()
    )
    forced = 0
    # IN_PROGRESS 但無 session/答案者，compute_quiz_score 安全回 0 分，仍正常收卷。
    # 逐生 commit + best-effort：單生失敗只 rollback 該生（閘門已先 commit 不受影響），
    # 記錄後續查，其餘學生照常收尾。
    for sa in in_progress:
        try:
            score_and_finalize_quiz(db, sa, practice_mode)
            db.commit()
            forced += 1
        except Exception:
            db.rollback()
            logger.exception("收卷 force-complete 失敗，跳過 sa=%s", sa.id)
    db.refresh(assignment)

    result = _quiz_control_status(assignment)
    result["force_completed_count"] = forced
    return result


@router.get("/{assignment_id}/quiz/live-progress")
async def get_quiz_live_progress(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """監考即時看板用：每位學生狀態 + 進行中暫定答對/已答題數，供即時排行。

    與 ``/progress`` 不同：correct_count 取「最新 session（含未完成）」的即時答對數，
    而非批改 hub 那筆「第一次 completed」凍結值，這樣考試進行中就看得到排行變化。
    回應 students 形狀對齊 StudentStatusPanel 期望的欄位。
    """
    assignment = _get_owned_live_quiz_or_404(assignment_id, db, current_teacher)
    practice_mode = assignment.practice_mode

    student_assignments = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment.id,
            StudentAssignment.is_active.is_(True),
        )
        .all()
    )
    all_students = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == assignment.classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .order_by(Student.student_number)
        .all()
    )
    sa_by_student = {sa.student_id: sa for sa in student_assignments}
    sa_ids = [sa.id for sa in student_assignments]
    total_items = _get_total_item_count(assignment.id, db)

    # 每生最新 session（含未完成）的答對/已答數 — 即時排行依此。
    # 取每生 id 最大的 session：進行中 completed_at 仍為 null，靠遞增 id 鎖定「最新一輪」。
    # 與 latest_quiz_session() 同義，但此處需一次 batch 多名學生，故獨立子查詢。
    answered_by_sa: dict = {}
    correct_by_sa: dict = {}
    if sa_ids:
        latest_session = (
            db.query(
                PracticeSession.student_assignment_id.label("sa_id"),
                func.max(PracticeSession.id).label("sid"),
            )
            .filter(
                PracticeSession.student_assignment_id.in_(sa_ids),
                PracticeSession.practice_mode == practice_mode,
            )
            .group_by(PracticeSession.student_assignment_id)
            .subquery()
        )
        for sa_id, answered, correct in (
            db.query(
                latest_session.c.sa_id,
                func.count(PracticeAnswer.id),
                func.coalesce(
                    func.sum(case((PracticeAnswer.is_correct.is_(True), 1), else_=0)),
                    0,
                ),
            )
            .select_from(latest_session)
            .outerjoin(
                PracticeAnswer,
                PracticeAnswer.practice_session_id == latest_session.c.sid,
            )
            .group_by(latest_session.c.sa_id)
            .all()
        ):
            answered_by_sa[sa_id] = int(answered or 0)
            correct_by_sa[sa_id] = int(correct or 0)

    students = []
    for student in all_students:
        sa = sa_by_student.get(student.id)
        is_assigned = sa is not None
        students.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "student_number": student.student_number,
                "is_assigned": is_assigned,
                "status": (
                    sa.status.value
                    if sa and sa.status
                    else ("NOT_STARTED" if is_assigned else "unassigned")
                ),
                "score": sa.score if sa and sa.score is not None else None,
                "correct_count": correct_by_sa.get(sa.id) if sa else None,
                "answered_count": answered_by_sa.get(sa.id) if sa else None,
                "total_questions": total_items,
            }
        )

    result = _quiz_control_status(assignment)
    result["total_students"] = len(all_students)
    result["submitted_count"] = sum(
        1 for s in students if s["status"] in ("SUBMITTED", "RESUBMITTED", "GRADED")
    )
    result["students"] = students
    return result


@router.get("/{assignment_id}/quiz-question-stats")
async def get_quiz_question_stats(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """小考班級統計：每題答對/答錯/未作答的學生名單（#830）。

    以每位「已提交」學生的第一次 completed session（凍結那筆）為準。
    答對=有答案且 is_correct；答錯=有答案但不對；未作答=該題無答案紀錄。
    """
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
            Assignment.is_active.is_(True),
        )
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found or you don't have permission",
        )

    practice_mode = assignment.practice_mode or ""
    if not practice_mode.endswith("_quiz"):
        return {"is_quiz": False, "total_submitted": 0, "questions": []}

    # 1. canonical content items（依序 → question_number 1..N）
    items = (
        db.query(ContentItem)
        .join(Content, ContentItem.content_id == Content.id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .order_by(
            AssignmentContent.order_index,
            ContentItem.order_index,
            ContentItem.id,
        )
        .all()
    )

    # 2. 已提交學生（帶 Student 資料）
    # 註（#845 review）：刻意只算 SUBMITTED/RESUBMITTED/GRADED；RETURNED 的學生正處於
    # 訂正循環中，會暫時從每題統計桶消失，等他們重新提交（→ RESUBMITTED）才回到統計。
    # 這是「正在訂正＝尚未定稿」的取捨，避免把訂正中的中間狀態混進班級答對率。
    submitted = (
        db.query(StudentAssignment, Student)
        .join(Student, Student.id == StudentAssignment.student_id)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.status.in_(
                [
                    AssignmentStatus.SUBMITTED,
                    AssignmentStatus.RESUBMITTED,
                    AssignmentStatus.GRADED,
                ]
            ),
        )
        .all()
    )
    student_meta = {
        sa.id: {
            "student_id": st.id,
            "name": st.name,
            "number": st.student_number,
        }
        for sa, st in submitted
    }
    sa_ids = list(student_meta.keys())

    # 3. 每位 SA 第一次 completed session（最小 id）
    first_session_by_sa = {}
    if sa_ids:
        for sa_id, sess_id in (
            db.query(PracticeSession.student_assignment_id, PracticeSession.id)
            .filter(
                PracticeSession.student_assignment_id.in_(sa_ids),
                PracticeSession.practice_mode == practice_mode,
                PracticeSession.completed_at.isnot(None),
            )
            .order_by(
                PracticeSession.student_assignment_id,
                PracticeSession.id.asc(),
            )
            .all()
        ):
            if sa_id not in first_session_by_sa:
                first_session_by_sa[sa_id] = sess_id
    session_to_sa = {v: k for k, v in first_session_by_sa.items()}

    # 4. 第一次 session 的答案 → (sa_id, content_item_id) → is_correct
    correct_map = {}
    if session_to_sa:
        for sess_id, item_id, is_correct in (
            db.query(
                PracticeAnswer.practice_session_id,
                PracticeAnswer.content_item_id,
                PracticeAnswer.is_correct,
            )
            .filter(PracticeAnswer.practice_session_id.in_(list(session_to_sa.keys())))
            .all()
        ):
            sa_id = session_to_sa.get(sess_id)
            if sa_id is not None:
                correct_map[(sa_id, item_id)] = bool(is_correct)

    # 5. 每題分三類 + 題目/答案（依類型）
    is_cloze = practice_mode == "word_cloze_quiz"
    questions = []
    for idx, item in enumerate(items, start=1):
        correct, wrong, unanswered = [], [], []
        for sa_id in sa_ids:
            meta = student_meta[sa_id]
            ans = correct_map.get((sa_id, item.id))
            if ans is True:
                correct.append(meta)
            elif ans is False:
                wrong.append(meta)
            else:
                unanswered.append(meta)
        # 題目(prompt)＝給學生看的提示；答案(answer)＝正確答案
        if is_cloze:
            prompt = getattr(item, "example_sentence", None) or ""
            answer = getattr(item, "cloze_answer", None) or item.text or ""
        else:
            prompt = getattr(item, "translation", None) or ""
            answer = item.text or ""
        questions.append(
            {
                "question_number": idx,
                "content_item_id": item.id,
                "prompt": prompt,
                "answer": answer,
                "correct": correct,
                "wrong": wrong,
                "unanswered": unanswered,
            }
        )

    return {
        "is_quiz": True,
        "total_submitted": len(sa_ids),
        "questions": questions,
    }


@router.get("/{assignment_id}/students")
async def get_assignment_students(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    獲取作業的所有學生列表（包含未指派的學生）
    """
    # 查詢作業
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id, Assignment.teacher_id == current_teacher.id
        )
        .first()
    )

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 獲取教師教室中的所有學生
    classroom_students = (
        db.query(Student)
        .join(ClassroomStudent, ClassroomStudent.student_id == Student.id)
        .filter(ClassroomStudent.classroom_id == assignment.classroom_id)
        .order_by(Student.name)
        .all()
    )

    # 獲取已指派此作業的學生狀態
    student_assignments_dict = {}
    student_assignments = (
        db.query(StudentAssignment)
        .filter(StudentAssignment.assignment_id == assignment_id)
        .all()
    )

    for sa in student_assignments:
        student_assignments_dict[sa.student_id] = {
            "status": sa.status.value if sa.status else "NOT_STARTED",
            "score": sa.score,
        }

    students = []
    for student in classroom_students:
        # 如果學生有作業記錄，使用實際狀態；否則標示為未指派
        if student.id in student_assignments_dict:
            info = student_assignments_dict[student.id]
            status = info["status"]
            score = info["score"]
        else:
            status = "NOT_ASSIGNED"
            score = None

        students.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "status": status,
                "score": score,
            }
        )

    return {"students": students}
