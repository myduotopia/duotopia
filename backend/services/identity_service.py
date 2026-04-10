"""Identity Service - 統一身分管理核心服務

處理 Identity 的建立、帳號關聯、密碼統一等邏輯。
支援老師和學生的統一身分管理。
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from models.user import Student, Teacher, Identity

logger = logging.getLogger(__name__)


class IdentityService:
    """統一身分管理服務"""

    def ensure_identity_on_email_bind(
        self, db: Session, student: Student, email: str
    ) -> Optional[Identity]:
        """學生綁定 email 時，建立或關聯 Identity（未驗證狀態）

        - 若已有相同 email 的 Identity → 關聯到該 Identity
        - 若沒有 → 建立新 Identity（email_verified=False）
        - 若 email 改變 → 解除舊 Identity，建立/關聯新 Identity

        Args:
            db: 資料庫 session
            student: 學生
            email: 要綁定的 email

        Returns:
            Identity 或 None（若失敗）
        """
        if not email or "@duotopia.local" in email:
            return None

        # 如果 email 沒變且已有 Identity，不重複處理
        if student.identity_id and student.identity:
            if student.identity.email == email:
                return student.identity

            # email 改變了，解除舊 Identity 關聯
            self._unlink_student_from_identity(db, student)

        try:
            nested = db.begin_nested()

            existing_identity = (
                db.query(Identity)
                .filter(
                    Identity.email == email,
                    Identity.is_active.is_(True),
                )
                .first()
            )

            if existing_identity:
                result = self._link_student_to_identity(db, student, existing_identity)
            else:
                result = self._create_identity_for_student(
                    db, student, email, verified=False
                )

            nested.commit()
            return result

        except Exception as e:
            logger.error(f"Failed to ensure identity for student {student.id}: {e}")
            nested.rollback()
            return None

    def on_email_verified(self, db: Session, student: Student) -> Optional[Identity]:
        """Email 驗證成功時更新 Identity 狀態

        - 若已有 Identity → 更新 email_verified=True + 密碼遷移
        - 若沒有 Identity（不應發生）→ 建立一個

        Args:
            db: 資料庫 session
            student: 剛驗證完 email 的學生

        Returns:
            Identity 或 None（若失敗）
        """
        if not student.email or not student.email_verified:
            logger.warning(f"Student {student.id} has no verified email, skip")
            return None

        try:
            nested = db.begin_nested()

            if student.identity_id:
                identity = (
                    db.query(Identity)
                    .filter(Identity.id == student.identity_id)
                    .first()
                )
                if identity:
                    # 更新驗證狀態
                    if not identity.email_verified:
                        identity.email_verified = True
                        identity.email_verified_at = datetime.now(timezone.utc)

                    # 遷移密碼到 Identity
                    self._smart_password_merge(student, identity)
                    student.password_migrated_to_identity = True
                    db.flush()

                    nested.commit()
                    logger.info(
                        f"Email verified for identity {identity.id} "
                        f"(student {student.id})"
                    )
                    return identity

            # 沒有 Identity（不應發生，但做防禦處理）
            logger.warning(
                f"Student {student.id} verified but has no identity, creating"
            )
            result = self._create_identity_for_student(
                db, student, student.email, verified=True
            )
            nested.commit()
            return result

        except Exception as e:
            logger.error(
                f"Failed to update identity on verification "
                f"for student {student.id}: {e}"
            )
            nested.rollback()
            return None

    def get_or_create_identity_for_teacher(
        self, db: Session, teacher: Teacher
    ) -> Optional[Identity]:
        """為老師取得或建立 Identity

        Args:
            db: 資料庫 session
            teacher: 老師

        Returns:
            Identity 或 None（若失敗）
        """
        if teacher.identity_id:
            return teacher.identity

        try:
            nested = db.begin_nested()

            existing_identity = (
                db.query(Identity)
                .filter(
                    Identity.email == teacher.email,
                    Identity.is_active.is_(True),
                )
                .first()
            )

            if existing_identity:
                teacher.identity_id = existing_identity.id
                db.flush()
                logger.info(
                    f"Linked teacher {teacher.id} to existing identity {existing_identity.id}"
                )
                nested.commit()
                return existing_identity
            else:
                identity = Identity(
                    email=teacher.email,
                    password_hash=teacher.password_hash,
                    email_verified=teacher.email_verified or False,
                    email_verified_at=teacher.email_verified_at,
                    password_changed=True,
                )
                db.add(identity)
                db.flush()

                teacher.identity_id = identity.id
                db.flush()
                logger.info(
                    f"Created new identity {identity.id} for teacher {teacher.id}"
                )
                nested.commit()
                return identity

        except Exception as e:
            logger.error(f"Failed to create identity for teacher {teacher.id}: {e}")
            nested.rollback()
            return None

    def _create_identity_for_student(
        self, db: Session, student: Student, email: str, verified: bool
    ) -> Identity:
        """建立新的 Identity 並關聯到 Student"""
        identity = Identity(
            email=email,
            password_hash=student.password_hash,
            email_verified=verified,
            email_verified_at=(student.email_verified_at if verified else None),
            password_changed=student.password_changed if verified else False,
            last_password_change=(
                datetime.now(timezone.utc)
                if verified and student.password_changed
                else None
            ),
        )
        db.add(identity)
        db.flush()

        student.identity_id = identity.id
        student.is_primary_account = True
        student.password_migrated_to_identity = verified

        db.flush()
        logger.info(
            f"Created identity {identity.id} for student {student.id} "
            f"({email}, verified={verified})"
        )
        return identity

    def _link_student_to_identity(
        self, db: Session, student: Student, identity: Identity
    ) -> Identity:
        """將 Student 關聯到既有的 Identity（不做密碼遷移，等驗證後再處理）"""
        student.identity_id = identity.id
        # 如果 Identity 還沒有其他 primary，設為 primary
        has_primary = (
            db.query(Student)
            .filter(
                Student.identity_id == identity.id,
                Student.is_primary_account.is_(True),
                Student.is_active.is_(True),
            )
            .first()
        )
        student.is_primary_account = has_primary is None
        student.password_migrated_to_identity = False

        db.flush()
        logger.info(
            f"Linked student {student.id} to identity {identity.id} "
            f"({identity.email})"
        )
        return identity

    def _unlink_student_from_identity(self, db: Session, student: Student) -> None:
        """解除 Student 與 Identity 的關聯"""
        old_identity_id = student.identity_id

        # 如果是 primary，轉移給其他人
        if student.is_primary_account:
            other = (
                db.query(Student)
                .filter(
                    Student.identity_id == student.identity_id,
                    Student.id != student.id,
                    Student.is_active.is_(True),
                )
                .first()
            )
            if other:
                other.is_primary_account = True

        student.identity_id = None
        student.is_primary_account = None
        student.password_migrated_to_identity = False
        db.flush()
        logger.info(f"Unlinked student {student.id} from identity {old_identity_id}")

    def _smart_password_merge(self, student: Student, identity: Identity) -> None:
        """智慧密碼選擇策略

        1. Identity 已有自定義密碼 -> 保持不變
        2. Identity 是預設密碼，Student 有自定義 -> 採用 Student 的
        3. 都是預設密碼 -> 保持 Identity 的
        4. 都有自定義密碼 -> 保持 Identity 的（已存在較久）
        """
        if identity.password_changed and not student.password_changed:
            return

        if not identity.password_changed and student.password_changed:
            identity.password_hash = student.password_hash
            identity.password_changed = True
            identity.last_password_change = datetime.now(timezone.utc)
            logger.info(
                f"Adopted student {student.id}'s custom password for identity {identity.id}"
            )
            return

        # 都有自定義密碼 or 都是預設密碼 -> 保持 Identity 的
        return

    def bind_1campus_identity_to_email(
        self,
        db: Session,
        sso_identity: Identity,
        target_email: str,
        user_type: str = "student",
    ) -> Identity:
        """Bind an SSO-only 1Campus Identity to an existing email-based Identity.

        Called after email verification succeeds for a 1Campus user who
        manually entered their Duotopia email.

        Two scenarios:
        1. target_email has an existing active Identity → migrate 1Campus fields
           to that Identity, move linked users, deactivate the SSO Identity.
        2. target_email has no Identity → set the email on the SSO Identity directly.

        Returns the surviving Identity.
        """
        # Look for an existing Identity with the target email
        email_identity = (
            db.query(Identity)
            .filter(
                Identity.email == target_email,
                Identity.is_active.is_(True),
                Identity.id != sso_identity.id,
            )
            .first()
        )

        if email_identity:
            # Scenario 1: Merge SSO fields into the email Identity
            email_identity.one_campus_student_id = sso_identity.one_campus_student_id
            email_identity.one_campus_account = sso_identity.one_campus_account
            if sso_identity.national_id_hash:
                email_identity.national_id_hash = sso_identity.national_id_hash

            # Smart password merge
            self._smart_password_merge_identity(sso_identity, email_identity)

            # Migrate linked users from SSO Identity to email Identity
            if user_type == "student":
                students = (
                    db.query(Student)
                    .filter(
                        Student.identity_id == sso_identity.id,
                        Student.is_active.is_(True),
                    )
                    .all()
                )
                for s in students:
                    s.identity_id = email_identity.id
                    # Don't override existing primary
                    has_primary = (
                        db.query(Student)
                        .filter(
                            Student.identity_id == email_identity.id,
                            Student.is_primary_account.is_(True),
                            Student.is_active.is_(True),
                            Student.id != s.id,
                        )
                        .first()
                    )
                    if has_primary:
                        s.is_primary_account = False
            else:
                teachers = (
                    db.query(Teacher)
                    .filter(
                        Teacher.identity_id == sso_identity.id,
                        Teacher.is_active.is_(True),
                    )
                    .all()
                )
                for t in teachers:
                    t.identity_id = email_identity.id
                    # Only update email if it won't violate uniqueness
                    existing_teacher_with_email = (
                        db.query(Teacher)
                        .filter(
                            Teacher.email == target_email,
                            Teacher.id != t.id,
                            Teacher.is_active.is_(True),
                        )
                        .first()
                    )
                    if not existing_teacher_with_email:
                        t.email = target_email

            # Deactivate the SSO-only Identity
            sso_identity.is_active = False
            db.flush()

            logger.info(
                "1Campus bind: merged sso_identity=%s into email_identity=%s "
                "(email=%s, type=%s)",
                sso_identity.id,
                email_identity.id,
                target_email,
                user_type,
            )
            return email_identity

        else:
            # Scenario 2: No existing email Identity → set email on SSO Identity
            sso_identity.email = target_email
            db.flush()

            logger.info(
                "1Campus bind: set email=%s on sso_identity=%s (type=%s)",
                target_email,
                sso_identity.id,
                user_type,
            )
            return sso_identity

    def _smart_password_merge_identity(
        self, source: Identity, target: Identity
    ) -> None:
        """Merge password from source Identity into target Identity.

        Same strategy as _smart_password_merge but between two Identities.
        """
        if target.password_changed:
            return
        if source.password_changed and not target.password_changed:
            target.password_hash = source.password_hash
            target.password_changed = True
            target.last_password_change = datetime.now(timezone.utc)
            logger.info(
                "Adopted sso identity %s password for target identity %s",
                source.id,
                target.id,
            )

    def get_linked_students(self, db: Session, identity_id: int) -> list[Student]:
        """取得 Identity 下所有關聯的 Student 帳號"""
        return (
            db.query(Student)
            .filter(
                Student.identity_id == identity_id,
                Student.is_active.is_(True),
            )
            .all()
        )

    def get_identity_by_student(
        self, db: Session, student_id: int
    ) -> Optional[Identity]:
        """透過 Student ID 取得對應的 Identity"""
        student = db.query(Student).filter(Student.id == student_id).first()
        if not student or not student.identity_id:
            return None
        return db.query(Identity).filter(Identity.id == student.identity_id).first()

    def update_unified_password(
        self,
        db: Session,
        identity: Identity,
        new_password_hash: str,
    ) -> None:
        """更新統一密碼（所有關聯帳號共用）"""
        identity.password_hash = new_password_hash
        identity.password_changed = True
        identity.last_password_change = datetime.now(timezone.utc)
        db.flush()
        logger.info(f"Updated unified password for identity {identity.id}")


# Singleton
identity_service = IdentityService()
