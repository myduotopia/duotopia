"""
1Campus account matching and creation service.

Handles:
- Finding existing Identity by one_campus_uuid, one_campus_student_id, or national_id_hash
- OAuth-based account matching (uuid + email fallback)
- Creating new Identity + Student/Teacher for first-time SSO users
- Detecting duplicate accounts for merge prompt
"""

import logging
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.user import Identity, Student, Teacher

logger = logging.getLogger(__name__)


class OneCampusAccountService:
    """Account matching and creation for 1Campus SSO."""

    @staticmethod
    def find_by_uuid(db: Session, uuid: str) -> Optional[Identity]:
        """Find Identity by 1Campus OAuth uuid (exact match)."""
        return (
            db.query(Identity)
            .filter(
                Identity.one_campus_uuid == uuid,
                Identity.is_active.is_(True),
            )
            .first()
        )

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

        # Step 2.5: Check if 1Campus account matches an existing verified email
        if one_campus_account:
            email_identity = (
                db.query(Identity)
                .filter(
                    func.lower(Identity.email) == one_campus_account.lower(),
                    Identity.email_verified.is_(True),
                    Identity.is_active.is_(True),
                )
                .first()
            )
            if email_identity:
                student = (
                    db.query(Student)
                    .filter(
                        Student.identity_id == email_identity.id,
                        Student.is_active.is_(True),
                    )
                    .order_by(Student.is_primary_account.desc().nulls_last())
                    .first()
                )
                if student:
                    # Only write 1Campus fields after confirming student exists
                    email_identity.one_campus_student_id = one_campus_student_id
                    email_identity.one_campus_account = one_campus_account
                    if national_id_hash:
                        email_identity.national_id_hash = national_id_hash
                    db.commit()
                    logger.info(
                        "1Campus SSO: auto-merged student by email match, "
                        "student_id=%s, identity_id=%s, email=%s",
                        student.id,
                        email_identity.id,
                        one_campus_account,
                    )
                    return email_identity, student, "existing"

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

        # Step 2.5: Check if 1Campus account matches an existing verified email
        if one_campus_account:
            email_identity = (
                db.query(Identity)
                .filter(
                    func.lower(Identity.email) == one_campus_account.lower(),
                    Identity.email_verified.is_(True),
                    Identity.is_active.is_(True),
                )
                .first()
            )
            if email_identity:
                teacher = (
                    db.query(Teacher)
                    .filter(
                        Teacher.identity_id == email_identity.id,
                        Teacher.is_active.is_(True),
                    )
                    .first()
                )
                if teacher:
                    # Only write 1Campus fields after confirming teacher exists
                    email_identity.one_campus_account = one_campus_account
                    if national_id_hash:
                        email_identity.national_id_hash = national_id_hash
                    db.commit()
                    logger.info(
                        "1Campus SSO: auto-merged teacher by email match, "
                        "teacher_id=%s, identity_id=%s, email=%s",
                        teacher.id,
                        email_identity.id,
                        one_campus_account,
                    )
                    return email_identity, teacher, "existing"

        # Step 3: Create new Identity + Teacher
        # Use the real 1Campus account email instead of a placeholder,
        # but only if no other Identity/Teacher already uses this email
        # (case-insensitive to align with the LOWER(email) unique indexes).
        account_lower = one_campus_account.lower()
        identity_email_taken = (
            db.query(Identity)
            .filter(
                func.lower(Identity.email) == account_lower,
                Identity.is_active.is_(True),
            )
            .first()
        ) is not None

        teacher_email_taken = (
            db.query(Teacher)
            .filter(
                func.lower(Teacher.email) == account_lower,
                Teacher.is_active.is_(True),
            )
            .first()
        ) is not None

        use_real_email = not identity_email_taken and not teacher_email_taken

        # Fallback to placeholder if email is already taken
        if not use_real_email:
            safe_account = one_campus_account.replace("@", "_at_")
            teacher_email = f"1campus_{safe_account}@sso.duotopia.com"
        else:
            teacher_email = one_campus_account

        identity = Identity(
            email=one_campus_account if not identity_email_taken else None,
            one_campus_account=one_campus_account,
            national_id_hash=national_id_hash,
            email_verified=False,
            is_active=True,
        )
        db.add(identity)
        db.flush()

        teacher = Teacher(
            name=teacher_name,
            email=teacher_email,
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

    @staticmethod
    def find_or_create_by_oauth(
        db: Session,
        uuid: str,
        mail: str,
        first_name: str,
        last_name: str,
        role_type: Optional[str] = None,
        one_campus_student_id: Optional[str] = None,
        student_name: Optional[str] = None,
        student_number: Optional[str] = None,
        teacher_name: Optional[str] = None,
        national_id_hash: Optional[str] = None,
    ) -> tuple:
        """Find or create account from OAuth user info.

        Matching priority:
        1. Exact match by one_campus_uuid
        2. Match by verified email
        3. Create new account

        When role_type is provided (from getUserRole), creates the
        appropriate student or teacher. Otherwise defaults to teacher.

        Returns: (identity, user, role_type, action)
        where action is "existing", "created"
        """
        # Step 1: Match by uuid
        identity = OneCampusAccountService.find_by_uuid(db, uuid)
        if identity:
            # Update email if changed
            if mail and identity.email != mail:
                identity.email = mail
            identity.one_campus_account = mail
            db.commit()

            # Try student first, then teacher
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
                logger.info(
                    "1Campus OAuth: existing student by uuid, "
                    "student_id=%s, identity_id=%s",
                    student.id,
                    identity.id,
                )
                return identity, student, "student", "existing"

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
                    "1Campus OAuth: existing teacher by uuid, "
                    "teacher_id=%s, identity_id=%s",
                    teacher.id,
                    identity.id,
                )
                return identity, teacher, "teacher", "existing"

            # Identity exists by uuid but has no active student or teacher.
            # Don't fall through to email match — that would create a second
            # identity for the same uuid (orphaning this one). Reuse it instead.
            logger.warning(
                "1Campus OAuth: identity_id=%s matched by uuid has no active "
                "user. Will create a new student/teacher under this identity.",
                identity.id,
            )
            existing_identity_for_uuid = identity
        else:
            existing_identity_for_uuid = None

        # Step 2: Match by verified email (case-insensitive)
        # Skip if we already found an Identity by uuid above — reuse that one
        # rather than creating a parallel email-matched identity.
        if mail and existing_identity_for_uuid is None:
            mail_lower = mail.lower()
            email_identity = (
                db.query(Identity)
                .filter(
                    func.lower(Identity.email) == mail_lower,
                    Identity.email_verified.is_(True),
                    Identity.is_active.is_(True),
                )
                .first()
            )
            if email_identity:
                # Link uuid to existing identity
                email_identity.one_campus_uuid = uuid
                email_identity.one_campus_account = mail
                if national_id_hash:
                    email_identity.national_id_hash = national_id_hash
                db.commit()

                # Try student first, then teacher
                student = (
                    db.query(Student)
                    .filter(
                        Student.identity_id == email_identity.id,
                        Student.is_active.is_(True),
                    )
                    .order_by(Student.is_primary_account.desc().nulls_last())
                    .first()
                )
                if student:
                    logger.info(
                        "1Campus OAuth: matched student by email, "
                        "student_id=%s, identity_id=%s, email=%s",
                        student.id,
                        email_identity.id,
                        mail,
                    )
                    return email_identity, student, "student", "existing"

                teacher = (
                    db.query(Teacher)
                    .filter(
                        Teacher.identity_id == email_identity.id,
                        Teacher.is_active.is_(True),
                    )
                    .first()
                )
                if teacher:
                    logger.info(
                        "1Campus OAuth: matched teacher by email, "
                        "teacher_id=%s, identity_id=%s, email=%s",
                        teacher.id,
                        email_identity.id,
                        mail,
                    )
                    return email_identity, teacher, "teacher", "existing"

        # Step 3: Create new account (or attach to identity matched by uuid above)
        # Determine role: use getUserRole result, default to teacher
        effective_role = role_type or "teacher"
        display_name = f"{last_name}{first_name}".strip() or mail

        if existing_identity_for_uuid is not None:
            # Reuse the identity already matched by uuid; just create the missing user.
            identity = existing_identity_for_uuid
        else:
            # Check email uniqueness for Identity (case-insensitive)
            identity_email_taken = (
                (
                    db.query(Identity)
                    .filter(
                        func.lower(Identity.email) == mail.lower(),
                        Identity.is_active.is_(True),
                    )
                    .first()
                )
                is not None
                if mail
                else False
            )

            identity = Identity(
                email=mail if not identity_email_taken else None,
                one_campus_uuid=uuid,
                one_campus_account=mail,
                one_campus_student_id=one_campus_student_id,
                national_id_hash=national_id_hash,
                # 1Campus is the IdP and verifies institutional emails on its side,
                # so we trust the returned mail as already verified.
                email_verified=bool(mail),
                is_active=True,
            )
            db.add(identity)
            db.flush()

        if effective_role == "student":
            name = student_name or display_name
            student = Student(
                name=name,
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
                "1Campus OAuth: created student_id=%s, identity_id=%s, uuid=%s",
                student.id,
                identity.id,
                uuid,
            )
            return identity, student, "student", "created"
        else:
            name = teacher_name or display_name
            # Check teacher email uniqueness (case-insensitive)
            teacher_email_taken = (
                (
                    db.query(Teacher)
                    .filter(
                        func.lower(Teacher.email) == mail.lower(),
                        Teacher.is_active.is_(True),
                    )
                    .first()
                )
                is not None
                if mail
                else False
            )

            if mail and not teacher_email_taken:
                teacher_email = mail
            elif mail:
                safe = mail.replace("@", "_at_")
                teacher_email = f"1campus_{safe}@sso.duotopia.com"
            else:
                teacher_email = f"1campus_{uuid}@sso.duotopia.com"

            teacher = Teacher(
                name=name,
                email=teacher_email,
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
                "1Campus OAuth: created teacher_id=%s, identity_id=%s, uuid=%s",
                teacher.id,
                identity.id,
                uuid,
            )
            return identity, teacher, "teacher", "created"
