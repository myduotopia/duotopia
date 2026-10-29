"""
Student routers module.

Refactored from monolithic students.py (1548 lines) into modular structure.

Structure:
- auth.py: Authentication endpoints
- profile.py: Profile management and stats
- assignments.py: Assignment operations
- recordings.py: Audio recording uploads
- email_verification.py: Email verification flows
- account_management.py: Account switching and linking
- validators.py: Pydantic schemas
- dependencies.py: Shared dependencies
"""

from fastapi import APIRouter, Depends

from . import (
    auth,
    profile,
    assignments,
    quiz_assignments,
    recordings,
    scenario_dialogue,
    email_verification,
    account_management,
)
from .dependencies import require_visible_assignment_classroom

# Create main router with common prefix and tags
router = APIRouter(prefix="/api/students", tags=["students"])

# Include all sub-routers
router.include_router(auth.router, tags=["students-auth"])
router.include_router(profile.router, tags=["students-profile"])
# #1097：作業內頁（路徑帶作業 id）若所屬班級停用或已刪除 → 403 classroom_inactive；
# 作業列表沒有作業 id，不受影響（列表本身另外過濾）
_assignment_guards = [Depends(require_visible_assignment_classroom)]
router.include_router(
    assignments.router, tags=["students-assignments"], dependencies=_assignment_guards
)
router.include_router(
    quiz_assignments.router, tags=["students-quiz"], dependencies=_assignment_guards
)
router.include_router(recordings.router, tags=["students-recordings"])
# #1140: 情境對話逐題 AI 建議。作業 id 不在路徑上（body 帶 item_progress_id），
# 所以不套 _assignment_guards，端點內自行呼叫 ensure_assignment_classroom_visible。
router.include_router(scenario_dialogue.router, tags=["students-scenario-dialogue"])
router.include_router(email_verification.router, tags=["students-email"])
router.include_router(account_management.router, tags=["students-accounts"])

# Export router for backward compatibility
__all__ = ["router"]
