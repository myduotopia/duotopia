"""Student Identity Service - 學生身分整合核心服務

處理 StudentIdentity 的建立、帳號合併、密碼統一等邏輯。
整合觸發時機：學生完成 Email 驗證時。
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from models.user import Student, StudentIdentity

logger = logging.getLogger(__name__)


class StudentIdentityService:
    """學生身分整合服務"""

    def consolidate_on_email_verification(
        self, db: Session, student: Student
    ) -> Optional[StudentIdentity]:
        """Email 驗證成功時觸發身分整合

        1. 檢查是否已有相同 email 的 StudentIdentity
        2. 若有 → 將此 Student 加入既有 Identity
        3. 若無 → 建立新 StudentIdentity

        Args:
            db: 資料庫 session
            student: 剛驗證完 email 的學生

        Returns:
            StudentIdentity 或 None（若失敗）
        """
        if not student.email or not student.email_verified:
            logger.warning(f"Student {student.id} has no verified email, skip consolidation")
            return None

        # 如果已經整合過，不重複處理
        if student.identity_id is not None:
            logger.info(f"Student {student.id} already consolidated to identity {student.identity_id}")
            return student.identity

        try:
            # 查找是否已有相同 email 的 Identity
            existing_identity = (
                db.query(StudentIdentity)
                .filter(
                    StudentIdentity.verified_email == student.email,
                    StudentIdentity.is_active.is_(True),
                )
                .first()
            )

            if existing_identity:
                return self._merge_into_existing_identity(db, student, existing_identity)
            else:
                return self._create_new_identity(db, student)

        except Exception as e:
            logger.error(f"Failed to consolidate student {student.id}: {e}")
            db.rollback()
            return None

    def _create_new_identity(
        self, db: Session, student: Student
    ) -> StudentIdentity:
        """建立新的 StudentIdentity（首次 Email 驗證）"""
        identity = StudentIdentity(
            primary_student_id=student.id,
            verified_email=student.email,
            password_hash=student.password_hash,
            password_changed=student.password_changed,
            last_password_change=datetime.utcnow() if student.password_changed else None,
            merge_source="email_verification",
        )
        db.add(identity)
        db.flush()  # 取得 identity.id

        # 更新 Student
        student.identity_id = identity.id
        student.is_primary_account = True
        student.password_migrated_to_identity = True

        db.flush()
        logger.info(
            f"Created new identity {identity.id} for student {student.id} ({student.email})"
        )
        return identity

    def _merge_into_existing_identity(
        self, db: Session, student: Student, identity: StudentIdentity
    ) -> StudentIdentity:
        """將 Student 合併到既有的 StudentIdentity"""
        # 智慧密碼選擇
        self._smart_password_merge(student, identity)

        # 將此 Student 加入 Identity
        student.identity_id = identity.id
        student.is_primary_account = False
        student.password_migrated_to_identity = True

        db.flush()
        logger.info(
            f"Merged student {student.id} into identity {identity.id} ({identity.verified_email})"
        )
        return identity

    def _smart_password_merge(
        self, student: Student, identity: StudentIdentity
    ) -> None:
        """智慧密碼選擇策略

        1. Identity 已有自定義密碼 → 保持不變
        2. Identity 是預設密碼，Student 有自定義 → 採用 Student 的
        3. 都是預設密碼 → 保持 Identity 的
        4. 都有自定義密碼 → 採用最新修改的
        """
        if identity.password_changed and not student.password_changed:
            # Identity 已有自定義密碼，Student 是預設 → 保持 Identity
            return

        if not identity.password_changed and student.password_changed:
            # Identity 是預設密碼，Student 有自定義 → 採用 Student 的
            identity.password_hash = student.password_hash
            identity.password_changed = True
            identity.last_password_change = datetime.utcnow()
            logger.info(
                f"Adopted student {student.id}'s custom password for identity {identity.id}"
            )
            return

        if identity.password_changed and student.password_changed:
            # 都有自定義密碼 → 保持 Identity 的（已存在較久）
            return

        # 都是預設密碼 → 保持 Identity 的
        return

    def get_linked_students(
        self, db: Session, identity_id: int
    ) -> list[Student]:
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
    ) -> Optional[StudentIdentity]:
        """透過 Student ID 取得對應的 StudentIdentity"""
        student = db.query(Student).filter(Student.id == student_id).first()
        if not student or not student.identity_id:
            return None
        return (
            db.query(StudentIdentity)
            .filter(StudentIdentity.id == student.identity_id)
            .first()
        )

    def update_unified_password(
        self,
        db: Session,
        identity: StudentIdentity,
        new_password_hash: str,
    ) -> None:
        """更新統一密碼（所有關聯帳號共用）"""
        identity.password_hash = new_password_hash
        identity.password_changed = True
        identity.last_password_change = datetime.utcnow()
        db.flush()
        logger.info(f"Updated unified password for identity {identity.id}")


# Singleton
student_identity_service = StudentIdentityService()
