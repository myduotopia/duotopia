"""Issue #730: Identity.one_campus_student_id must be unique so two concurrent
1Campus syncs (manual + login) can't insert duplicate identities for the same
student; _upsert_student recovers from the unique-constraint conflict by
re-reading (and reactivating) the existing row.
"""

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.user import Identity
from services.one_campus_class_sync_service import _upsert_student


def _stu(sid: str, name: str = "Amy", number: str = "7") -> dict:
    return {"studentID": sid, "studentName": name, "studentNumber": number}


class TestIdentityOneCampusStudentIdUnique:
    def test_duplicate_id_rejected_at_db(self, db_session: Session):
        db_session.add(
            Identity(one_campus_student_id="X1", is_active=True, email_verified=False)
        )
        db_session.commit()
        db_session.add(
            Identity(one_campus_student_id="X1", is_active=True, email_verified=False)
        )
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()

    def test_null_id_allows_multiple(self, db_session: Session):
        # The unique index is partial (WHERE one_campus_student_id IS NOT NULL),
        # so students without a 1Campus id are unaffected.
        db_session.add(
            Identity(one_campus_student_id=None, is_active=True, email_verified=False)
        )
        db_session.add(
            Identity(one_campus_student_id=None, is_active=True, email_verified=False)
        )
        db_session.flush()  # must not raise
        db_session.rollback()

    def test_upsert_is_idempotent(self, db_session: Session):
        s1, created1, _ = _upsert_student(db_session, _stu("2001", "Bob"))
        db_session.commit()
        s2, created2, _ = _upsert_student(db_session, _stu("2001", "Bob"))
        db_session.commit()

        assert created1 is True
        assert created2 is False
        assert s1.id == s2.id
        idents = (
            db_session.query(Identity)
            .filter(Identity.one_campus_student_id == "2001")
            .all()
        )
        assert len(idents) == 1

    def test_upsert_recovers_from_conflict_without_duplicate(self, db_session: Session):
        # First sync creates an active identity + student.
        _upsert_student(db_session, _stu("3001", "Cindy"))
        db_session.commit()

        # Soft-delete the identity so the next upsert's is_active lookup MISSES
        # and takes the INSERT path -> the new active insert collides with the
        # existing (now inactive) row on the unique index. This deterministically
        # exercises the same IntegrityError -> re-read -> reuse path a concurrent
        # sync would hit.
        ident = (
            db_session.query(Identity)
            .filter(Identity.one_campus_student_id == "3001")
            .one()
        )
        ident.is_active = False
        db_session.commit()

        student, created, _ = _upsert_student(db_session, _stu("3001", "Cindy"))
        db_session.commit()

        idents = (
            db_session.query(Identity)
            .filter(Identity.one_campus_student_id == "3001")
            .all()
        )
        assert len(idents) == 1  # no duplicate identity
        assert idents[0].is_active is True  # reused + reactivated
        assert created is False
