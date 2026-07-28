"""
Cron Job API Endpoints

定期執行的自動化任務
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine
from datetime import datetime, timedelta, timezone
import logging
import os

from database import get_db
from models import (
    Teacher,
    TeacherSubscriptionTransaction,
    TransactionType,
    SubscriptionPeriod,
    Student,
    Classroom,
    ClassroomStudent,
    StudentItemProgress,
    GroupBuyTeam,
    GroupBuyMember,
)
from services.email_service import email_service
from services.tappay_service import TapPayService
from services.group_buy import grant_monthly_for_group_buy
from services.institution_invoice_ledger import mark_overdue_invoices
from google.cloud import bigquery

router = APIRouter(prefix="/api/cron", tags=["cron"])
logger = logging.getLogger(__name__)

# Cron Secret（用於驗證請求來源）
CRON_SECRET = os.getenv("CRON_SECRET", "dev-secret-change-me")


@router.post("/monthly-renewal")
async def monthly_renewal_cron(
    x_cron_secret: str = Header(None),
    db: Session = Depends(get_db),
    force: bool = False,
):
    """
    每月 1 號執行的自動續訂任務

    執行時間：每月 1 號凌晨 2:00（由 Cloud Scheduler 觸發）

    功能：
    1. 找出今天到期且開啟自動續訂的用戶
    2. 自動延長訂閱到下個月 1 號
    3. 發送續訂通知 Email

    安全性：
    - 只允許帶有正確 X-Cron-Secret header 的請求
    - Cloud Scheduler 設定中需配置此 header
    """
    # 驗證 Cron Secret
    if x_cron_secret != CRON_SECRET:
        logger.warning(f"Unauthorized cron request. Secret: {x_cron_secret[:10]}...")
        raise HTTPException(status_code=401, detail="Unauthorized")

    # 使用台北時區（因為 Cloud Scheduler 設定為 Asia/Taipei）
    from zoneinfo import ZoneInfo

    taipei_tz = ZoneInfo("Asia/Taipei")
    now_taipei = datetime.now(taipei_tz)
    today_taipei = now_taipei.date()

    # 同時記錄 UTC 時間
    now_utc = datetime.now(timezone.utc)

    logger.info("🔄 Monthly renewal cron started")
    logger.info(f"   Taipei time: {now_taipei}")
    logger.info(f"   UTC time: {now_utc}")

    # 檢查是否為每月 1 號（台北時間）— `?force=true` (cron-secret gated)
    # bypasses the day-1 guard for ops recovery (e.g. Phase 3 failed on day 1
    # and we need to re-run on day 2). The CRON_SECRET check above already
    # gates this.
    if today_taipei.day != 1 and not force:
        logger.info(
            f"Not the 1st of the month (Taipei: {today_taipei}), skipping renewal"
        )
        return {
            "status": "skipped",
            "message": f"Not the 1st of the month. Today is {today_taipei}",
            "date": today_taipei.isoformat(),
        }
    if force:
        logger.warning(
            f"⚠️  Day-1 guard bypassed via force=true (today={today_taipei})"
        )

    # ========================================
    # Phase 1: 標記所有過期訂閱為 expired
    # ========================================
    logger.info("📋 Phase 1: Marking expired subscriptions")

    # F6 — Compare against the full tz-aware now_taipei datetime, not the
    # naive .date(). end_date is timestamptz; comparing to a bare `date`
    # forces Postgres to cast using the session timezone (UTC on Cloud Run),
    # which incorrectly preserves a Taipei-end-of-Dec-31 period as active
    # past Taipei Jan 1.
    expired_periods = (
        db.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.status == "active",
            SubscriptionPeriod.end_date < now_taipei,
        )
        .all()
    )

    marked_expired = 0
    for period in expired_periods:
        period.status = "expired"
        marked_expired += 1

    if marked_expired > 0:
        db.commit()
        logger.info(f"✅ Marked {marked_expired} subscriptions as expired")
    else:
        logger.info("✅ No expired subscriptions to mark")

    # ========================================
    # Phase 2: 處理自動續訂
    # ========================================
    logger.info("💳 Phase 2: Processing auto-renewals")

    # 找出所有 auto_renew 啟用的教師
    teachers_with_auto_renew = (
        db.query(Teacher)
        .filter(
            Teacher.subscription_auto_renew.is_(True),
            Teacher.is_active.is_(True),
        )
        .all()
    )

    logger.info(
        f"Found {len(teachers_with_auto_renew)} teachers with auto_renew enabled"
    )

    # issue #862 §4.8 P1 雙保險：跳過「仍在享有團購」成員的個人 auto_renew 扣款。
    # 團購成員點數來自團隊年費、個人訂閱入團時已 paused；這裡在扣款前再攔一次，
    # 即使某次 pause 漏關 auto_renew，也不會對團購成員重複收費（防 P1）。
    # 必須同時檢查 subscription_end >= now，與「發點資格」「resume sweep」對齊
    # 「還在享有團購」的定義——否則團隊年度到期後（沒續約），成員已被 resume、
    # auto_renew 轉回 True，卻仍被此 skip-list 命中而永遠不扣款、靜默失去訂閱。
    active_gb_member_ids = {
        row[0]
        for row in db.query(GroupBuyMember.teacher_id)
        .join(GroupBuyTeam, GroupBuyTeam.id == GroupBuyMember.team_id)
        .filter(
            GroupBuyMember.is_active.is_(True),
            GroupBuyTeam.is_active.is_(True),
            GroupBuyTeam.subscription_end >= now_taipei,
        )
        .all()
    }

    results = {
        "status": "completed",
        "date": today_taipei.isoformat(),
        "marked_expired": marked_expired,
        "auto_renewed": 0,
        "renewal_failed": 0,
        "auto_renew_disabled": 0,
        "skipped": 0,
        # Group-buy monthly grants (issue #768 Phase 3, 五.2)
        "group_buy_grants_created": 0,
        "group_buy_grants_skipped_duplicate": 0,
        "errors": [],
    }

    # 初始化 TapPay 服務
    tappay_service = TapPayService()

    # 計算上個月的日期範圍
    from dateutil.relativedelta import relativedelta

    last_month_start = today_taipei.replace(day=1) - relativedelta(months=1)
    last_month_end = today_taipei.replace(day=1) - relativedelta(days=1)

    # 當月日期範圍
    from calendar import monthrange

    current_month_start = today_taipei.replace(day=1)
    current_month_end = today_taipei.replace(
        day=monthrange(today_taipei.year, today_taipei.month)[1]
    )

    for teacher in teachers_with_auto_renew:
        try:
            # issue #862 §4.8 P1：active 團購成員不對其個人訂閱扣款（雙保險）。
            if teacher.id in active_gb_member_ids:
                logger.info(
                    f"Teacher {teacher.email} is an active group-buy member; "
                    "skipping individual auto-renew charge"
                )
                results["skipped"] += 1
                continue

            # 💳 檢查是否有儲存的信用卡 Token
            if not teacher.card_key or not teacher.card_token:
                logger.info(
                    f"Teacher {teacher.email} has auto_renew but no card, skipping"
                )
                results["skipped"] += 1
                continue

            # ========================================
            # 檢查 1: 防重複扣款
            # ========================================
            # 查詢是否已有本月訂閱
            existing_current_month = (
                db.query(SubscriptionPeriod)
                .filter(
                    SubscriptionPeriod.teacher_id == teacher.id,
                    SubscriptionPeriod.start_date >= current_month_start,
                    SubscriptionPeriod.status == "active",
                )
                .first()
            )

            if existing_current_month:
                logger.info(
                    f"Teacher {teacher.email} already has current month subscription, skipping"
                )
                results["skipped"] += 1
                continue

            # ========================================
            # 檢查 2: 防錯誤扣款 + 關閉 auto_renew
            # ========================================
            # 查詢是否有上個月訂閱
            last_month_subscription = (
                db.query(SubscriptionPeriod)
                .filter(
                    SubscriptionPeriod.teacher_id == teacher.id,
                    SubscriptionPeriod.start_date == last_month_start,
                    SubscriptionPeriod.end_date == last_month_end,
                )
                .first()
            )

            if not last_month_subscription:
                # 沒有上個月訂閱 → 關閉 auto_renew
                logger.warning(
                    f"Teacher {teacher.email} has no last month subscription, "
                    f"disabling auto_renew"
                )
                teacher.subscription_auto_renew = False
                db.commit()
                results["auto_renew_disabled"] += 1

                # TODO: 發送通知信
                # email_service.send_auto_renew_disabled_notification(teacher)

                continue

            # ========================================
            # 取得上個月訂閱資訊用於續訂
            # ========================================
            from config.plans import get_plan_price, get_plan_quota

            plan_name = last_month_subscription.plan_name
            amount = get_plan_price(plan_name, db=db)
            quota_total = get_plan_quota(plan_name, db=db)

            # 生成訂單編號
            order_number = f"RENEWAL_{teacher.id}_{today_taipei.strftime('%Y%m%d')}"

            # 💳 使用 TapPay Card Token 進行扣款
            logger.info(
                f"💳 Auto-charging {teacher.email}: TWD {amount} "
                f"(Card: ****{teacher.card_last_four})"
            )

            gateway_response = tappay_service.pay_by_token(
                card_key=teacher.card_key,
                card_token=teacher.card_token,
                amount=amount,
                details=f"{plan_name} Monthly Renewal",  # 🔄 使用 Period.plan_name
                cardholder={
                    "name": teacher.name,
                    "email": teacher.email,
                    "phone": "+886912345678",  # TODO: 未來可加入電話欄位
                },
                order_number=order_number,
            )

            # 檢查扣款是否成功
            if gateway_response.get("status") != 0:
                # 扣款失敗
                error_msg = TapPayService.parse_error_code(
                    gateway_response.get("status"), gateway_response.get("msg")
                )
                logger.error(f"❌ Auto-charge failed for {teacher.email}: {error_msg}")

                # 記錄失敗交易
                failed_transaction = TeacherSubscriptionTransaction(
                    teacher_id=teacher.id,
                    teacher_email=teacher.email,
                    transaction_type=TransactionType.RECHARGE,
                    subscription_type=plan_name,
                    amount=amount,
                    currency="TWD",
                    status="FAILED",
                    months=1,
                    period_start=current_month_start,
                    period_end=current_month_end,
                    previous_end_date=last_month_end,
                    new_end_date=last_month_end,  # 失敗不延長
                    processed_at=now_utc,
                    payment_provider="tappay",
                    payment_method="card_token",
                    external_transaction_id=gateway_response.get("rec_trade_id"),
                    failure_reason=error_msg,
                    error_code=str(gateway_response.get("status")),
                    gateway_response=gateway_response,
                )
                db.add(failed_transaction)
                db.commit()

                results["renewal_failed"] += 1
                results["errors"].append(
                    {
                        "teacher": teacher.email,
                        "error": error_msg,
                        "status_code": gateway_response.get("status"),
                    }
                )

                # 發送扣款失敗通知（TODO: 未來實作）
                # email_service.send_renewal_failed(...)

                continue

            # ✅ 扣款成功 - 創建新的訂閱週期
            rec_id = gateway_response.get("rec_trade_id")

            # ✅ 創建新的訂閱週期記錄
            new_period = SubscriptionPeriod(
                teacher_id=teacher.id,
                plan_name=plan_name,
                amount_paid=amount,
                quota_total=quota_total,
                quota_used=0,
                start_date=current_month_start,
                end_date=current_month_end,
                payment_method="auto_renew",  # 自動續訂
                payment_id=rec_id,
                payment_status="paid",
                status="active",
            )
            db.add(new_period)

            # ⚠️ 重要：更新 card_token（TapPay 每次交易會刷新 token）
            if gateway_response.get("card_secret"):
                new_card_token = gateway_response["card_secret"].get("card_token")
                if new_card_token:
                    teacher.card_token = new_card_token
                    logger.info(f"Card token refreshed for {teacher.email}")

            # 建立成功交易記錄
            transaction = TeacherSubscriptionTransaction(
                teacher_id=teacher.id,
                teacher_email=teacher.email,
                transaction_type=TransactionType.RECHARGE,
                subscription_type=plan_name,
                amount=amount,
                currency="TWD",
                status="SUCCESS",
                months=1,
                period_start=current_month_start,
                period_end=current_month_end,
                previous_end_date=last_month_end,
                new_end_date=current_month_end,
                processed_at=now_utc,
                payment_provider="tappay",
                payment_method="card_token",
                external_transaction_id=gateway_response.get("rec_trade_id"),
                gateway_response=gateway_response,
            )
            db.add(transaction)

            # 提交變更
            db.commit()

            logger.info(
                f"✅ Auto-renewal success: {teacher.email} - "
                f"{plan_name} {current_month_start} to {current_month_end} "
                f"(TWD {amount} charged)"
            )

            # 發送續訂成功通知
            try:
                email_service.send_renewal_success(
                    teacher_email=teacher.email,
                    teacher_name=teacher.name,
                    new_end_date=current_month_end,
                    plan_name=plan_name,
                )
            except Exception as e:
                logger.error(f"Failed to send renewal email to {teacher.email}: {e}")

            results["auto_renewed"] += 1

        except Exception as e:
            db.rollback()
            logger.error(f"❌ Failed to renew {teacher.email}: {e}")
            results["renewal_failed"] += 1
            results["errors"].append({"teacher": teacher.email, "error": str(e)})

    # ========================================
    # Phase 3 (issue #768 五.2): 團購月配發 1000 點
    # ========================================
    # For every active group-buy school where the org's annual subscription
    # is still in date, create a fresh 1000-quota SubscriptionPeriod for
    # every bound teacher. Old periods get marked expired by Phase 1 above.
    logger.info("🎁 Phase 3: Group-buy monthly grants")
    group_buy_failed = False
    try:
        gb_result = grant_monthly_for_group_buy(now_taipei, db)
        results["group_buy_grants_created"] = gb_result["grants_created"]
        results["group_buy_grants_skipped_duplicate"] = gb_result[
            "grants_skipped_duplicate"
        ]
        logger.info(
            f"✅ Group-buy grants: created={gb_result['grants_created']} "
            f"skipped_duplicate={gb_result['grants_skipped_duplicate']}"
        )
    except Exception as e:
        # R2-F4 — Explicit rollback to clear any dirty/pending state from a
        # partial Phase 3 commit attempt, so subsequent DB access in this
        # request (e.g. logging) interacts with a clean session.
        db.rollback()
        logger.error(f"❌ Group-buy grant phase failed: {e}")
        results["errors"].append({"phase": "group_buy_grant", "error": str(e)})
        group_buy_failed = True

    logger.info(
        f"🔄 Monthly renewal completed: "
        f"Marked expired: {results['marked_expired']}, "
        f"Auto-renewed: {results['auto_renewed']}, "
        f"Failed: {results['renewal_failed']}, "
        f"Auto-renew disabled: {results['auto_renew_disabled']}, "
        f"Skipped: {results['skipped']}, "
        f"Group-buy grants: {results['group_buy_grants_created']}"
    )

    # F7 — Surface Phase 3 total failure as HTTP 500 so Cloud Scheduler's
    # failure threshold triggers an alert. Partial Phase-2 per-teacher
    # failures stay 200 to match historical behaviour.
    if group_buy_failed:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Group-buy monthly grant phase failed; manual recovery needed.",
                "results": results,
            },
        )

    return results


@router.post("/renewal-reminder")
async def renewal_reminder_cron(
    x_cron_secret: str = Header(None), db: Session = Depends(get_db)
):
    """
    續訂提醒 Cron Job

    執行時間：每天凌晨 3:00（由 Cloud Scheduler 觸發）

    功能：
    - 找出 7 天內到期的用戶
    - 發送續訂提醒 Email
    """
    # 驗證 Cron Secret
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # 使用 UTC 時間（提醒不需要嚴格時區對齊）
    now_utc = datetime.now(timezone.utc)
    seven_days_later = now_utc + timedelta(days=7)

    logger.info(f"📧 Renewal reminder cron started at {now_utc}")

    # 🔄 新系統：找出 7 天內到期的訂閱週期
    periods_to_remind = (
        db.query(SubscriptionPeriod)
        .join(Teacher, SubscriptionPeriod.teacher_id == Teacher.id)
        .filter(
            SubscriptionPeriod.status == "active",
            SubscriptionPeriod.payment_method == "auto_renew",
            SubscriptionPeriod.end_date <= seven_days_later,
            SubscriptionPeriod.end_date > now_utc,
            Teacher.subscription_auto_renew.is_(True),
            Teacher.is_active.is_(True),
        )
        .all()
    )

    logger.info(f"Found {len(periods_to_remind)} periods to remind")

    results = {
        "status": "completed",
        "total": len(periods_to_remind),
        "success": 0,
        "failed": 0,
    }

    for period in periods_to_remind:
        try:
            teacher = period.teacher
            days_remaining = (period.end_date - now_utc).days

            # 發送提醒 Email
            email_service.send_renewal_reminder(
                teacher_email=teacher.email,
                teacher_name=teacher.name,
                end_date=period.end_date,
                days_remaining=days_remaining,
                plan_name=period.plan_name,
            )

            results["success"] += 1
            logger.info(
                f"✅ Reminder sent to {teacher.email} ({days_remaining} days left)"
            )

        except Exception as e:
            logger.error(f"❌ Failed to send reminder to {teacher.email}: {e}")
            results["failed"] += 1

    logger.info(
        f"📧 Renewal reminder completed: "
        f"{results['success']} success, {results['failed']} failed"
    )

    return results


@router.post("/test-notification")
async def test_cron_notification(
    x_cron_secret: str = Header(None), db: Session = Depends(get_db)
):
    """
    測試用 Cron Job - 只發送通知不執行扣款

    執行時間：每天執行（用於測試 Cloud Scheduler 是否正常運作）

    功能：
    1. 檢查即將到期的訂閱（7 天內）
    2. 統計需要續訂的用戶數量
    3. 發送測試通知到 Duotopia 官方信箱

    安全性：
    - 只允許帶有正確 X-Cron-Secret header 的請求
    - 不會真正執行扣款或修改資料
    """
    # 驗證 Cron Secret
    if x_cron_secret != CRON_SECRET:
        logger.warning(f"Unauthorized cron request. Secret: {x_cron_secret[:10]}...")
        raise HTTPException(status_code=401, detail="Unauthorized")

    logger.info("🧪 Test Cron Notification Started")

    # 台北時區
    taipei_tz = timezone(timedelta(hours=8))
    now_taipei = datetime.now(taipei_tz)
    now_utc = datetime.now(timezone.utc)

    # 7 天後
    seven_days_later = now_utc + timedelta(days=7)

    # 🔄 新系統：統計即將到期的訂閱週期（7 天內）
    periods_expiring_soon = (
        db.query(SubscriptionPeriod)
        .join(Teacher, SubscriptionPeriod.teacher_id == Teacher.id)
        .filter(
            SubscriptionPeriod.status == "active",
            SubscriptionPeriod.end_date <= seven_days_later,
            SubscriptionPeriod.end_date > now_utc,
            Teacher.subscription_auto_renew.is_(True),
            Teacher.is_active.is_(True),
        )
        .all()
    )

    # 統計有卡片的用戶
    teachers_with_card = [
        p.teacher for p in periods_expiring_soon if p.teacher.card_key
    ]
    teachers_without_card = [
        p.teacher for p in periods_expiring_soon if not p.teacher.card_key
    ]

    # 發送測試通知到 Duotopia 官方信箱
    notification_content = f"""
    <h2>🧪 Cloud Scheduler 測試通知</h2>
    <p><strong>執行時間：</strong>{now_taipei.strftime('%Y-%m-%d %H:%M:%S')} (台北時間)</p>

    <h3>📊 訂閱統計</h3>
    <ul>
        <li>7 天內即將到期的用戶：<strong>{len(periods_expiring_soon)}</strong> 位</li>
        <li>已儲存信用卡：<strong>{len(teachers_with_card)}</strong> 位</li>
        <li>未儲存信用卡：<strong>{len(teachers_without_card)}</strong> 位</li>
    </ul>

    <h3>✅ Cloud Scheduler 狀態</h3>
    <p>✅ Cloud Scheduler 運作正常<br>
    ✅ Cron API 可正常訪問<br>
    ✅ 資料庫連線正常<br>
    ✅ Email 服務正常</p>

    <h3>📋 用戶詳情</h3>
    """

    if teachers_with_card:
        notification_content += "<h4>已儲存卡片的用戶：</h4><ul>"
        for teacher in teachers_with_card:
            period = teacher.current_period
            if period:
                days_left = (period.end_date - now_utc).days
                notification_content += f"""
                <li>{teacher.name} ({teacher.email})
                    - 到期日: {period.end_date.strftime('%Y-%m-%d')}
                    - 剩餘: {days_left} 天
                    - 卡片: ****{teacher.card_last_four}
                </li>
                """
        notification_content += "</ul>"

    if teachers_without_card:
        notification_content += "<h4>⚠️ 未儲存卡片的用戶（需手動處理）：</h4><ul>"
        for teacher in teachers_without_card:
            period = teacher.current_period
            if period:
                days_left = (period.end_date - now_utc).days
                notification_content += f"""
                <li>{teacher.name} ({teacher.email})
                    - 到期日: {period.end_date.strftime('%Y-%m-%d')}
                    - 剩餘: {days_left} 天
            </li>
            """
        notification_content += "</ul>"

    notification_content += """
    <hr>
    <p><small>此為測試通知，不會執行任何扣款或資料修改。</small></p>
    """

    # 發送通知到官方信箱
    try:
        email_service.send_email(
            to_email="myduotopia@gmail.com",  # Duotopia 官方信箱
            subject=f"🧪 Cloud Scheduler 測試通知 - {now_taipei.strftime('%Y-%m-%d %H:%M')}",
            html_content=notification_content,
        )
        logger.info("✅ Test notification sent successfully")
    except Exception as e:
        logger.error(f"❌ Failed to send test notification: {e}")

    return {
        "status": "success",
        "timestamp": now_taipei.isoformat(),
        "statistics": {
            "total_expiring_soon": len(periods_expiring_soon),
            "with_card": len(teachers_with_card),
            "without_card": len(teachers_without_card),
        },
        "notification_sent": True,
        "message": "Test notification sent to myduotopia@gmail.com",
    }


@router.post("/recording-error-report")
async def recording_error_report_cron(
    x_cron_secret: str = Header(None), db: Session = Depends(get_db)
):
    """
    每小時檢查 BigQuery 錄音錯誤統計

    執行時間：每小時 (由 Cloud Scheduler 觸發)

    功能：
    1. 查詢 BigQuery 過去 24 小時和最近 1 小時的錄音錯誤
    2. 使用 OpenAI 生成錯誤摘要
    3. 發送統計報告到官網信箱 (myduotopia@gmail.com)

    安全性：只允許帶有正確 X-Cron-Secret header 的請求
    """
    # 驗證 Cron Secret
    if x_cron_secret != CRON_SECRET:
        logger.warning(
            f"Unauthorized cron request. Secret: {x_cron_secret[:10] if x_cron_secret else 'None'}..."
        )
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        # 初始化 BigQuery client
        client = bigquery.Client(project=os.getenv("GCP_PROJECT_ID"))

        # 台灣時區
        taipei_tz = timezone(timedelta(hours=8))
        now_taipei = datetime.now(taipei_tz)

        # 查詢最近 24 小時的錯誤（使用正確的 audio_playback_errors table）
        query_24h = f"""
        SELECT
            COUNT(*) as error_count,
            error_type,
            platform,
            browser,
            COUNT(DISTINCT student_id) as affected_students,
            ANY_VALUE(error_message) as sample_message
        FROM `{os.getenv("GCP_PROJECT_ID")}.duotopia_logs.audio_playback_errors`
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        GROUP BY error_type, platform, browser
        ORDER BY error_count DESC
        """

        # 查詢最近 1 小時的錯誤
        query_1h = f"""
        SELECT
            COUNT(*) as error_count,
            error_type,
            platform,
            browser,
            COUNT(DISTINCT student_id) as affected_students
        FROM `{os.getenv("GCP_PROJECT_ID")}.duotopia_logs.audio_playback_errors`
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
        GROUP BY error_type, platform, browser
        ORDER BY error_count DESC
        """

        results_24h = list(client.query(query_24h).result())
        results_1h = list(client.query(query_1h).result())

        total_errors_24h = sum(row.error_count for row in results_24h)
        total_errors_1h = sum(row.error_count for row in results_1h)

        # 🔥 查詢有錯誤的學生名單（含老師和班級資訊）
        query_student_ids = f"""
        SELECT
            student_id,
            COUNT(*) as error_count,
            STRING_AGG(DISTINCT error_type ORDER BY error_type LIMIT 5) as error_types
        FROM `{os.getenv("GCP_PROJECT_ID")}.duotopia_logs.audio_playback_errors`
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
            AND student_id IS NOT NULL
        GROUP BY student_id
        ORDER BY error_count DESC
        LIMIT 100
        """

        student_errors = list(client.query(query_student_ids).result())

        # 從 PostgreSQL 查詢學生、老師、班級資料
        students_with_errors = []
        if student_errors:
            engine = create_engine(os.getenv("DATABASE_URL"))
            SessionLocal = sessionmaker(bind=engine)
            db_session = SessionLocal()

            try:
                student_ids = [row.student_id for row in student_errors]

                # JOIN 學生、班級、老師資料
                students_data = (
                    db_session.query(
                        Student.id,
                        Student.name,
                        Student.email,
                        Classroom.name.label("classroom_name"),
                        Teacher.name.label("teacher_name"),
                        Teacher.email.label("teacher_email"),
                    )
                    .outerjoin(
                        ClassroomStudent, Student.id == ClassroomStudent.student_id
                    )
                    .outerjoin(Classroom, ClassroomStudent.classroom_id == Classroom.id)
                    .outerjoin(Teacher, Classroom.teacher_id == Teacher.id)
                    .filter(Student.id.in_(student_ids))
                    .all()
                )

                # 建立 student_id -> data 的 mapping
                student_data_map = {}
                for row in students_data:
                    if row.id not in student_data_map:
                        student_data_map[row.id] = {
                            "name": row.name,
                            "email": row.email,
                            "classrooms": [],
                            "teachers": set(),
                        }
                    if row.classroom_name:
                        student_data_map[row.id]["classrooms"].append(
                            row.classroom_name
                        )
                    if row.teacher_name and row.teacher_email:
                        student_data_map[row.id]["teachers"].add(
                            f"{row.teacher_name} ({row.teacher_email})"
                        )

                # 合併錯誤資料
                for error_row in student_errors:
                    student_data = student_data_map.get(error_row.student_id)
                    if student_data:
                        students_with_errors.append(
                            {
                                "student_id": error_row.student_id,
                                "student_name": student_data["name"],
                                "student_email": student_data["email"] or "（無 Email）",
                                "classrooms": ", ".join(student_data["classrooms"])
                                or "（無班級）",
                                "teachers": ", ".join(student_data["teachers"])
                                or "（無老師）",
                                "error_count": error_row.error_count,
                                "error_types": error_row.error_types,
                            }
                        )
                    else:
                        students_with_errors.append(
                            {
                                "student_id": error_row.student_id,
                                "student_name": "（未找到）",
                                "student_email": "（無 Email）",
                                "classrooms": "（無班級）",
                                "teachers": "（無老師）",
                                "error_count": error_row.error_count,
                                "error_types": error_row.error_types,
                            }
                        )
            finally:
                db_session.close()

        # 📊 查詢成功的錄音次數（從 PostgreSQL StudentItemProgress）
        # 最近 1 小時成功錄音 - 只計數，不需要 student_id
        success_count_1h = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.updated_at
                >= datetime.now(timezone.utc) - timedelta(hours=1),
                StudentItemProgress.recording_url.isnot(None),
            )
            .count()
        )

        # 最近 24 小時成功錄音
        success_count_24h = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.updated_at
                >= datetime.now(timezone.utc) - timedelta(hours=24),
                StudentItemProgress.recording_url.isnot(None),
            )
            .count()
        )

        # 📊 錄音統計（成功 + 錯誤）
        usage_stats_1h = {
            "error_users": len(
                set(row.student_id for row in results_1h if hasattr(row, "student_id"))
            ),
            "error_count": total_errors_1h,
            "success_count": success_count_1h,
        }

        usage_stats_24h = {
            "error_users": len(
                set(row.student_id for row in results_24h if hasattr(row, "student_id"))
            ),
            "error_count": total_errors_24h,
            "success_count": success_count_24h,
        }

        # 使用 Vertex AI (Gemini) 生成摘要（如果有錯誤）
        ai_summary = ""
        if total_errors_24h > 0:
            try:
                # 準備錯誤資料給 AI
                error_data = []
                for row in results_24h[:10]:  # 只取前 10 個最嚴重的錯誤
                    error_data.append(
                        {
                            "type": row.error_type,
                            "platform": row.platform,
                            "browser": row.browser,
                            "count": row.error_count,
                            "affected_students": row.affected_students,
                            "sample": row.sample_message
                            if row.sample_message
                            else "無錯誤訊息",
                        }
                    )

                prompt = f"""
