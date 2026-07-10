"""
Assignment Analysis Service
產生作業學生表現與能力分析報告

支援三種作業模式：
- rearrangement: 例句重組
- reading: 例句朗讀
- word_selection: 單字選擇
"""

import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

from models.assignment import (
    Assignment,
    AssignmentAnalysisReport,
    AssignmentContent,
    StudentAssignment,
)
from models.progress import StudentItemProgress
from models.program import ContentItem
from models.user import Student

logger = logging.getLogger(__name__)

# 估算常數：每位學生的分析約消耗的 token 數
TOKENS_PER_STUDENT = 200
BASE_TOKENS = 500  # prompt + 系統指令的基礎 token
# 1 token ≈ 0.1 秒配額（以「字」的換算率計算）
TOKENS_TO_SECONDS_RATE = 0.1


def estimate_analysis_cost(db: Session, assignment_id: int) -> Dict[str, Any]:
    """
    估算分析報告所需的 token 數與點數

    Returns:
        {
            "student_count": int,
            "estimated_tokens": int,
            "estimated_points": int,  # 以「秒」為單位
        }
    """
    student_count = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment_id,
            StudentAssignment.is_active == True,  # noqa: E712
        )
        .count()
    )

    estimated_tokens = BASE_TOKENS + (student_count * TOKENS_PER_STUDENT)
    # 轉換為點數（秒）：token 數 × 換算率
    estimated_points = max(10, int(estimated_tokens * TOKENS_TO_SECONDS_RATE))

    return {
        "student_count": student_count,
        "estimated_tokens": estimated_tokens,
        "estimated_points": estimated_points,
    }


def _collect_rearrangement_data(
    db: Session, assignment: Assignment, student_assignments: List[StudentAssignment]
) -> Dict[str, Any]:
    """收集例句重組的分析資料"""
    # 取得所有內容項目
    content_items = (
        db.query(ContentItem)
        .join(AssignmentContent, AssignmentContent.content_id == ContentItem.content_id)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .all()
    )
    content_item_map = {ci.id: ci for ci in content_items}

    # Bulk load students and progress to avoid N+1 queries
    sa_ids = [sa.id for sa in student_assignments]
    student_ids = [sa.student_id for sa in student_assignments]

    students = (
        db.query(Student).filter(Student.id.in_(student_ids)).all()
        if student_ids
        else []
    )
    student_map = {s.id: s for s in students}

    all_progress = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id.in_(sa_ids))
        .all()
        if sa_ids
        else []
    )
    progress_by_sa = {}
    for p in all_progress:
        progress_by_sa.setdefault(p.student_assignment_id, []).append(p)

    students_data = []
    for sa in student_assignments:
        student = student_map.get(sa.student_id)
        if not student:
            continue

        items = progress_by_sa.get(sa.id, [])

        item_results = []
        for item in items:
            ci = content_item_map.get(item.content_item_id)
            sentence = ci.text if ci else "Unknown"
            item_results.append(
                {
                    "sentence": sentence,
                    "score": float(item.expected_score or 0),
                    "error_count": item.error_count or 0,
                    "retry_count": item.retry_count or 0,
                    "timeout": item.timeout_ended or False,
                    "selections": (
                        item.rearrangement_data.get("selections", [])
                        if item.rearrangement_data
                        else []
                    ),
                }
            )

        students_data.append(
            {
                "name": student.name or f"學生{student.id}",
                "student_number": student.student_number or "",
                "overall_score": float(sa.score or 0),
                "status": sa.status,
                "items": item_results,
            }
        )

    return {
        "practice_mode": "rearrangement",
        "assignment_title": assignment.title,
        "total_sentences": len(content_items),
        "students": students_data,
    }


def _collect_reading_data(
    db: Session, assignment: Assignment, student_assignments: List[StudentAssignment]
) -> Dict[str, Any]:
    """收集例句朗讀的分析資料"""
    content_items = (
        db.query(ContentItem)
        .join(AssignmentContent, AssignmentContent.content_id == ContentItem.content_id)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .all()
    )
    content_item_map = {ci.id: ci for ci in content_items}

    # Bulk load students and progress to avoid N+1 queries
    sa_ids = [sa.id for sa in student_assignments]
    student_ids = [sa.student_id for sa in student_assignments]

    students = (
        db.query(Student).filter(Student.id.in_(student_ids)).all()
        if student_ids
        else []
    )
    student_map = {s.id: s for s in students}

    all_progress = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id.in_(sa_ids))
        .all()
        if sa_ids
        else []
    )
    progress_by_sa = {}
    for p in all_progress:
        progress_by_sa.setdefault(p.student_assignment_id, []).append(p)

    students_data = []
    for sa in student_assignments:
        student = student_map.get(sa.student_id)
        if not student:
            continue

        items = progress_by_sa.get(sa.id, [])

        item_results = []
        for item in items:
            ci = content_item_map.get(item.content_item_id)
            sentence = ci.text if ci else "Unknown"
            item_results.append(
                {
                    "sentence": sentence,
                    "accuracy_score": float(item.accuracy_score or 0),
                    "fluency_score": float(item.fluency_score or 0),
                    "pronunciation_score": float(item.pronunciation_score or 0),
                    "completeness_score": float(item.completeness_score or 0),
                    "transcription": item.transcription or "",
                }
            )

        students_data.append(
            {
                "name": student.name or f"學生{student.id}",
                "student_number": student.student_number or "",
                "overall_score": float(sa.score or 0),
                "status": sa.status,
                "items": item_results,
            }
        )

    return {
        "practice_mode": "reading",
        "assignment_title": assignment.title,
        "total_sentences": len(content_items),
        "students": students_data,
    }


