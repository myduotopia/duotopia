"""
Tests for Identity merge marker functionality.

Covers:
- mark_identity_merged sets merged_into_identity_id, merged_at, is_active=False
- Transfers 1Campus fields from source to target
- Deactivates Teacher/Student under source
- Idempotency (calling twice is a no-op)
- Target with existing 1Campus fields is not overwritten
"""

import pytest
from datetime import datetime, timezone

from models.user import Identity, Student, Teacher
from services.one_campus_account_service import OneCampusAccountService
from auth import get_password_hash


class TestMarkIdentityMerged:
    """OneCampusAccountService.mark_identity_merged behavior."""

    def test_sets_merged_into_identity_id(self, shared_test_session):
        """mark_identity_merged sets merged_into_identity_id on source."""
        db = shared_test_session

        source = Identity(email="source@test.com", email_verified=True, is_active=True)
        target = Identity(email="target@test.com", email_verified=True, is_active=True)
        db.add(source)
        db.add(target)
        db.flush()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        db.refresh(source)

        assert source.merged_into_identity_id == target.id
        assert source.merged_at is not None
        assert isinstance(source.merged_at, datetime)

    def test_sets_source_inactive(self, shared_test_session):
        """mark_identity_merged deactivates source Identity."""
        db = shared_test_session

        source = Identity(email="src2@test.com", email_verified=True, is_active=True)
        target = Identity(email="tgt2@test.com", email_verified=True, is_active=True)
        db.add(source)
        db.add(target)
        db.flush()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        db.refresh(source)

        assert source.is_active is False

    def test_transfers_one_campus_fields_from_source_to_target(self, shared_test_session):
        """mark_identity_merged moves 1Campus fields to target when target has none."""
        db = shared_test_session

        source = Identity(
            email="src3@test.com",
            email_verified=True,
            is_active=True,
            one_campus_uuid="uuid-src3",
            one_campus_account="src3@1campus.net",
            one_campus_student_id="S003",
            national_id_hash="a" * 64,
        )
        target = Identity(email="tgt3@test.com", email_verified=True, is_active=True)
        db.add(source)
        db.add(target)
        db.flush()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        db.refresh(target)

        assert target.one_campus_uuid == "uuid-src3"
        assert target.one_campus_account == "src3@1campus.net"
        assert target.one_campus_student_id == "S003"
        assert target.national_id_hash == "a" * 64

    def test_does_not_overwrite_existing_one_campus_fields_on_target(self, shared_test_session):
        """Target with existing 1Campus fields retains them (not overwritten)."""
        db = shared_test_session

        source = Identity(
            email="src4@test.com",
            email_verified=True,
            is_active=True,
            one_campus_uuid="uuid-src4",
            one_campus_account="src4@1campus.net",
        )
        target = Identity(
            email="tgt4@test.com",
            email_verified=True,
            is_active=True,
            one_campus_uuid="uuid-tgt4-existing",
            one_campus_account="tgt4@1campus.net",
        )
        db.add(source)
        db.add(target)
        db.flush()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        db.refresh(target)

        # Target keeps its own 1Campus fields
        assert target.one_campus_uuid == "uuid-tgt4-existing"
        assert target.one_campus_account == "tgt4@1campus.net"

    def test_deactivates_teacher_under_source(self, shared_test_session):
        """mark_identity_merged sets is_active=False on Teacher(s) under source."""
        db = shared_test_session

        source = Identity(email="src5@test.com", email_verified=True, is_active=True)
        target = Identity(email="tgt5@test.com", email_verified=True, is_active=True)
        db.add(source)
        db.add(target)
        db.flush()

        teacher = Teacher(
            name="Source Teacher",
            email="src5@test.com",
            password_hash=get_password_hash("pass"),
            identity_id=source.id,
            is_active=True,
        )
        db.add(teacher)
        db.commit()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        db.refresh(teacher)

        assert teacher.is_active is False

    def test_deactivates_student_under_source(self, shared_test_session):
        """mark_identity_merged sets is_active=False on Student(s) under source."""
        db = shared_test_session

        source = Identity(email="src6@test.com", email_verified=True, is_active=True)
        target = Identity(email="tgt6@test.com", email_verified=True, is_active=True)
        db.add(source)
        db.add(target)
        db.flush()

        student = Student(
            name="Source Student",
            identity_id=source.id,
            is_active=True,
            is_primary_account=True,
        )
        db.add(student)
        db.commit()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        db.refresh(student)

        assert student.is_active is False

    def test_idempotent_calling_twice_is_noop(self, shared_test_session):
        """Calling mark_identity_merged twice does not raise and result is same."""
        db = shared_test_session

        source = Identity(email="src7@test.com", email_verified=True, is_active=True)
        target = Identity(email="tgt7@test.com", email_verified=True, is_active=True)
        db.add(source)
        db.add(target)
        db.flush()

        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        first_merged_at = db.get(Identity, source.id).merged_at

        # Call again — should be a no-op without error
        OneCampusAccountService.mark_identity_merged(db, source.id, target.id)
        db.commit()
        second_merged_at = db.get(Identity, source.id).merged_at

        # merged_at should remain the same (not updated on repeated call)
        assert db.get(Identity, source.id).merged_into_identity_id == target.id
        assert second_merged_at == first_merged_at
