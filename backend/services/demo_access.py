"""
Demo Access Service (#989)

Two concerns for the public demo page (`/demo/:assignmentId`):

1. **Access window** — the demo page must honour the schedule the demo teacher
   set when dispatching the assignment (`Assignment.start_date` / `due_date`).
   Before `start_date` the demo is not open yet; after `due_date` it has
   expired. When both are NULL the demo stays open forever, which is the
   behaviour every existing demo assignment relies on.

2. **Resource program resolution** — the expired screen invites the visitor to
   register and copy the material into their own library. To do that the
   frontend needs the *resource pack* program id behind the demo assignment,
   which `resolve_demo_resource_program()` derives.

Kept out of `preview_service.py` on purpose: that module is shared with the
teacher-side preview, which must never be blocked by an assignment schedule.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from models import (
    AssignmentContent,
    Content,
    DemoConfig,
    Lesson,
    Program,
)
from services.resource_materials_service import get_resource_account

logger = logging.getLogger(__name__)

DEMO_ACCESS_ACTIVE = "active"
DEMO_ACCESS_NOT_STARTED = "not_started"
DEMO_ACCESS_EXPIRED = "expired"

# demo_config key holding an explicit assignment -> resource program mapping.
# Only needed when auto-derivation fails (all current demo assignments derive
# cleanly), so it exists as an escape hatch that needs no redeploy.
RESOURCE_PROGRAM_KEY_TEMPLATE = "demo_resource_program_id_{assignment_id}"

# How far to walk up `Program.source_metadata` when the directly linked program
# is a classroom copy rather than the resource template it came from.
_MAX_SOURCE_HOPS = 3


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalise a DB datetime to aware UTC.

    Postgres returns aware datetimes for `DateTime(timezone=True)`, but SQLite
    (used by the test suite) returns naive ones. Comparing a naive datetime to
    an aware `now()` raises TypeError, so assume UTC for naive values.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def get_demo_access_status(assignment) -> str:
    """Return the access status of a demo assignment for right now.

    `start_date` / `due_date` are both optional; an assignment with neither is
    always active. The due boundary is inclusive — a visitor arriving exactly at
    `due_date` is still let in.
    """
    now = datetime.now(timezone.utc)
    start = _as_utc(getattr(assignment, "start_date", None))
    due = _as_utc(getattr(assignment, "due_date", None))

    if start is not None and now < start:
        return DEMO_ACCESS_NOT_STARTED
    if due is not None and now > due:
        return DEMO_ACCESS_EXPIRED
    return DEMO_ACCESS_ACTIVE


def _is_resource_template(program: Optional[Program], resource_account) -> bool:
    """True when `program` is a copyable template owned by the resource account."""
    return bool(
        program
        and resource_account
        and program.teacher_id == resource_account.id
        and program.is_template is True
        and program.is_active is True
    )


def _program_from_contents(assignment_id: int, db: Session) -> Optional[Program]:
    """Find the program behind an assignment's contents.

    Dispatch copies each Content (`is_assignment_copy=True`) but keeps its
    `program_id` / `lesson_id`, so the copy still points at the original
    program.
    """
    rows = (
        db.query(Content.program_id, Content.lesson_id)
        .join(AssignmentContent, AssignmentContent.content_id == Content.id)
        .filter(AssignmentContent.assignment_id == assignment_id)
        .order_by(AssignmentContent.id)
        .all()
    )

    for program_id, lesson_id in rows:
        if not program_id and lesson_id:
            program_id = (
                db.query(Lesson.program_id).filter(Lesson.id == lesson_id).scalar()
            )
        if program_id:
            program = db.query(Program).filter(Program.id == program_id).first()
            if program:
                return program
    return None


def _walk_up_to_resource_template(
    program: Program, resource_account, db: Session
) -> Optional[Program]:
    """Follow `source_metadata` upwards looking for the resource template.

    Covers demo assignments built on a classroom copy of a resource pack rather
    than on the pack itself.
    """
    seen = {program.id}
    current = program

    for _ in range(_MAX_SOURCE_HOPS):
        metadata = current.source_metadata or {}
        source_id = metadata.get("template_id") or metadata.get("program_id")
        if not source_id or source_id in seen:
            return None

        seen.add(source_id)
        current = db.query(Program).filter(Program.id == source_id).first()
        if not current:
            return None
        if _is_resource_template(current, resource_account):
            return current

    return None


def resolve_demo_resource_program(assignment, db: Session) -> Optional[Program]:
    """Resolve the resource-pack program a demo assignment was built from.

    Returns None when nothing suitable is found — the expired screen then drops
    its "copy this material" promise instead of offering a call that would fail.
    """
    assignment_id = assignment.id
    resource_account = get_resource_account(db)
    if not resource_account:
        logger.info("Demo resource program: no resource account configured")
        return None

    # 1. Explicit override in demo_config.
    key = RESOURCE_PROGRAM_KEY_TEMPLATE.format(assignment_id=assignment_id)
    mapped = db.query(DemoConfig).filter(DemoConfig.key == key).first()
    if mapped and str(mapped.value).isdigit():
        program = db.query(Program).filter(Program.id == int(mapped.value)).first()
        if _is_resource_template(program, resource_account):
            return program
        logger.warning(
            "Demo resource program: %s points at program %s "
            "which is not a resource template",
            key,
            mapped.value,
        )

    # 2. Derive from the assignment's contents.
    program = _program_from_contents(assignment_id, db)
    if not program:
        logger.info(
            "Demo resource program: assignment %s has no content-linked program",
            assignment_id,
        )
        return None
    if _is_resource_template(program, resource_account):
        return program

    # 3. The linked program is a copy — walk up to the template it came from.
    upstream = _walk_up_to_resource_template(program, resource_account, db)
    if not upstream:
        logger.info(
            "Demo resource program: assignment %s resolved to program %s "
            "but no resource template upstream",
            assignment_id,
            program.id,
        )
    return upstream
