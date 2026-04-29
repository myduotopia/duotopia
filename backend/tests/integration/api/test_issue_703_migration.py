"""
Issue #703 - Phase A: DB column exists smoke test.

Verifies that StudentItemProgress has the recording_duration_seconds column
declared in the SQLAlchemy model. No DB connection required — this is a
model-level introspection test.
"""
import sys
import os

# Ensure backend package root is importable without a running app
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../"))


def test_student_item_progress_has_recording_duration_seconds():
    """recording_duration_seconds column must exist on StudentItemProgress model."""
    from models.progress import StudentItemProgress  # noqa: PLC0415

    assert hasattr(
        StudentItemProgress, "recording_duration_seconds"
    ), "StudentItemProgress is missing the 'recording_duration_seconds' column"

    col = StudentItemProgress.__table__.c.get("recording_duration_seconds")
    assert col is not None, "Column not found in __table__"
    assert col.nullable, "Column should be nullable (existing rows must not break)"
