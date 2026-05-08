"""
Tests for re-login redirect after merge.

When 1Campus uuid points to a merged Identity (merged_into_identity_id IS NOT NULL),
the login should resolve to the target Identity and return that user's token.

Covers:
- Login via 1Campus with uuid pointing to merged Identity → resolves to target
- Audit log line emitted for redirection
"""

import pytest
import logging
from datetime import datetime, timezone

from models.user import Identity, Student, Teacher
from services.one_campus_account_service import OneCampusAccountService


class TestReloginAfterMerge:
    """find_or_create_by_oauth with merged uuid should resolve to target's user."""

    def test_find_by_uuid_resolves_merged_teacher_identity_to_target(
        self, shared_test_session
    ):
        """UUID pointing to merged deactivated Identity → returns target teacher."""
        db = shared_test_session

        # Target identity A (the surviving one)
        identity_a = Identity(
            email="rl_survivor_a@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_a)
        db.flush()

        teacher_a = Teacher(
            name="RL Survivor Teacher A",
            email="rl_survivor_a@test.com",
            identity_id=identity_a.id,
            is_active=True,
        )
        db.add(teacher_a)
        db.flush()

        # Merged (deactivated) identity B with uuid — no email to avoid unique conflict
        identity_b = Identity(
            one_campus_uuid="rl-uuid-merged-b-teacher",
            one_campus_account="rl_merged_b@1campus.net",
            email_verified=False,
            is_active=False,  # deactivated by merge
        )
        db.add(identity_b)
        db.flush()

        # Set merge marker: B → A
        identity_b.merged_into_identity_id = identity_a.id
        identity_b.merged_at = datetime.now(timezone.utc)
        db.commit()

        # Simulate find_or_create_by_oauth with uuid that points to merged B
        (
            identity,
            user,
            role_type,
            action,
        ) = OneCampusAccountService.find_or_create_by_oauth(
            db=db,
            uuid="rl-uuid-merged-b-teacher",
            mail="rl_merged_b@1campus.net",
            first_name="Merged",
            last_name="B",
            role_type="teacher",
            teacher_name="Teacher B",
        )

        # Should return target A's identity and teacher
        assert identity.id == identity_a.id
        assert user.id == teacher_a.id
        assert action in ("existing", "merge_redirect")

    def test_find_by_uuid_resolves_merged_student_identity_to_target(
        self, shared_test_session
    ):
        """Merged student uuid → resolves to target student."""
        db = shared_test_session

        identity_a = Identity(
            email="rl_survivor_student_a@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_a)
        db.flush()

        student_a = Student(
            name="RL Survivor Student A",
            email="rl_survivor_student_a@test.com",
            identity_id=identity_a.id,
            is_active=True,
            is_primary_account=True,
        )
        db.add(student_a)
        db.flush()

        identity_b = Identity(
            one_campus_uuid="rl-uuid-merged-student-b",
            one_campus_account="rl_merged_student_b@1campus.net",
            email_verified=False,
            is_active=False,
        )
        db.add(identity_b)
        db.flush()

        identity_b.merged_into_identity_id = identity_a.id
        identity_b.merged_at = datetime.now(timezone.utc)
        db.commit()

        (
            identity,
            user,
            role_type,
            action,
        ) = OneCampusAccountService.find_or_create_by_oauth(
            db=db,
            uuid="rl-uuid-merged-student-b",
            mail="rl_merged_student_b@1campus.net",
            first_name="Student",
            last_name="B",
            role_type="student",
            student_name="Student B",
        )

        assert identity.id == identity_a.id
        assert user.id == student_a.id
        assert role_type == "student"

    def test_audit_log_emitted_for_merge_redirect(self, shared_test_session, caplog):
        """Redirect from merged Identity logs a clear audit message."""
        db = shared_test_session

        identity_a = Identity(
            email="rl_auditlog_a@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_a)
        db.flush()

        teacher_a = Teacher(
            name="RL Audit Teacher A",
            email="rl_auditlog_a@test.com",
            identity_id=identity_a.id,
            is_active=True,
        )
        db.add(teacher_a)
        db.flush()

        identity_b = Identity(
            one_campus_uuid="rl-uuid-auditlog-b",
            one_campus_account="rl_auditlog_b@1campus.net",
            email_verified=False,
            is_active=False,
        )
        db.add(identity_b)
        db.flush()

        identity_b.merged_into_identity_id = identity_a.id
        identity_b.merged_at = datetime.now(timezone.utc)
        db.commit()

        with caplog.at_level(
            logging.INFO, logger="services.one_campus_account_service"
        ):
            OneCampusAccountService.find_or_create_by_oauth(
                db=db,
                uuid="rl-uuid-auditlog-b",
                mail="rl_auditlog_b@1campus.net",
                first_name="B",
                last_name="Audit",
                role_type="teacher",
                teacher_name="RL Audit Teacher B",
            )

        # At least one log line should mention the redirect / merge
        log_text = " ".join(caplog.messages)
        assert any(
            keyword in log_text.lower()
            for keyword in ["merge", "redirect", "merged", "resolv"]
        )

    def test_non_merged_uuid_not_affected(self, shared_test_session):
        """UUID pointing to active non-merged identity works as before."""
        db = shared_test_session

        identity_normal = Identity(
            email="rl_normal@test.com",
            one_campus_uuid="rl-uuid-normal-active",
            one_campus_account="rl_normal@1campus.net",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_normal)
        db.flush()

        teacher_normal = Teacher(
            name="RL Normal Teacher",
            email="rl_normal@test.com",
            identity_id=identity_normal.id,
            is_active=True,
        )
        db.add(teacher_normal)
        db.commit()

        (
            identity,
            user,
            role_type,
            action,
        ) = OneCampusAccountService.find_or_create_by_oauth(
            db=db,
            uuid="rl-uuid-normal-active",
            mail="rl_normal@1campus.net",
            first_name="Normal",
            last_name="Teacher",
            role_type="teacher",
        )

        # Should return the same identity and teacher (not redirected)
        assert identity.id == identity_normal.id
        assert user.id == teacher_normal.id
        assert action == "existing"