你是 Duotopia 英語學習平台的技術顧問。以下是過去 24 小時的錄音播放錯誤統計資料：

{error_data}

請用繁體中文生成一份簡潔的錯誤分析摘要（3-5 句話），包含：
1. 主要問題類型（錄音播放相關）
2. 可能的原因（瀏覽器相容性、錄音時間、檔案大小等）
3. 建議的處理優先順序

請用專業但易懂的語言，不要使用 Markdown 格式。
"""

                # Use Vertex AI (Gemini)
                from services.vertex_ai import get_vertex_ai_service

                vertex_ai = get_vertex_ai_service()
                ai_summary = vertex_ai.generate_text_sync(
                    prompt=prompt,
                    model_type="flash",
                    max_tokens=300,
                    temperature=0.7,
                    system_instruction="你是 Duotopia 英語學習平台的技術顧問，擅長分析錄音播放錯誤。用繁體中文、專業但易懂的語言回覆，不要使用 Markdown 格式。",
                )

            except Exception as e:
                logger.warning(f"Failed to generate AI summary: {str(e)}")
                ai_summary = "（AI 摘要生成失敗）"

        # 構建郵件內容
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 800px; margin: 0 auto; padding: 20px; }}
                .header {{
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; padding: 20px; border-radius: 8px 8px 0 0;
                }}
                .content {{ background: #f9fafb; padding: 30px; }}
                .summary-box {{
                    background: #fff3cd; border-left: 4px solid #ffc107;
                    padding: 15px; margin: 20px 0; border-radius: 4px;
                }}
                .stats-box {{
                    background: white; border: 1px solid #e5e7eb;
                    border-radius: 8px; padding: 20px; margin: 15px 0;
                }}
                .error-item {{
                    background: #fee; border-left: 3px solid #dc3545;
                    padding: 10px; margin: 10px 0; border-radius: 4px;
                }}
                .success {{ color: #10b981; font-weight: bold; }}
                .warning {{ color: #f59e0b; font-weight: bold; }}
                .error {{ color: #dc3545; font-weight: bold; }}
                table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
                th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }}
                th {{ background: #f3f4f6; font-weight: 600; }}
                .footer {{ text-align: center; color: #6b7280; padding: 20px; font-size: 14px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 錄音錯誤監控報告</h1>
                    <p style="margin: 5px 0;">報告時間：{now_taipei.strftime('%Y年%m月%d日 %H:%M')} (台灣時間)</p>
                </div>
                <div class="content">
        """

        # AI 摘要區塊
        if ai_summary and total_errors_24h > 0:
            html_content += f"""
                    <div class="summary-box">
                        <h3>🤖 AI 分析摘要</h3>
                        <p>{ai_summary}</p>
                    </div>
            """

        # 📊 錄音統計概覽（成功 + 失敗）
        total_1h = usage_stats_1h["success_count"] + usage_stats_1h["error_count"]
        total_24h = usage_stats_24h["success_count"] + usage_stats_24h["error_count"]
        success_rate_1h = (
            round(usage_stats_1h["success_count"] / total_1h * 100, 1)
            if total_1h > 0
            else 100
        )
        success_rate_24h = (
            round(usage_stats_24h["success_count"] / total_24h * 100, 1)
            if total_24h > 0
            else 100
        )

        html_content += f"""
                    <div class="stats-box">
                        <h3>📊 錄音統計總覽</h3>
                        <table>
                            <tr>
                                <th>時間範圍</th>
                                <th>成功錄音</th>
                                <th>失敗錄音</th>
                                <th>成功率</th>
                            </tr>
                            <tr>
                                <td><strong>最近 1 小時</strong></td>
                                <td class="success">{usage_stats_1h['success_count']} 次</td>
                                <td class="{'error' if usage_stats_1h['error_count'] > 10
                                           else 'warning' if usage_stats_1h['error_count'] > 0
                                           else 'success'}">
                                    {usage_stats_1h['error_count']} 次
                                </td>
                                <td class="{'success' if success_rate_1h >= 95
                                           else 'warning' if success_rate_1h >= 90
                                           else 'error'}">
                                    {success_rate_1h}%
                                </td>
                            </tr>
                            <tr>
                                <td><strong>最近 24 小時</strong></td>
                                <td class="success">{usage_stats_24h['success_count']} 次</td>
                                <td class="{'error' if usage_stats_24h['error_count'] > 100
                                           else 'warning' if usage_stats_24h['error_count'] > 0
                                           else 'success'}">
                                    {usage_stats_24h['error_count']} 次
                                </td>
                                <td class="{'success' if success_rate_24h >= 95
                                           else 'warning' if success_rate_24h >= 90
                                           else 'error'}">
                                    {success_rate_24h}%
                                </td>
                            </tr>
                        </table>
                        <p style="color: #6b7280; font-size: 0.9em; margin-top: 10px;">
                            💡 成功次數來自 StudentItemProgress，錯誤來自 audio_playback_errors
                        </p>
                    </div>

                    <div class="stats-box">
                        <h3>🚨 錯誤嚴重程度</h3>
                        <table>
                            <tr>
                                <th>時間範圍</th>
                                <th>錯誤次數</th>
                                <th>狀態</th>
                            </tr>
                            <tr>
                                <td>最近 1 小時</td>
                                <td class="{'error' if total_errors_1h > 0 else 'success'}">
                                    {total_errors_1h}
                                </td>
                                <td>
                                    {'⚠️ 需注意' if total_errors_1h > 10
                                     else '✅ 正常' if total_errors_1h == 0
                                     else '⚡ 有少量錯誤'}
                                </td>
                            </tr>
                            <tr>
                                <td>最近 24 小時</td>
                                <td class="{'error' if total_errors_24h > 100
                                           else 'warning' if total_errors_24h > 0
                                           else 'success'}">
                                    {total_errors_24h}
                                </td>
                                <td>
                                    {'🚨 嚴重' if total_errors_24h > 100
                                     else '⚠️ 需注意' if total_errors_24h > 50
                                     else '✅ 正常' if total_errors_24h == 0
                                     else '⚡ 輕微'}
                                </td>
                            </tr>
                        </table>
                    </div>
        """

        # 最近 1 小時錯誤明細
        if total_errors_1h > 0:
            html_content += """
                    <div class="stats-box">
                        <h3>⏰ 最近 1 小時錯誤明細</h3>
            """
            for row in results_1h:
                html_content += f"""
                        <div class="error-item">
                            <strong>{row.error_type}</strong><br>
                            平台: {row.platform} | 瀏覽器: {row.browser}<br>
                            錯誤次數: {row.error_count} | 影響學生: {row.affected_students} 位
                        </div>
                """
            html_content += """
                    </div>
            """
        else:
            html_content += """
                    <div class="stats-box">
                        <h3>⏰ 最近 1 小時</h3>
                        <p class="success">✅ 沒有錄音錯誤</p>
                    </div>
            """

        # 最近 24 小時錯誤明細
        if total_errors_24h > 0:
            html_content += """
                    <div class="stats-box">
                        <h3>📅 最近 24 小時錯誤明細（前 10 項）</h3>
                        <table>
                            <tr>
                                <th>錯誤類型</th>
                                <th>平台</th>
                                <th>瀏覽器</th>
                                <th>次數</th>
                                <th>影響學生</th>
                            </tr>
            """
            for row in results_24h[:10]:
                html_content += f"""
                            <tr>
                                <td>{row.error_type}</td>
                                <td>{row.platform}</td>
                                <td>{row.browser}</td>
                                <td>{row.error_count}</td>
                                <td>{row.affected_students}</td>
                            </tr>
                """
            html_content += """
                        </table>
                    </div>
            """

        # 🔥 受影響學生名單（含老師和班級）
        if students_with_errors:
            html_content += f"""
                    <div class="stats-box">
                        <h3>👥 受影響學生名單（最近 24 小時，共 {len(students_with_errors)} 位）</h3>
                        <table style="font-size: 0.9em;">
                            <tr>
                                <th>ID</th>
                                <th>學生姓名</th>
                                <th>班級</th>
                                <th>老師</th>
                                <th>錯誤次數</th>
                                <th>錯誤類型</th>
                            </tr>
            """
            for student in students_with_errors:
                student_name = student["student_name"] or "（未設定）"
                classrooms = student.get("classrooms", "（無班級）")
                teachers = student.get("teachers", "（無老師）")
                error_types_display = (
                    student["error_types"][:80] + "..."
                    if len(student["error_types"]) > 80
                    else student["error_types"]
                )

                html_content += f"""
                            <tr>
                                <td>{student['student_id']}</td>
                                <td><strong>{student_name}</strong></td>
                                <td style="color: #059669;">{classrooms}</td>
                                <td style="color: #dc2626; font-size: 0.85em;">{teachers}</td>
                                <td style="text-align: center; font-weight: bold;">{student['error_count']}</td>
                                <td style="font-size: 0.85em; color: #666;">{error_types_display}</td>
                            </tr>
                """
            html_content += """
                        </table>
                        <p style="color: #6b7280; font-size: 0.9em; margin-top: 10px;">
                            💡 提示：可直接聯繫老師或學生確認使用環境，或主動排查技術問題
                        </p>
                    </div>
            """

        html_content += f"""
                </div>
                <div class="footer">
                    <p>此郵件由 Cloud Scheduler 每小時自動發送<br>
                    Duotopia 技術團隊 | {now_taipei.year}</p>
                </div>
            </div>
        </body>
        </html>
        """

        # 只在有錯誤時才發送郵件 (2026-02-23 改為 error-only)
        should_send_email = total_errors_1h > 0

        notification_sent = False
        if should_send_email:
            # 發送郵件
            subject_emoji = "🚨" if total_errors_1h > 10 else "⚠️"
            subject = (
                f"{subject_emoji} 錄音錯誤報告 - "
                f"{now_taipei.strftime('%m/%d %H:%M')} "
                f"(1H: {total_errors_1h} | 24H: {total_errors_24h})"
            )
            email_service.send_email(
                to_email="myduotopia@gmail.com",
                subject=subject,
                html_content=html_content,
            )
            notification_sent = True

            logger.info(
                f"Recording error report sent. 1H: {total_errors_1h}, 24H: {total_errors_24h}"
            )
        else:
            logger.info(
                f"No errors in past hour, skipping email. 1H: {total_errors_1h}, 24H: {total_errors_24h}"
            )

        return {
            "status": "success",
            "executed_at": now_taipei.isoformat(),
            "errors_1h": total_errors_1h,
            "errors_24h": total_errors_24h,
            "ai_summary_generated": bool(ai_summary),
            "notification_sent": notification_sent,
        }

    except Exception as e:
        logger.error(f"Recording error report failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to generate report: {str(e)}"
        )


