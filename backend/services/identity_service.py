"""Identity Service - 統一身分管理核心服務

處理 Identity 的建立、帳號關聯、密碼統一等邏輯。
支援老師和學生的統一身分管理。
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from models.user import Student, Teacher, Identity

logger = logging.getLogger(__name__)


class IdentityService:
    """統一身分管理服務"""

    def consolidate_on_email_verification(
        self, db: Session, student: Student
    ) -> Optional[Identity]:
        """Email 驗證成功時觸發學生身分整合

        1. 檢查是否已有相同 email 的 Identity
        2. 若有 -> 將此 Student 加入既有 Identity
        3. 若無 -> 建立新 Identity

        Args:
            db: 資料庫 session
            student: 剛驗證完 email 的學生

        Returns:
            Identity 或 None（若失敗）
        """
        if not student.email or not student.email_verified:
            logger.warning(
                f"Student {student.id} has no verified email, skip consolidation"
            )
            return None

        # 如果已經整合過，不重複處理
        if student.identity_id is not None:
            logger.info(
                f"Student {student.id} already consolidated to identity {student.identity_id}"
            )
            return student.identity

        try:
            # 查找是否已有相同 email 的 Identity
            existing_identity = (
                db.query(Identity)
                .filter(
                    Identity.email == student.email,
                    Identity.is_active.is_(True),
                )
                .first()
            )

            if existing_identity:
                return self._merge_student_into_identity(db, student, existing_identity)
            else:
                return self._create_identity_for_student(db, student)

        except Exception as e:
            logger.error(f"Failed to consolidate student {student.id}: {e}")
            db.rollback()
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
                return identity

        except Exception as e:
            logger.error(f"Failed to create identity for teacher {teacher.id}: {e}")
            db.rollback()
            return None

    def _create_identity_for_student(self, db: Session, student: Student) -> Identity:
        """建立新的 Identity（首次 Email 驗證）"""
        identity = Identity(
            email=student.email,
            password_hash=student.password_hash,
            email_verified=True,
            email_verified_at=student.email_verified_at,
            password_changed=student.password_changed,
            last_password_change=datetime.utcnow()
            if student.password_changed
            else None,
        )
        db.add(identity)
        db.flush()

        # 更新 Student
        student.identity_id = identity.id
        student.is_primary_account = True
        student.password_migrated_to_identity = True

        db.flush()
        logger.info(
            f"Created new identity {identity.id} for student {student.id} ({student.email})"
        )
        return identity

    def _merge_student_into_identity(
        self, db: Session, student: Student, identity: Identity
    ) -> Identity:
        """將 Student 合併到既有的 Identity"""
        # 智慧密碼選擇
        self._smart_password_merge(student, identity)

        # 將此 Student 加入 Identity
        student.identity_id = identity.id
        student.is_primary_account = False
        student.password_migrated_to_identity = True

        db.flush()
        logger.info(
            f"Merged student {student.id} into identity {identity.id} ({identity.email})"
        )
        return identity

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
            identity.last_password_change = datetime.utcnow()
            logger.info(
                f"Adopted student {student.id}'s custom password for identity {identity.id}"
            )
            return

        # 都有自定義密碼 or 都是預設密碼 -> 保持 Identity 的
        return

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
        identity.last_password_change = datetime.utcnow()
        db.flush()
        logger.info(f"Updated unified password for identity {identity.id}")


# Singleton
identity_service = IdentityService()
