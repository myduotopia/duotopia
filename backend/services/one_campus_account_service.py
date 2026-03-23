"""
1Campus account matching and creation service.

Handles:
- Finding existing Identity by one_campus_student_id or national_id_hash
- Creating new Identity + Student for first-time SSO users
- Detecting duplicate accounts for merge prompt
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from models.user import Identity, Student

logger = logging.getLogger(__name__)


class OneCampusAccountService:
    """Account matching and creation for 1Campus SSO."""

    @staticmethod
    def find_by_one_campus_id(
        db: Session, one_campus_student_id: str
    ) -> Optional[Identity]:
        """Find Identity by 1Campus studentID (exact match)."""
        return (
            db.query(Identity)
            .filter(
                Identity.one_campus_student_id == one_campus_student_id,
                Identity.is_active.is_(True),
            )
            .first()
        )

    @staticmethod
    def find_by_national_id_hash(
        db: Session, national_id_hash: str
    ) -> Optional[Identity]:
        """Find Identity by national ID hash (cross-school match)."""
        return (
            db.query(Identity)
            .filter(
                Identity.national_id_hash == national_id_hash,
                Identity.is_active.is_(True),
            )
            .first()
        )

    @staticmethod
    def find_or_create_student(
        db: Session,
        one_campus_student_id: str,
        one_campus_account: str,
        student_name: str,
        student_number: Optional[str] = None,
        national_id_hash: Optional[str] = None,
        school_dsns: Optional[str] = None,
    ) -> tuple:
        """Find existing or create new Identity + Student.

        Returns: (identity, student, action)
        where action is one of:
        - "existing": Returning user, logged in directly
        - "created": New account created
        - "merge_prompt": Found potential duplicate via national_id_hash
        """
        # Step 1: Exact match by one_campus_student_id
        identity = OneCampusAccountService.find_by_one_campus_id(
            db, one_campus_student_id
        )
        if identity:
            student = (
                db.query(Student)
                .filter(
                    Student.identity_id == identity.id,
                    Student.is_active.is_(True),
                )
                .order_by(Student.is_primary_account.desc().nulls_last())
                .first()
            )
            if student:
                # Update account info in case it changed
                identity.one_campus_account = one_campus_account
                db.commit()
                logger.info(
                    "1Campus SSO: existing user student_id=%s, identity_id=%s",
                    student.id,
                    identity.id,
                )
                return identity, student, "existing"

        # Step 2: Check national_id_hash for potential duplicate
        if national_id_hash:
            existing_identity = OneCampusAccountService.find_by_national_id_hash(
                db, national_id_hash
            )
            if existing_identity and (
                existing_identity.one_campus_student_id != one_campus_student_id
            ):
                # Different 1Campus ID but same national ID → merge prompt
                student = (
                    db.query(Student)
                    .filter(
                        Student.identity_id == existing_identity.id,
                        Student.is_active.is_(True),
                    )
                    .order_by(Student.is_primary_account.desc().nulls_last())
                    .first()
                )
                logger.info(
                    "1Campus SSO: merge prompt for national_id_hash, "
                    "existing_identity=%s, new_1campus_id=%s",
                    existing_identity.id,
                    one_campus_student_id,
                )
                return existing_identity, student, "merge_prompt"

        # Step 3: Create new Identity + Student
        identity = Identity(
            one_campus_student_id=one_campus_student_id,
            one_campus_account=one_campus_account,
            national_id_hash=national_id_hash,
            email_verified=False,
            is_active=True,
        )
        db.add(identity)
        db.flush()  # Get identity.id

        # SSO-only accounts: no password set (has_password=False)
        student = Student(
            name=student_name,
            student_number=student_number,
            password_hash=None,
            has_password=False,
            identity_id=identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(student)
        db.commit()
        db.refresh(identity)
        db.refresh(student)

        logger.info(
            "1Campus SSO: created new student_id=%s, identity_id=%s, " "1campus_id=%s",
            student.id,
            identity.id,
            one_campus_student_id,
        )
        return identity, student, "created"

    @staticmethod
    def merge_accounts(
        db: Session,
        target_identity_id: int,
        one_campus_student_id: str,
        one_campus_account: str,
    ) -> tuple:
        """Link 1Campus fields to an existing identity.

        The target identity is the existing account matched by national_id_hash.
        We add the 1Campus student ID and account to it.
        Returns: (target_identity, primary_student)
        """
        target = db.get(Identity, target_identity_id)

        if not target:
            raise ValueError("Target identity not found")

        # Update target with 1Campus fields
        target.one_campus_student_id = one_campus_student_id
        target.one_campus_account = one_campus_account

        db.commit()

        # Find primary student under target
        primary_student = (
            db.query(Student)
            .filter(
                Student.identity_id == target.id,
                Student.is_active.is_(True),
            )
            .order_by(Student.is_primary_account.desc().nulls_last())
            .first()
        )

        logger.info(
            "1Campus SSO: merged 1campus_id=%s into identity_id=%s",
            one_campus_student_id,
            target_identity_id,
        )
        return target, primary_student
