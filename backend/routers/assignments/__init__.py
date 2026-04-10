"""
Assignment routers - modular structure

This module aggregates all assignment-related routers:
- CRUD operations
- Assignment details and progress
- Student submissions
- Grading (AI and manual)
"""

from fastapi import APIRouter
from . import crud, detail, submission, grading, analysis
from .grading import get_student_submission  # noqa: E402

# Main router with prefix - note: no trailing slash
router = APIRouter(prefix="/api/teachers/assignments", tags=["assignments"])

# Include CRUD operations (create, read, update, delete)
router.include_router(crud.router, tags=["assignments-crud"])

# Add route alias for /api/teachers/assignments (without trailing slash)
# to avoid 307 redirect when frontend calls without trailing slash
router.add_api_route(
    "",
    crud.get_assignments,
    methods=["GET"],
    include_in_schema=False,  # Hide from docs to avoid duplicate
)

# Include detail and progress endpoints
router.include_router(detail.router, tags=["assignments-detail"])

# Include student submission endpoints
router.include_router(submission.router, tags=["assignments-submission"])

# Include grading endpoints (AI and manual)
router.include_router(grading.router, tags=["assignments-grading"])

# Include analysis endpoints (report generation)
router.include_router(analysis.router, tags=["assignments-analysis"])

__all__ = ["router", "get_student_submission"]
