"""Google 登入的帳號解析／建立邏輯（Issue #740，老師端）。

與 1Campus 的差別：
- 1Campus 把 provider 資料寫在 identities 表的專屬欄位；Google 走通用的
  oauth_identities 表（provider='google'），同一位老師可同時綁 1Campus + Google。
- 沒有 national_id_hash 第二識別碼，因此不做 merge 確認 UI；email 未驗證一律拒絕。

解析順序：
1. oauth_identities 命中 (google, sub) → 直接登入          → action="existing"
2. Google 回報 email 未驗證                                → 拒絕
3. 既有 Teacher email 相符
   - 該 Teacher email 已驗證 → 建立綁定                    → action="linked"
   - 未驗證                  → 拒絕（要求先完成 email 驗證）
4. 全新 → 建 Identity + Teacher（has_password=False）+ 綁定 → action="created"
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.user import Identity, Teacher
from services.oauth_service import OAuthService

logger = logging.getLogger(__name__)

PROVIDER = "google"


class GoogleEmailNotVerifiedError(Exception):
    """Google 端回報該 email 未驗證。"""


class GoogleAccountNotVerifiedError(Exception):
    """Duotopia 既有帳號的 email 尚未驗證，不允許自動綁定。"""


class GoogleAccountService:
    """Google OAuth 老師帳號解析／建立。"""

    @staticmethod
    def find_or_create_teacher(
        db: Session,
        *,
        google_sub: str,
        email: Optional[str],
        email_verified: bool,
        name: Optional[str] = None,
        picture: Optional[str] = None,
        raw_profile: Optional[dict] = None,
    ) -> Tuple[Teacher, str]:
        """回傳 (teacher, action)。action ∈ {"existing", "linked", "created"}。"""

        # Step 1：已綁定過的 Google 帳號
        oauth_identity = OAuthService.find_by_provider(db, PROVIDER, google_sub)
        if oauth_identity:
            teacher = (
                db.query(Teacher)
                .filter(
                    Teacher.id == oauth_identity.teacher_id,
                    Teacher.is_active.is_(True),
                )
                .first()
            )
            if teacher:
                # 使用者可能改過 Google 顯示名稱／頭像，順手更新
                oauth_identity.provider_email = email
                oauth_identity.display_name = name
                oauth_identity.avatar_url = picture
                db.commit()
                db.refresh(teacher)
                logger.info(
                    "Google OAuth: existing teacher_id=%s, sub=%s",
                    teacher.id,
                    google_sub,
                )
                return teacher, "existing"

            # 綁定紀錄指向已停用的老師：刪掉舊綁定，往下走一般流程重新建立
            logger.warning(
                "Google OAuth: oauth_identity id=%s points to inactive teacher_id=%s; "
                "removing stale link",
                oauth_identity.id,
                oauth_identity.teacher_id,
            )
            db.delete(oauth_identity)
            db.flush()

        # Step 2：Google 端未驗證的 email 一律不接受
        if not email or not email_verified:
            raise GoogleEmailNotVerifiedError(
                "Google account email is missing or unverified"
            )

        email_lower = email.lower()

        # Step 3：既有老師（case-insensitive）
        teacher = (
            db.query(Teacher)
            .filter(
                func.lower(Teacher.email) == email_lower,
                Teacher.is_active.is_(True),
            )
            .first()
        )
        if teacher:
            if not teacher.email_verified:
                raise GoogleAccountNotVerifiedError(
                    "Existing Duotopia account email is not verified"
                )

            GoogleAccountService._link(
                db,
                teacher=teacher,
                google_sub=google_sub,
                email=email,
                name=name,
                picture=picture,
                raw_profile=raw_profile,
            )
            db.commit()
            db.refresh(teacher)
            logger.info(
                "Google OAuth: linked to existing teacher_id=%s, sub=%s",
                teacher.id,
                google_sub,
            )
            return teacher, "linked"

        # Step 4：全新帳號
        identity = (
            db.query(Identity)
            .filter(
                func.lower(Identity.email) == email_lower,
                Identity.is_active.is_(True),
            )
            .first()
        )
        if identity is None:
            identity = Identity(
                email=email,
                # Google 已驗證過該 email，才會走到這裡
                email_verified=True,
                email_verified_at=datetime.now(timezone.utc),
                is_active=True,
            )
            db.add(identity)
            db.flush()

        teacher = Teacher(
            name=name or email,
            email=email,
            password_hash=None,
            has_password=False,
            identity_id=identity.id,
            is_active=True,
            email_verified=True,
            email_verified_at=datetime.now(timezone.utc),
        )
        db.add(teacher)
        db.flush()

        GoogleAccountService._link(
            db,
            teacher=teacher,
            google_sub=google_sub,
            email=email,
            name=name,
            picture=picture,
            raw_profile=raw_profile,
        )
        db.commit()
        db.refresh(teacher)
        logger.info(
            "Google OAuth: created teacher_id=%s, identity_id=%s, sub=%s",
            teacher.id,
            identity.id,
            google_sub,
        )
        return teacher, "created"

    @staticmethod
    def _link(
        db: Session,
        *,
        teacher: Teacher,
        google_sub: str,
        email: str,
        name: Optional[str],
        picture: Optional[str],
        raw_profile: Optional[dict],
    ) -> None:
        """建立 oauth_identities 綁定，並補上 identity_id。"""
        oauth_identity = OAuthService.link_account(
            db,
            teacher_id=teacher.id,
            provider=PROVIDER,
            provider_user_id=google_sub,
            provider_email=email,
            display_name=name,
            avatar_url=picture,
            raw_profile=raw_profile,
        )
        # OAuthService.link_account 不寫 identity_id（1Campus 時期留下的 TODO），
        # 這裡補上，讓同一 Identity 底下的多 provider 可互相查得到。
        oauth_identity.identity_id = teacher.identity_id
        db.flush()
