"""
Assignment Analysis Router
作業學生表現與能力分析報告 API

Endpoints:
- POST /{assignment_id}/estimate-analysis: 估算分析成本
- POST /{assignment_id}/generate-analysis: 產生分析報告（扣點）
- GET /{assignment_id}/analysis-report: 取得分析報告
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Assignment, Teacher
from models.assignment import AssignmentAnalysisReport
from services.analysis_service import estimate_analysis_cost, generate_analysis_report
from services.quota_service import QuotaService
from .dependencies import get_current_teacher

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{assignment_id}/estimate-analysis")
async def estimate_analysis(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """估算分析報告的 token 消耗與點數成本"""
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if not assignment.is_archived:
        raise HTTPException(
            status_code=400, detail="Assignment must be archived before analysis"
        )

    # 檢查是否已有分析報告
    existing_report = (
        db.query(AssignmentAnalysisReport)
        .filter(
            AssignmentAnalysisReport.assignment_id == assignment_id,
            AssignmentAnalysisReport.status == "completed",
        )
        .first()
    )

    cost = estimate_analysis_cost(db, assignment_id)

    # 檢查配額
    quota_info = QuotaService.get_quota_info(current_teacher, db)

    return {
        "assignment_id": assignment_id,
        "assignment_title": assignment.title,
        "practice_mode": assignment.practice_mode,
        "student_count": cost["student_count"],
        "estimated_tokens": cost["estimated_tokens"],
        "estimated_points": cost["estimated_points"],
        "quota_remaining": quota_info.get("quota_remaining", 0),
        "has_sufficient_quota": quota_info.get("quota_remaining", 0)
        >= cost["estimated_points"],
        "has_existing_report": existing_report is not None,
        "existing_report_id": existing_report.id if existing_report else None,
    }


@router.post("/{assignment_id}/generate-analysis")
async def generate_analysis(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """產生分析報告並扣除點數"""
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if not assignment.is_archived:
        raise HTTPException(
            status_code=400, detail="Assignment must be archived before analysis"
        )

    # 估算成本
    cost = estimate_analysis_cost(db, assignment_id)
    estimated_points = cost["estimated_points"]

    # 扣除點數
    try:
        usage_log = QuotaService.deduct_quota(
            db=db,
            teacher=current_teacher,
            student_id=None,
            assignment_id=assignment_id,
            feature_type="assignment_analysis",
            unit_count=estimated_points,
            unit_type="秒",
            feature_detail={
                "student_count": cost["student_count"],
                "practice_mode": assignment.practice_mode,
            },
        )
    except HTTPException as e:
        if e.status_code == 402:
            raise HTTPException(
                status_code=402,
                detail="Insufficient quota for analysis. Please purchase more credits.",
            )
        raise

    # 產生報告
    try:
        report = await generate_analysis_report(db, assignment, current_teacher.id)
        report.points_deducted = estimated_points
        db.commit()
    except Exception as e:
        logger.error(f"Analysis generation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate analysis report. Points have been deducted.",
        )

    return {
        "report_id": report.id,
        "status": report.status,
        "summary": report.summary,
        "report_data": report.report_data,
        "tokens_used": report.tokens_used,
        "points_deducted": report.points_deducted,
        "student_count": report.student_count,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "completed_at": (
            report.completed_at.isoformat() if report.completed_at else None
        ),
    }


@router.get("/{assignment_id}/analysis-report")
async def get_analysis_report(
    assignment_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """取得作業分析報告"""
    assignment = (
        db.query(Assignment)
        .filter(
            Assignment.id == assignment_id,
            Assignment.teacher_id == current_teacher.id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # 取得最新的已完成報告
    report = (
        db.query(AssignmentAnalysisReport)
        .filter(
            AssignmentAnalysisReport.assignment_id == assignment_id,
            AssignmentAnalysisReport.status == "completed",
        )
        .order_by(AssignmentAnalysisReport.created_at.desc())
        .first()
    )

    if not report:
        return {"has_report": False, "report": None}

    return {
        "has_report": True,
        "report": {
            "id": report.id,
            "status": report.status,
            "summary": report.summary,
            "report_data": report.report_data,
            "practice_mode": report.practice_mode,
            "student_count": report.student_count,
            "tokens_used": report.tokens_used,
            "points_deducted": report.points_deducted,
            "created_at": (
                report.created_at.isoformat() if report.created_at else None
            ),
            "completed_at": (
                report.completed_at.isoformat() if report.completed_at else None
            ),
        },
    }