@router.post("/expire-credit-packages")
async def expire_credit_packages_cron(
    x_cron_secret: str = Header(None), db: Session = Depends(get_db)
):
    """
    定期將過期的 CreditPackage 標記為 expired

    執行時間：每日凌晨 3:00（由 Cloud Scheduler 觸發）

    功能：
    1. 查詢所有 status='active' 且 expires_at < now 的 CreditPackage
    2. 將 status 設為 'expired'
    3. 記錄過期處理結果
    """
    if x_cron_secret != CRON_SECRET:
        logger.warning(f"Unauthorized cron request. Secret: {x_cron_secret[:10]}...")
        raise HTTPException(status_code=401, detail="Unauthorized")

    from models.credit_package import CreditPackage

    now = datetime.now(timezone.utc)

    try:
        expired_packages = (
            db.query(CreditPackage)
            .filter(
                CreditPackage.status == "active",
                CreditPackage.expires_at <= now,
            )
            .all()
        )

        expired_count = len(expired_packages)
        for pkg in expired_packages:
            pkg.status = "expired"
            logger.info(
                f"CreditPackage {pkg.id} expired: "
                f"teacher_id={pkg.teacher_id}, org_id={pkg.organization_id}, "
                f"points_remaining={pkg.points_remaining}, expires_at={pkg.expires_at}"
            )

        db.commit()

        logger.info(
            f"Credit package expiry cron completed: {expired_count} packages expired"
        )

        return {
            "success": True,
            "expired_count": expired_count,
            "timestamp": now.isoformat(),
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Credit package expiry cron failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Cron job failed: {str(e)}")


@router.post("/billing-overdue-check")
async def billing_overdue_check_cron(
    x_cron_secret: str = Header(None),
    db: Session = Depends(get_db),
):
    """機構應收帳款逾期掃描（issue #838 Phase D）。

    執行時間：每日一次（由 Cloud Scheduler 觸發，建議 09:00 Asia/Taipei）。
    功能：把所有 status='pending' 且 due_date < 今日（Taipei）的
    institution_invoices 標記為 'overdue'。冪等 — 同日重跑不會重複處理。

    安全性：需帶正確的 X-Cron-Secret header。
    """
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        updated = mark_overdue_invoices(db)
        logger.info(f"Billing overdue check: marked {updated} invoice(s) overdue")
        return {
            "success": True,
            "marked_overdue": updated,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Billing overdue check cron failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Cron job failed: {str(e)}")


@router.get("/health")
async def cron_health_check():
    """
    Cron 健康檢查

    用於確認 Cron API 是否正常運作
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cron_secret_configured": bool(
            CRON_SECRET and CRON_SECRET != "dev-secret-change-me"
        ),
    }
