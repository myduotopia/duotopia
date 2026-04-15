"""
配額管理服務 - 統一處理配額扣除與記錄

核心功能：
1. 扣除配額 (deduct_quota)
2. 檢查配額是否足夠 (check_quota)
3. 記錄使用明細 (log_usage)
4. 單位換算 (convert_unit_to_seconds)
"""

from sqlalchemy.orm import Session
from models import Teacher, PointUsageLog
from models.credit_package import CreditPackage
from models.organization import Organization, TeacherOrganization
from fastapi import HTTPException
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class QuotaService:
    """配額管理服務"""

    # ========== 單位換算規則 ==========
    # 基準：所有配額以「秒」為單位
    UNIT_CONVERSION = {
        "秒": 1,  # 1 秒 = 1 秒
        "字": 0.1,  # 1 字 = 0.1 秒 (500 字 = 50 秒)
        "張": 10,  # 1 張圖 = 10 秒
        "分鐘": 60,  # 1 分鐘 = 60 秒
    }

    # ========== 配額超額緩衝 ==========
    # 允許超額使用 20% 作為緩衝（給老師續費的時間）
    # 例如：10,000 秒配額 → 最多可用到 12,000 秒
    QUOTA_BUFFER_PERCENTAGE = 0.20

    @staticmethod
    def convert_unit_to_seconds(unit_count: float, unit_type: str) -> int:
        """
        將不同單位換算為秒數

        Args:
            unit_count: 單位數量 (30, 500, 1)
            unit_type: 單位類型 ("秒", "字", "張", "分鐘")

        Returns:
            秒數 (int)

        Examples:
            convert_unit_to_seconds(30, "秒") -> 30
            convert_unit_to_seconds(500, "字") -> 50
            convert_unit_to_seconds(2, "張") -> 20
        """
        if unit_type not in QuotaService.UNIT_CONVERSION:
            raise ValueError(f"不支援的單位類型: {unit_type}")

        seconds = int(unit_count * QuotaService.UNIT_CONVERSION[unit_type])
        return seconds

    @staticmethod
    def _get_active_credit_packages(
        teacher: Teacher, db: Session
    ) -> List[CreditPackage]:
        """Get active, non-expired credit packages ordered by earliest expiry"""
        now = datetime.now(timezone.utc)
        return (
            db.query(CreditPackage)
            .filter(
                CreditPackage.teacher_id == teacher.id,
                CreditPackage.status == "active",
                CreditPackage.expires_at > now,
            )
            .order_by(CreditPackage.expires_at.asc())
            .all()
        )

    @staticmethod
    def _get_total_remaining(teacher: Teacher, db: Session) -> int:
        """Get total remaining quota across subscription + credit packages"""
        remaining = 0

        # Subscription quota
        current_period = teacher.current_period
        if current_period:
            remaining += max(0, current_period.quota_total - current_period.quota_used)

        # Credit packages
        for pkg in QuotaService._get_active_credit_packages(teacher, db):
            remaining += pkg.points_remaining

        return remaining

    @staticmethod
    def check_quota(
        teacher: Teacher, required_seconds: int, db: Session = None
    ) -> bool:
        """
        檢查配額是否足夠（訂閱 + 點數包加總）

        Args:
            teacher: 教師物件
            required_seconds: 需要的秒數
            db: 資料庫 session（需要查詢 credit packages）

        Returns:
            True if 配額足夠
        """
        # Subscription quota
        remaining = 0
        current_period = teacher.current_period
        if current_period:
            remaining += max(0, current_period.quota_total - current_period.quota_used)

        if remaining >= required_seconds:
            return True

        # Credit packages (need db session)
        if db:
            for pkg in QuotaService._get_active_credit_packages(teacher, db):
                remaining += pkg.points_remaining
                if remaining >= required_seconds:
                    return True

        return remaining >= required_seconds

    @staticmethod
    def get_quota_info(teacher: Teacher, db: Session = None) -> Dict[str, Any]:
        """
        取得配額資訊（訂閱 + 點數包加總）

        Returns:
            {
                "quota_total": 7200,
                "quota_used": 2500,
                "quota_remaining": 4700,
                "status": "active",
                "subscription_total": 2000,
                "subscription_used": 2000,
                "subscription_remaining": 0,
                "credit_packages_total": 5200,
                "credit_packages_used": 500,
                "credit_packages_remaining": 4700,
            }
        """
        current_period = teacher.current_period

        sub_total = current_period.quota_total if current_period else 0
        sub_used = current_period.quota_used if current_period else 0
        sub_remaining = max(0, sub_total - sub_used)

        pkg_total = 0
        pkg_used = 0
        if db:
            for pkg in QuotaService._get_active_credit_packages(teacher, db):
                pkg_total += pkg.points_total
                pkg_used += pkg.points_used

        total = sub_total + pkg_total
        used = sub_used + pkg_used
        remaining = sub_remaining + max(0, pkg_total - pkg_used)

        # Determine status
        if current_period and current_period.status == "active":
            status = "active"
        elif pkg_total > 0:
            status = "credit_packages_only"
        else:
            status = "no_subscription"

        return {
            "quota_total": total,
            "quota_used": used,
            "quota_remaining": remaining,
            "status": status,
            "subscription_total": sub_total,
            "subscription_used": sub_used,
            "subscription_remaining": sub_remaining,
            "credit_packages_total": pkg_total,
            "credit_packages_used": pkg_used,
            "credit_packages_remaining": max(0, pkg_total - pkg_used),
        }

    @staticmethod
    def check_ai_analysis_availability(teacher_id: int, db: Session) -> bool:
        """
        檢查教師是否有 AI 分析額度（舊版：基於教師身份判斷）。
        用於教師端 dashboard 等不需要作業 context 的場景。

        規則：
        - 任一 active 機構有剩餘點數 → True
        - 所有機構都沒點數（或無機構）→ fallback 檢查個人配額

        注意：學生端應使用 check_ai_analysis_availability_by_assignment，
        根據作業所屬班級判斷。
        """
        teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
        if not teacher:
            return False

        teacher_orgs = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == teacher_id,
                TeacherOrganization.is_active.is_(True),
            )
            .all()
        )

        for teacher_org in teacher_orgs:
            org = (
                db.query(Organization)
                .filter(
                    Organization.id == teacher_org.organization_id,
                    Organization.is_active.is_(True),
                )
                .first()
            )
            if org and (org.total_points - org.used_points) > 0:
                return True

        return QuotaService._get_total_remaining(teacher, db) > 0

    @staticmethod
    def check_ai_analysis_availability_by_assignment(assignment, db: Session) -> bool:
        """
        根據作業所屬的班級判斷是否有 AI 分析額度。
        與 speech_assessment.py 扣點邏輯一致：
        assignment → classroom → classroom_schools → school → organization

        規則：
        - 作業屬於機構班級 → 查機構 remaining_points > 0
        - 作業屬於個人班級 → 查教師 quota_remaining > 0
        """
        if not assignment:
            return True

        teacher = db.query(Teacher).filter(Teacher.id == assignment.teacher_id).first()
        if not teacher:
            return False

        # 透過 classroom → classroom_schools → school → org 判斷
        classroom = assignment.classroom
        org_id = QuotaService._get_org_id_from_classroom(classroom)

        if org_id:
            # 機構班級 → 查機構點數
            org = (
                db.query(Organization)
                .filter(
                    Organization.id == org_id,
                    Organization.is_active.is_(True),
                )
                .first()
            )
            if org:
                remaining = org.total_points - org.used_points
                return remaining > 0
            # org 不 active → fall through 到個人配額

        # 個人班級 → 查教師配額（subscription + credit packages）
        return QuotaService._get_total_remaining(teacher, db) > 0

    @staticmethod
    def _get_org_id_from_classroom(classroom) -> Optional[str]:
        """
        從 classroom 透過 classroom_schools 關係取得 organization_id。
        與 speech_assessment.py 的 get_organization_id_from_classroom 邏輯一致。
        """
        if not classroom or not classroom.classroom_schools:
            return None

        for cs in classroom.classroom_schools:
            if cs.is_active and cs.school and cs.school.organization_id:
                return str(cs.school.organization_id)

        return None

    @staticmethod
    def deduct_quota(
        db: Session,
        teacher: Teacher,
        student_id: Optional[int],
        assignment_id: Optional[int],
        feature_type: str,
        unit_count: float,
        unit_type: str,
        feature_detail: Optional[Dict[str, Any]] = None,
    ) -> PointUsageLog:
        """
        扣除配額並記錄（Waterfall: 訂閱配額 → 點數包按到期日排序）

        Args:
            db: 資料庫 session
            teacher: 教師物件
            student_id: 學生 ID (optional)
            assignment_id: 作業 ID (optional)
            feature_type: 功能類型 ("speech_recording", "speech_assessment", "text_correction")
            unit_count: 單位數量 (30秒, 500字, 1張)
            unit_type: 單位類型 ("秒", "字", "張")
            feature_detail: 功能詳細資訊 (optional)

        Returns:
            PointUsageLog 記錄

        Raises:
            HTTPException(402): 配額不足
        """
        # 1. 換算為秒數
        points_used = QuotaService.convert_unit_to_seconds(unit_count, unit_type)
        remaining_to_deduct = points_used

        # 2. 記錄扣除前的總用量（用於 usage log）
        current_period = teacher.current_period
        active_packages = QuotaService._get_active_credit_packages(teacher, db)

        # Calculate total quota for buffer
        total_quota = 0
        total_used_before = 0
        if current_period:
            total_quota += current_period.quota_total
            total_used_before += current_period.quota_used
        for pkg in active_packages:
            total_quota += pkg.points_total
            total_used_before += pkg.points_used

        # 3. Check if there's any quota at all
        if total_quota == 0:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "NO_SUBSCRIPTION",
                    "message": "您目前沒有有效的訂閱或點數包，請先訂閱方案或購買點數包",
                },
            )

        # 4. Check hard limit (total quota + 20% buffer)
        effective_limit = total_quota * (1 + QuotaService.QUOTA_BUFFER_PERCENTAGE)
        total_used_after = total_used_before + points_used

        if total_used_after > effective_limit:
            over_limit = total_used_after - effective_limit
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "QUOTA_HARD_LIMIT_EXCEEDED",
                    "message": "老師的配額已用完（含緩衝額度），請聯繫老師續費或購買點數包",
                    "quota_used": total_used_before,
                    "quota_total": total_quota,
                    "quota_limit": int(effective_limit),
                    "buffer_percentage": int(
                        QuotaService.QUOTA_BUFFER_PERCENTAGE * 100
                    ),
                    "over_limit": int(over_limit),
                },
            )

        # 5. Waterfall deduction: subscription first
        subscription_period_id = None
        if current_period:
            sub_remaining = current_period.quota_total - current_period.quota_used
            if sub_remaining > 0:
                deduct_from_sub = min(remaining_to_deduct, sub_remaining)
                current_period.quota_used += deduct_from_sub
                remaining_to_deduct -= deduct_from_sub
                subscription_period_id = current_period.id

        # 6. Waterfall deduction: credit packages by earliest expiry
        if remaining_to_deduct > 0:
            for pkg in active_packages:
                if remaining_to_deduct <= 0:
                    break
                pkg_remaining = pkg.points_total - pkg.points_used
                if pkg_remaining <= 0:
                    continue
                deduct_from_pkg = min(remaining_to_deduct, pkg_remaining)
                pkg.points_used += deduct_from_pkg
                remaining_to_deduct -= deduct_from_pkg

        # 7. Log buffer usage warning
        if total_used_after > total_quota:
            buffer_amount = total_quota * QuotaService.QUOTA_BUFFER_PERCENTAGE
            buffer_used = total_used_after - total_quota
            buffer_remaining = buffer_amount - buffer_used
            logger.warning(
                f"Teacher {teacher.id} using buffer quota: "
                f"{int(buffer_used)}s/{int(buffer_amount)}s used, "
                f"{int(buffer_remaining)}s remaining before hard limit"
            )

        # 8. Create usage log
        usage_log = PointUsageLog(
            subscription_period_id=subscription_period_id,  # None if no subscription
            teacher_id=teacher.id,
            student_id=student_id,
            assignment_id=assignment_id,
            feature_type=feature_type,
            feature_detail=feature_detail or {},
            points_used=points_used,
            quota_before=total_used_before,
            quota_after=total_used_after,
            unit_count=unit_count,
            unit_type=unit_type,
        )
        db.add(usage_log)

        # 9. Commit
        db.commit()
        db.refresh(usage_log)

        return usage_log


# ============ 使用範例 ============
if __name__ == "__main__":
    print("=" * 70)
    print("🧪 配額服務測試")
    print("=" * 70)

    # 測試單位換算
    print("\n1️⃣ 單位換算測試：")
    test_cases = [
        (30, "秒", 30),
        (500, "字", 50),
        (2, "張", 20),
        (1.5, "分鐘", 90),
    ]

    for count, unit, expected in test_cases:
        result = QuotaService.convert_unit_to_seconds(count, unit)
        status = "✅" if result == expected else "❌"
        print(f"  {status} {count} {unit} = {result} 秒 (預期: {expected})")

    print("\n" + "=" * 70)