def _collect_word_selection_data(
    db: Session, assignment: Assignment, student_assignments: List[StudentAssignment]
) -> Dict[str, Any]:
    """收集單字選擇的分析資料"""
    content_items = (
        db.query(ContentItem)
        .join(AssignmentContent, AssignmentContent.content_id == ContentItem.content_id)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .all()
    )
    content_item_map = {ci.id: ci for ci in content_items}

    # Bulk load students and progress to avoid N+1 queries
    sa_ids = [sa.id for sa in student_assignments]
    student_ids = [sa.student_id for sa in student_assignments]

    students = (
        db.query(Student).filter(Student.id.in_(student_ids)).all()
        if student_ids
        else []
    )
    student_map = {s.id: s for s in students}

    all_progress = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id.in_(sa_ids))
        .all()
        if sa_ids
        else []
    )
    progress_by_sa = {}
    for p in all_progress:
        progress_by_sa.setdefault(p.student_assignment_id, []).append(p)

    students_data = []
    for sa in student_assignments:
        student = student_map.get(sa.student_id)
        if not student:
            continue

        items = progress_by_sa.get(sa.id, [])

        item_results = []
        for item in items:
            ci = content_item_map.get(item.content_item_id)
            word = ci.text if ci else "Unknown"
            ws_data = item.word_selection_data or {}
            item_results.append(
                {
                    "word": word,
                    "correct_count": ws_data.get("correct_count", 0),
                    "error_count": ws_data.get("error_count", 0),
                    "history": ws_data.get("history", []),
                }
            )

        students_data.append(
            {
                "name": student.name or f"學生{student.id}",
                "student_number": student.student_number or "",
                "status": sa.status,
                "items": item_results,
            }
        )

    return {
        "practice_mode": "word_selection",
        "assignment_title": assignment.title,
        "total_words": len(content_items),
        "students": students_data,
    }


def _build_prompt(collected_data: Dict[str, Any]) -> str:
    """根據作業模式建立 LLM 分析 prompt"""
    mode = collected_data["practice_mode"]
    title = collected_data["assignment_title"]
    students = collected_data["students"]

    data_json = json.dumps(collected_data, ensure_ascii=False, indent=2)

    if mode == "rearrangement":
        return f"""你是一位英語教學分析專家。請根據以下「例句重組」作業的學生表現數據，產生一份結構化的分析報告。

作業名稱：{title}
學生人數：{len(students)}

數據如下：
{data_json}

請以 JSON 格式回傳分析報告，結構如下：
{{
  "overall_summary": "整體表現摘要（2-3句）",
  "class_statistics": {{
    "average_score": 數字,
    "highest_score": 數字,
    "lowest_score": 數字,
    "completion_rate": "完成率百分比",
    "avg_error_count": 數字
  }},
  "difficult_sentences": [
    {{
      "sentence": "錯誤率最高的句子",
      "error_rate": "百分比",
      "common_errors": ["常見錯誤描述"]
    }}
  ],
  "student_insights": [
    {{
      "name": "學生姓名",
      "strength": "優勢描述",
      "weakness": "弱點描述",
      "suggestion": "個人化建議"
    }}
  ],
  "teaching_suggestions": ["教學建議1", "教學建議2"]
}}

注意：
- 分析錯誤節點（selections 中 is_correct=false 的項目），找出學生在句子哪些位置最容易犯錯
- 分析答題歷程，觀察學生的組句策略
- 重試次數多的學生可能需要額外關注
- 超時的題目代表難度較高
- 請用繁體中文回答"""

    elif mode in ("reading", "word_reading"):
        # Issue #655: word_reading shares the reading prompt; only the
        # human-facing label/unit differ. JSON structure stays identical so the
        # frontend renders both report types the same way.
        label = "單字朗讀" if mode == "word_reading" else "例句朗讀"
        unit = "單字" if mode == "word_reading" else "句子"
        return f"""你是一位英語教學分析專家。請根據以下「{label}」作業的學生表現數據，產生一份結構化的分析報告。

作業名稱：{title}
學生人數：{len(students)}

數據如下：
{data_json}

請以 JSON 格式回傳分析報告，結構如下：
{{
  "overall_summary": "整體表現摘要（2-3句）",
  "class_statistics": {{
    "average_score": 數字,
    "highest_score": 數字,
    "lowest_score": 數字,
    "avg_accuracy": 數字,
    "avg_fluency": 數字,
    "avg_pronunciation": 數字
  }},
  "difficult_sentences": [
    {{
      "sentence": "表現最差的{unit}",
      "avg_score": 數字,
      "common_issues": ["常見問題"]
    }}
  ],
  "student_insights": [
    {{
      "name": "學生姓名",
      "strength": "優勢描述（發音/流暢度/準確度）",
      "weakness": "弱點描述",
      "suggestion": "個人化建議"
    }}
  ],
  "teaching_suggestions": ["教學建議1", "教學建議2"]
}}

注意：
- 分析各項分數（accuracy, fluency, pronunciation, completeness）的分佈
- 找出全班共同的弱點
- 比較 transcription 與原文，找出常見的發音錯誤
- 請用繁體中文回答"""

    elif mode == "word_selection":
        return f"""你是一位英語教學分析專家。請根據以下「單字選擇」作業的學生表現數據，產生一份結構化的分析報告。

作業名稱：{title}
學生人數：{len(students)}

數據如下：
{data_json}

請以 JSON 格式回傳分析報告，結構如下：
{{
  "overall_summary": "整體表現摘要（2-3句）",
  "class_statistics": {{
    "total_words": 數字,
    "avg_correct_rate": "百分比",
    "most_difficult_words": ["最難的單字"]
  }},
  "word_analysis": [
    {{
      "word": "單字",
      "correct_rate": "正確率百分比",
      "error_count": 數字,
      "analysis": "此單字的錯誤模式分析"
    }}
  ],
  "student_insights": [
    {{
      "name": "學生姓名",
      "mastery_level": "掌握程度",
      "weak_words": ["尚未掌握的單字"],
      "suggestion": "個人化建議"
    }}
  ],
  "teaching_suggestions": ["教學建議1", "教學建議2"]
}}

注意：
- 分析每個單字的全班錯誤次數和正確次數
- 找出錯誤率最高的單字
- 觀察學習曲線（history 中答題次序的變化）
- 請用繁體中文回答"""

    else:
        raise ValueError(f"Unsupported practice mode: {mode}")


