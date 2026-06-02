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

from fastapi import APIRouter

from . import (
    auth,
    profile,
    assignments,
    quiz_assignments,
    recordings,
    email_verification,
    account_management,
)

# Create main router with common prefix and tags
router = APIRouter(prefix="/api/students", tags=["students"])

# Include all sub-routers
router.include_router(auth.router, tags=["students-auth"])
router.include_router(profile.router, tags=["students-profile"])
router.include_router(assignments.router, tags=["students-assignments"])
router.include_router(quiz_assignments.router, tags=["students-quiz"])
router.include_router(recordings.router, tags=["students-recordings"])
router.include_router(email_verification.router, tags=["students-email"])
router.include_router(account_management.router, tags=["students-accounts"])

# Export router for backward compatibility
__all__ = ["router"]
