"""
Teachers router module - Aggregates all teacher-related API endpoints.

This module consolidates the previously monolithic teachers.py (3237 lines)
into a modular structure for better maintainability.
"""
from fastapi import APIRouter

from . import (
    profile_ops,
    dashboard,
    subscription_ops,
    classroom_ops,
    student_ops,
    program_ops,
    content_ops,
    translation_ops,
    tts_ops,
    upload_ops,
    assignment_ops,
    instant_practice,
    teacher_organizations,
    one_campus_ops,
)

# Create main router with prefix and tags
router = APIRouter(prefix="/api/teachers", tags=["teachers"])

# Include all sub-routers
router.include_router(profile_ops.router, tags=["teachers-profile"])
router.include_router(dashboard.router, tags=["teachers-dashboard"])
router.include_router(subscription_ops.router, tags=["teachers-subscription"])
router.include_router(classroom_ops.router, tags=["teachers-classrooms"])
router.include_router(student_ops.router, tags=["teachers-students"])
router.include_router(program_ops.router, tags=["teachers-programs"])
router.include_router(content_ops.router, tags=["teachers-content"])
router.include_router(translation_ops.router, tags=["teachers-translation"])
router.include_router(tts_ops.router, tags=["teachers-tts"])
router.include_router(upload_ops.router, tags=["teachers-upload"])
router.include_router(assignment_ops.router, tags=["teachers-assignments"])
router.include_router(instant_practice.router, tags=["teachers-instant-practice"])
router.include_router(teacher_organizations.router, tags=["teachers-organizations"])
router.include_router(one_campus_ops.router, tags=["teachers-one-campus"])

# Re-export router and dependencies for backward compatibility
from .dependencies import get_current_teacher  # noqa: E402

__all__ = ["router", "get_current_teacher"]