async def generate_analysis_report(
    db: Session,
    assignment: Assignment,
    teacher_id: int,
) -> AssignmentAnalysisReport:
    """
    產生作業分析報告

    1. 收集學生表現數據
    2. 呼叫 LLM 產生分析
    3. 儲存報告

    Returns:
        AssignmentAnalysisReport
    """
    from services.vertex_ai import get_vertex_ai_service

    practice_mode = assignment.practice_mode or "rearrangement"

    # 取得所有學生作業
    student_assignments = (
        db.query(StudentAssignment)
        .filter(
            StudentAssignment.assignment_id == assignment.id,
            StudentAssignment.is_active == True,  # noqa: E712
        )
        .all()
    )

    # 建立報告記錄
    report = AssignmentAnalysisReport(
        assignment_id=assignment.id,
        teacher_id=teacher_id,
        practice_mode=practice_mode,
        status="pending",
        student_count=len(student_assignments),
    )
    db.add(report)
    db.flush()

    try:
        # 收集數據
        if practice_mode == "rearrangement":
            collected_data = _collect_rearrangement_data(
                db, assignment, student_assignments
            )
        elif practice_mode in ("reading", "word_reading"):
            # Issue #655: word_reading (單字朗讀) is the same speech-assessment
            # data model as reading (例句朗讀), so it reuses the reading
            # collector. Preserve the real mode so the prompt labels it 單字朗讀.
            collected_data = _collect_reading_data(db, assignment, student_assignments)
            collected_data["practice_mode"] = practice_mode
        elif practice_mode == "word_selection":
            collected_data = _collect_word_selection_data(
                db, assignment, student_assignments
            )
        else:
            raise ValueError(f"Unsupported practice mode: {practice_mode}")

        # 建立 prompt 並呼叫 LLM
        prompt = _build_prompt(collected_data)
        vertex_ai = get_vertex_ai_service()

        report_json = await vertex_ai.generate_json(
            prompt=prompt,
            model_type="flash",
            max_tokens=16384,
            temperature=0.3,
            system_instruction="你是英語教學分析專家。請根據數據產生精確、有建設性的分析報告。回傳格式必須是 JSON。",
        )

        # 更新報告
        report.report_data = report_json
        report.summary = report_json.get("overall_summary", "")
        report.status = "completed"
        report.completed_at = datetime.now(timezone.utc)
        # 估算 token 使用量（基於 prompt 長度）
        report.tokens_used = (
            len(prompt) // 4 + len(json.dumps(report_json, ensure_ascii=False)) // 4
        )

        db.commit()
        logger.info(f"Analysis report generated for assignment {assignment.id}")
        return report

    except Exception as e:
        logger.error(f"Failed to generate analysis report: {e}", exc_info=True)
        report.status = "failed"
        report.error_message = str(e)[:500]
        db.commit()
        raise
