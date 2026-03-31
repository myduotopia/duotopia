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

from models.user import Identity, Student, Teacher

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

        # SSO-only accounts: no password set (password_hash=None)
        student = Student(
            name=student_name,
            student_number=student_number,
            password_hash=None,
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

    @staticmethod
    def find_or_create_teacher(
        db: Session,
        one_campus_account: str,
        teacher_name: str,
        national_id_hash: Optional[str] = None,
        school_dsns: Optional[str] = None,
    ) -> tuple:
        """Find existing or create new Identity + Teacher for 1Campus SSO.

        Matching strategy:
        1. Exact match by one_campus_account on Identity
        2. Match by national_id_hash (cross-school)
        3. Create new Identity + Teacher

        Returns: (identity, teacher, action)
        where action is "existing", "created"
        """
        # Step 1: Find Identity by one_campus_account
        identity = (
            db.query(Identity)
            .filter(
                Identity.one_campus_account == one_campus_account,
                Identity.is_active.is_(True),
            )
            .first()
        )
        if identity:
            teacher = (
                db.query(Teacher)
                .filter(
                    Teacher.identity_id == identity.id,
                    Teacher.is_active.is_(True),
                )
                .first()
            )
            if teacher:
                logger.info(
                    "1Campus SSO: existing teacher_id=%s, identity_id=%s",
                    teacher.id,
                    identity.id,
                )
                return identity, teacher, "existing"

        # Step 2: Check national_id_hash for cross-school match.
        # Unlike students, teachers don't get a merge_prompt — we silently link
        # the 1Campus account to the existing identity. Teachers are unique
        # individuals (not multi-school students with separate accounts), so
        # a national_id_hash match is a reliable identity signal.
        if national_id_hash:
            existing_identity = OneCampusAccountService.find_by_national_id_hash(
                db, national_id_hash
            )
            if existing_identity:
                # Check if this identity has a linked teacher
                teacher = (
                    db.query(Teacher)
                    .filter(
                        Teacher.identity_id == existing_identity.id,
                        Teacher.is_active.is_(True),
                    )
                    .first()
                )
                if teacher:
                    # Link 1Campus account to existing identity
                    existing_identity.one_campus_account = one_campus_account
                    db.commit()
                    logger.info(
                        "1Campus SSO: matched teacher by national_id_hash, "
                        "teacher_id=%s, identity_id=%s",
                        teacher.id,
                        existing_identity.id,
                    )
                    return existing_identity, teacher, "existing"

        # Step 3: Create new Identity + Teacher
        identity = Identity(
            one_campus_account=one_campus_account,
            national_id_hash=national_id_hash,
            email_verified=False,
            is_active=True,
        )
        db.add(identity)
        db.flush()

        # Generate a placeholder email for Teacher (required NOT NULL)
        # one_campus_account may contain '@' (e.g. user@1campus.net),
        # so replace it to form a valid email address.
        safe_account = one_campus_account.replace("@", "_at_")
        placeholder_email = f"1campus_{safe_account}@sso.duotopia.com"

        teacher = Teacher(
            name=teacher_name,
            email=placeholder_email,
            password_hash=None,
            has_password=False,
            identity_id=identity.id,
            is_active=True,
        )
        db.add(teacher)
        db.commit()
        db.refresh(identity)
        db.refresh(teacher)

        logger.info(
            "1Campus SSO: created new teacher_id=%s, identity_id=%s, account=%s",
            teacher.id,
            identity.id,
            one_campus_account,
        )
        return identity, teacher, "created"
