"""Email 服務 - 處理 email 驗證和通知"""

import os
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib

from sqlalchemy.orm import Session

from models import Student, Teacher

logger = logging.getLogger(__name__)


class EmailService:
    """Email 服務類別"""

    def __init__(self):
        # 從環境變數讀取 SMTP 設定
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = os.getenv("SMTP_USER", "")
        self.smtp_password = os.getenv("SMTP_PASSWORD", "")
        self.from_email = os.getenv("FROM_EMAIL", "noreply@duotopia.com")
        self.from_name = os.getenv("FROM_NAME", "Duotopia")
        self.frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")

    def send_email(self, to_email: str, subject: str, html_content: str) -> bool:
        """
        發送通用 HTML 郵件

        Args:
            to_email: 收件者 email
            subject: 郵件主旨
            html_content: HTML 格式的郵件內容

        Returns:
            bool: 是否發送成功
        """
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = to_email

            html_part = MIMEText(html_content, "html", "utf-8")
            msg.attach(html_part)

            # 如果 SMTP 未設定，只記錄日誌（開發模式）
            if not self.smtp_user or not self.smtp_password:
                logger.info(f"[開發模式] Email: {subject} -> {to_email}")
                print(f"\n📧 [開發模式] Email 已發送到: {to_email}")
                print(f"📝 主旨: {subject}")
                return True

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {str(e)}")
            return False

    def generate_verification_token(self) -> str:
        """生成驗證 token"""
        return secrets.token_urlsafe(32)

    def send_verification_email(
        self, db: Session, student: Student, email: str = None
    ) -> bool:
        """發送驗證 email

        Args:
            db: 資料庫 session
            student: 學生物件
            email: 要驗證的 email（若無則使用 student.email）

        Returns:
            是否成功發送
        """
        try:
            # 使用提供的 email 或學生現有的 email
            target_email = email or student.email

            # 生成驗證 token
            token = self.generate_verification_token()

            # 更新學生資料
            if email and student.email != email:
                student.email = email  # 更新 email
            student.email_verification_token = token
            student.email_verification_sent_at = datetime.utcnow()
            db.commit()

            # 建立驗證連結
            verification_url = f"{self.frontend_url}/verify-email?token={token}"

            # 建立 email 內容
            subject = f"【Duotopia】請驗證您的 Email - {student.name} 的學習帳號"

            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background-color: #4A90E2; color: white; padding: 20px;
                               text-align: center; border-radius: 10px 10px 0 0; }}
                    .content {{ background-color: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }}
                    .button {{ display: inline-block; padding: 12px 30px; background-color: #4A90E2;
                               color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
                    .footer {{ text-align: center; margin-top: 30px;
                               font-size: 12px; color: #666; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Duotopia Email 驗證</h1>
                    </div>
                    <div class="content">
                        <h2>親愛的家長您好，</h2>
                        <p>您的孩子 <strong>{student.name}</strong> 在 Duotopia 英語學習平台的帳號需要驗證您的 Email。</p>
                        <p>驗證後，您將可以：</p>
                        <ul>
                            <li>📧 收到學習進度通知</li>
                            <li>📊 查看每週學習報告</li>
                            <li>🎯 了解孩子的學習成就</li>
                        </ul>
                        <p>請點擊下方按鈕完成驗證：</p>
                        <div style="text-align: center;">
                            <a href="{verification_url}" class="button">驗證 Email</a>
                        </div>
                        <p style="font-size: 12px; color: #666;">
                            如果按鈕無法點擊，請複製以下連結到瀏覽器：<br>
                            <a href="{verification_url}" style="color: #4A90E2; word-break: break-all;">
                                {verification_url}</a>
                        </p>
                        <p style="font-size: 12px; color: #666;">
                            此驗證連結將在 24 小時後失效。
                        </p>
                    </div>
                    <div class="footer">
                        <p>© 2025 Duotopia. All rights reserved.</p>
                        <p>如果您沒有申請此驗證，請忽略此信件。</p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 如果 SMTP 未設定，只記錄日誌（開發模式）
            if not self.smtp_user or not self.smtp_password:
                logger.info(f"開發模式：驗證連結 - {verification_url}")
                print("\n📧 驗證 Email 已發送（開發模式）")
                print(f"   收件人: {target_email}")
                print(f"   學生: {student.name}")
                print(f"   驗證連結: {verification_url}\n")
                return True

            # 發送實際 email
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = target_email

            msg.attach(MIMEText(html_content, "html"))

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"驗證 email 已發送到 {target_email}")
            return True

        except Exception as e:
            logger.error(f"發送驗證 email 失敗: {str(e)}")
            return False

    def verify_email_token(self, db: Session, token: str) -> Optional[Student]:
        """驗證 email token

        Args:
            db: 資料庫 session
            token: 驗證 token

        Returns:
            驗證成功的學生物件，或 None
        """
        try:
            # 查找擁有此 token 的學生 (直接比對，不需要 hash)
            student = (
                db.query(Student)
                .filter(Student.email_verification_token == token)
                .first()
            )

            if not student:
                return None

            # 檢查 token 是否過期（24 小時）
            if student.email_verification_sent_at:
                # 處理時區問題：確保兩個時間都是 UTC
                now_utc = datetime.utcnow().replace(tzinfo=None)
                sent_at = (
                    student.email_verification_sent_at.replace(tzinfo=None)
                    if student.email_verification_sent_at.tzinfo
                    else student.email_verification_sent_at
                )
                time_diff = now_utc - sent_at
                if time_diff > timedelta(hours=24):
                    logger.warning(f"Token 已過期: {token}")
                    return None

            # 標記為已驗證（包含所有同 email 的學生記錄）
            now = datetime.utcnow()
            student.email_verified = True
            student.email_verified_at = now
            student.email_verification_token = None  # 清除 token

            # 同步更新所有同 email 的其他學生記錄
            if student.email:
                siblings = (
                    db.query(Student)
                    .filter(
                        Student.email == student.email,
                        Student.id != student.id,
                        Student.is_active.is_(True),
                    )
                    .all()
                )
                for sibling in siblings:
                    if not sibling.email_verified:
                        sibling.email_verified = True
                        sibling.email_verified_at = now

            db.commit()

            logger.info(f"Email 驗證成功: {student.email}")
            return student

        except Exception as e:
            logger.error(f"驗證 email token 失敗: {str(e)}")
            db.rollback()
            return None

    def resend_verification_email(self, db: Session, student: Student) -> bool:
        """重新發送驗證 email

        Args:
            db: 資料庫 session
            student: 學生物件

        Returns:
            是否成功發送
        """
        # 檢查是否已經驗證
        if student.email_verified:
            return False

        # 檢查是否有 email
        if not student.email:
            return False

        # 檢查發送頻率限制（5 分鐘內不能重複發送）
        if student.email_verification_sent_at:
            time_diff = datetime.utcnow() - student.email_verification_sent_at
            if time_diff < timedelta(minutes=5):
                logger.warning(f"發送過於頻繁: {student.email}")
                return False

        # 重新發送
        return self.send_verification_email(db, student)

    # ========== 教師 Email 驗證功能 ==========

    def send_teacher_verification_email(self, db: Session, teacher: Teacher) -> bool:
        """發送教師驗證 email

        Args:
            db: 資料庫 session
            teacher: 教師物件

        Returns:
            是否成功發送
        """
        try:
            # 生成新的驗證 token
            verification_token = self.generate_verification_token()

            # 更新教師的驗證資訊
            teacher.email_verification_token = verification_token
            teacher.email_verification_sent_at = datetime.utcnow()
            db.commit()

            # 構建驗證連結
            verification_url = (
                f"{self.frontend_url}/teacher/verify-email?token={verification_token}"
            )

            # 構建 email 內容
            html_content = f"""
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: #2563eb; color: white; padding: 20px;
                        text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #2563eb; color: white;
                        padding: 12px 24px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; }}
                    .warning {{ background: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎉 歡迎加入 Duotopia！</h1>
                    </div>
                    <div class="content">
                        <h2>親愛的 {teacher.name} 老師：</h2>

                        <p>感謝您註冊 Duotopia 教學平台！為了確保您的帳號安全，請點擊下方按鈕完成 email 驗證：</p>

                        <p style="text-align: center; margin: 30px 0;">
                            <a href="{verification_url}" class="button">驗證我的 Email</a>
                        </p>

                        <div class="warning">
                            <strong>🎁 專屬福利：</strong><br>
                            完成 email 驗證後，您將立即獲得 <strong>30 天免費試用</strong>，可以使用 Duotopia 的所有功能！
                        </div>

                        <p>驗證完成後，您可以：</p>
                        <ul>
                            <li>✅ 創建和管理班級</li>
                            <li>✅ 指派作業給學生</li>
                            <li>✅ 使用 AI 輔助批改功能</li>
                            <li>✅ 追蹤學生學習進度</li>
                        </ul>

                        <p><small>此驗證連結將在 24 小時後失效。如果您沒有申請此帳號，請忽略此信件。</small></p>

                        <hr style="margin: 30px 0;">
                        <p style="color: #6b7280; font-size: 14px;">
                            Duotopia 團隊<br>
                            讓英語學習更有趣！
                        </p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 純文字版本
            text_content = f"""
            歡迎加入 Duotopia！

            親愛的 {teacher.name} 老師：

            感謝您註冊 Duotopia 教學平台！請點擊以下連結完成 email 驗證：

            {verification_url}

            完成驗證後，您將獲得 30 天免費試用，可以使用 Duotopia 的所有功能！

            此驗證連結將在 24 小時後失效。

            Duotopia 團隊
            """

            # 創建 email 訊息
            msg = MIMEMultipart("alternative")
            msg["Subject"] = "Duotopia - 請驗證您的 Email 地址"
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = teacher.email

            # 添加內容
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            # 如果 SMTP 未設定，只記錄日誌（開發模式）
            if not self.smtp_user or not self.smtp_password:
                logger.info(f"開發模式：教師驗證連結 - {verification_url}")
                print("\n📧 教師驗證 Email 已發送（開發模式）")
                print(f"   收件人: {teacher.email}")
                print(f"   教師: {teacher.name}")
                print(f"   驗證連結: {verification_url}\n")
                return True

            # 發送實際 email
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"教師驗證 email 已發送到 {teacher.email}")
            return True

        except Exception as e:
            logger.error(f"發送教師驗證 email 失敗: {str(e)}")
            return False

    def send_teacher_bind_email(
        self,
        target_email: str,
        teacher_name: str,
        bind_token: str,
    ) -> bool:
        """Send a bind verification email to a teacher's target Duotopia email.

        Unlike send_teacher_verification_email, this does NOT modify the
        teacher record — the bind_token is already stored by the caller.
        """
        try:
            verification_url = (
                f"{self.frontend_url}/1campus-verify-bind?token={bind_token}"
            )

            subject = f"【Duotopia】帳號綁定驗證 - {teacher_name}"
            html_content = f"""
            <html><head><meta charset="UTF-8">
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: #2563eb; color: white; padding: 20px;
                    text-align: center; border-radius: 8px 8px 0 0; }}
                .content {{ background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }}
                .button {{ display: inline-block; background: #2563eb; color: white;
                    padding: 12px 24px; text-decoration: none; border-radius: 6px; }}
            </style></head><body>
            <div class="container">
                <div class="header"><h1>Duotopia 帳號綁定</h1></div>
                <div class="content">
                    <h2>親愛的 {teacher_name} 老師：</h2>
                    <p>您正在將學校帳號（1Campus）與此 Duotopia 帳號綁定。</p>
                    <p>請點擊下方按鈕完成驗證：</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="{verification_url}" class="button">確認綁定</a>
                    </p>
                    <p><small>此連結將在 10 分鐘後失效。如果您沒有申請此綁定，請忽略此信件。</small></p>
                </div>
            </div></body></html>
            """

            if not self.smtp_user or not self.smtp_password:
                logger.info(f"開發模式：教師綁定驗證連結 - {verification_url}")
                print(f"\n📧 教師綁定驗證 Email（開發模式）")
                print(f"   收件人: {target_email}")
                print(f"   教師: {teacher_name}")
                print(f"   驗證連結: {verification_url}\n")
                return True

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = target_email
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"教師綁定驗證 email 已發送到 {target_email}")
            return True

        except Exception as e:
            logger.error(f"發送教師綁定驗證 email 失敗: {str(e)}")
            return False

    def verify_teacher_email_token(self, db: Session, token: str) -> Optional[Teacher]:
        """驗證教師 email token 並啟動訂閱

        Args:
            db: 資料庫 session
            token: 驗證 token

        Returns:
            驗證成功的教師物件，或 None
        """
        try:
            # 查找擁有此 token 的教師
            teacher = (
                db.query(Teacher)
                .filter(Teacher.email_verification_token == token)
                .first()
            )

            if not teacher:
                return None

            # 檢查 token 是否過期（24 小時）
            if teacher.email_verification_sent_at:
                now_utc = datetime.utcnow().replace(tzinfo=None)
                sent_at = (
                    teacher.email_verification_sent_at.replace(tzinfo=None)
                    if teacher.email_verification_sent_at.tzinfo
                    else teacher.email_verification_sent_at
                )
                time_diff = now_utc - sent_at
                if time_diff > timedelta(hours=24):
                    logger.warning(f"教師驗證 token 已過期: {token}")
                    return None

            # 標記為已驗證並啟動帳號
            teacher.email_verified = True
            teacher.email_verified_at = datetime.utcnow()
            teacher.email_verification_token = None
            teacher.is_active = True

            # 🎯 重要：啟動免費試用！創建 CreditPackage（trial_bonus）
            from config.plans import TRIAL_QUOTA, TRIAL_DAYS
            from models.credit_package import CreditPackage

            now = datetime.now(timezone.utc)

            trial_package = CreditPackage(
                teacher_id=teacher.id,
                package_id="trial-bonus",
                points_total=TRIAL_QUOTA,
                points_used=0,
                price_paid=0,
                purchased_at=now,
                expires_at=now + timedelta(days=TRIAL_DAYS),
                status="active",
                source="trial_bonus",
            )
            db.add(trial_package)

            db.commit()

            logger.info(f"教師 email 驗證成功並啟動免費試用訂閱: {teacher.email}")
            return teacher

        except Exception as e:
            logger.error(f"驗證教師 email token 失敗: {str(e)}")
            db.rollback()
            return None

    def resend_teacher_verification_email(self, db: Session, teacher: Teacher) -> bool:
        """重新發送教師驗證 email

        Args:
            db: 資料庫 session
            teacher: 教師物件

        Returns:
            是否成功發送
        """
        # 檢查是否已驗證
        if teacher.email_verified:
            return False

        # 檢查發送頻率限制（5 分鐘內不能重複發送）
        if teacher.email_verification_sent_at:
            now_utc = datetime.utcnow().replace(tzinfo=None)
            sent_at = (
                teacher.email_verification_sent_at.replace(tzinfo=None)
                if teacher.email_verification_sent_at.tzinfo
                else teacher.email_verification_sent_at
            )
            time_diff = now_utc - sent_at
            if time_diff < timedelta(minutes=5):
                logger.warning(f"教師驗證信發送過於頻繁: {teacher.email}")
                return False

        # 重新發送
        return self.send_teacher_verification_email(db, teacher)

    # ========== 密碼設定功能（新帳號） ==========

    def send_password_setup_email(
        self, db: Session, teacher: Teacher, organization_name: str
    ) -> bool:
        """發送密碼設定郵件（給機構邀請的新教師）

        Args:
            db: 資料庫 session
            teacher: 教師物件
            organization_name: 邀請的機構名稱

        Returns:
            是否成功發送
        """
        try:
            # 生成密碼設定 token（重用 password_reset 欄位）
            setup_token = self.generate_verification_token()

            # 更新教師的設定資訊
            teacher.password_reset_token = setup_token
            teacher.password_reset_sent_at = datetime.utcnow()
            teacher.password_reset_expires_at = datetime.utcnow() + timedelta(
                hours=48
            )  # 48小時後過期（新帳號給較長時間）
            db.commit()

            # 構建密碼設定連結
            setup_url = (
                f"{self.frontend_url}/teacher/setup-password?token={setup_token}"
            )

            # 構建 HTML 內容
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }}
                    .content {{ background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }}
                    .button {{ display: inline-block; background: #667eea; color: white;
                        padding: 14px 32px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; }}
                    .info-box {{ background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0;
                                 border-left: 4px solid #667eea; }}
                    .footer {{ text-align: center; color: #6b7280; padding: 20px; font-size: 12px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎉 歡迎加入 {organization_name}！</h1>
                    </div>
                    <div class="content">
                        <h2>您好，{teacher.name}！</h2>

                        <p><strong>{organization_name}</strong> 的管理員已將您加入 Duotopia 英語學習平台。</p>

                        <div class="info-box">
                            <p style="margin: 0;"><strong>📧 您的帳號：</strong> {teacher.email}</p>
                        </div>

                        <p>為了開始使用，請點擊下方按鈕設定您的密碼：</p>

                        <div style="text-align: center; margin: 30px 0;">
                            <a href="{setup_url}" class="button" style="color: white;">設定密碼並開始使用</a>
                        </div>

                        <div style="background-color: #f0fdf4; border-left: 4px solid #10b981;
                                    padding: 15px; margin: 20px 0;">
                            <p style="margin: 0;"><strong>✨ 設定密碼後，您將可以：</strong></p>
                            <ul style="margin: 10px 0;">
                                <li>✅ 登入 Duotopia 教學平台</li>
                                <li>✅ 管理班級和學生</li>
                                <li>✅ 指派和批改作業</li>
                                <li>✅ 追蹤學生學習進度</li>
                            </ul>
                        </div>

                        <p style="color: #666; font-size: 14px;">
                            如果按鈕無法點擊，請複製以下連結到瀏覽器：<br>
                            <code style="background: #e5e7eb; padding: 4px 8px;
                                         border-radius: 4px; font-size: 12px; word-break: break-all;">
                                {setup_url}
                            </code>
                        </p>

                        <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b;
                                    padding: 15px; margin: 20px 0;">
                            <p style="margin: 0;"><strong>⏰ 注意事項：</strong></p>
                            <ul style="margin: 10px 0;">
                                <li>此連結將在 48 小時後失效</li>
                                <li>如有任何問題，請聯繫 {organization_name} 的管理員</li>
                            </ul>
                        </div>

                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

                        <p style="color: #999; font-size: 12px; text-align: center;">
                            此為系統自動發送的郵件，請勿回覆<br>
                            © 2025 Duotopia - AI 驅動的英語學習平台
                        </p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 純文字版本
            text_content = f"""
            歡迎加入 {organization_name}！

            您好，{teacher.name}！

            {organization_name} 的管理員已將您加入 Duotopia 英語學習平台。

            您的帳號：{teacher.email}

            請使用以下連結設定您的密碼：
            {setup_url}

            設定密碼後，您將可以登入並開始使用 Duotopia 的所有功能。

            此連結將在 48 小時後失效。

            Duotopia 團隊
            """

            # 創建 email 訊息
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"[Duotopia] 歡迎加入 {organization_name} - 請設定您的密碼"
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = teacher.email

            # 添加內容
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            # 如果 SMTP 未設定，只記錄日誌（開發模式）
            if not self.smtp_user or not self.smtp_password:
                logger.info(f"[開發模式] 密碼設定連結: {setup_url}")
                print(f"\n📧 [開發模式] 密碼設定 Email 已發送到: {teacher.email}")
                print(f"👤 教師: {teacher.name}")
                print(f"🏢 機構: {organization_name}")
                print(f"🔗 密碼設定連結: {setup_url}\n")
                return True

            # 發送 email
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"密碼設定郵件已發送到: {teacher.email} (機構: {organization_name})")
            return True

        except Exception as e:
            logger.error(
                f"發送密碼設定郵件失敗 ({teacher.email}, 機構: {organization_name}): {str(e)}"
            )
            return False

    # ========== 密碼重設功能 ==========

    def send_password_reset_email(self, db: Session, teacher: Teacher) -> bool:
        """發送密碼重設郵件

        Args:
            db: 資料庫 session
            teacher: 教師物件

        Returns:
            是否成功發送
        """
        try:
            # 生成新的重設 token
            reset_token = self.generate_verification_token()

            # 更新教師的重設資訊
            teacher.password_reset_token = reset_token
            teacher.password_reset_sent_at = datetime.utcnow()
            teacher.password_reset_expires_at = datetime.utcnow() + timedelta(
                hours=2
            )  # 2小時後過期
            db.commit()

            # 構建重設連結
            reset_url = (
                f"{self.frontend_url}/teacher/reset-password?token={reset_token}"
            )

            # 構建 HTML 內容
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: #2563eb; color: white; padding: 20px;
                        text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #2563eb; color: white;
                        padding: 12px 24px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; }}
                    .warning {{ background: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Duotopia - 密碼重設</h1>
                    </div>
                    <div class="content">
                        <h2>您好，{teacher.name}！</h2>
                        <p>我們收到了您的密碼重設請求。</p>

                        <p>請點擊下方按鈕重設您的密碼：</p>

                        <div style="text-align: center; margin: 30px 0;">
                            <a href="{reset_url}" class="button" style="color: white;">重設密碼</a>
                        </div>

                        <div class="warning">
                            <strong>⚠️ 安全提醒：</strong><br>
                            • 此連結將在 2 小時後失效<br>
                            • 如果您沒有要求重設密碼，請忽略此郵件<br>
                            • 請勿將此連結分享給他人
                        </div>

                        <p style="color: #666; font-size: 14px;">
                            如果按鈕無法點擊，請複製以下連結到瀏覽器：<br>
                            <code>{reset_url}</code>
                        </p>

                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

                        <p style="color: #999; font-size: 12px; text-align: center;">
                            此為系統自動發送的郵件，請勿回覆<br>
                            © 2024 Duotopia - AI 驅動的英語學習平台
                        </p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 純文字版本
            text_content = f"""
            您好，{teacher.name}！

            我們收到了您的密碼重設請求。

            請使用以下連結重設您的密碼：
            {reset_url}

            此連結將在 2 小時後失效。

            如果您沒有要求重設密碼，請忽略此郵件。

            Duotopia 團隊
            """

            # 創建 email 訊息
            msg = MIMEMultipart("alternative")
            msg["Subject"] = "Duotopia - 重設您的密碼"
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = teacher.email

            # 添加內容
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            # 如果 SMTP 未設定，只記錄日誌（開發模式）
            if not self.smtp_user or not self.smtp_password:
                logger.info(f"[開發模式] 密碼重設連結: {reset_url}")
                print(f"\n📧 [開發模式] 密碼重設 Email 已發送到: {teacher.email}")
                print(f"🔗 密碼重設連結: {reset_url}")
                return True

            # 發送 email
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"密碼重設郵件已發送到: {teacher.email}")
            return True

        except Exception as e:
            logger.error(f"發送密碼重設郵件失敗 ({teacher.email}): {str(e)}")
            return False

    def send_student_password_reset_email(self, db: Session, student: Student) -> bool:
        """發送學生密碼重設郵件

        Args:
            db: 資料庫 session
            student: 學生物件

        Returns:
            是否成功發送
        """
        try:
            # 生成新的重設 token
            reset_token = self.generate_verification_token()

            # 更新學生的重設資訊
            student.password_reset_token = reset_token
            student.password_reset_sent_at = datetime.utcnow()
            student.password_reset_expires_at = datetime.utcnow() + timedelta(
                hours=2
            )  # 2小時後過期
            db.commit()

            # 構建重設連結
            reset_url = (
                f"{self.frontend_url}/student/reset-password?token={reset_token}"
            )

            # 構建 HTML 內容
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: #10b981; color: white; padding: 20px;
                        text-align: center; border-radius: 8px 8px 0 0; }}
                    .content {{ background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }}
                    .button {{ display: inline-block; background: #10b981; color: white;
                        padding: 12px 24px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; }}
                    .warning {{ background: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Duotopia - 密碼重設</h1>
                    </div>
                    <div class="content">
                        <h2>您好，{student.name}！</h2>
                        <p>我們收到了您的密碼重設請求。</p>

                        <p>請點擊下方按鈕重設您的密碼：</p>

                        <div style="text-align: center; margin: 30px 0;">
                            <a href="{reset_url}" class="button" style="color: white;">重設密碼</a>
                        </div>

                        <div class="warning">
                            <strong>⚠️ 安全提醒：</strong><br>
                            • 此連結將在 2 小時後失效<br>
                            • 如果您沒有要求重設密碼，請忽略此郵件<br>
                            • 請勿將此連結分享給他人
                        </div>

                        <p style="color: #666; font-size: 14px;">
                            如果按鈕無法點擊，請複製以下連結到瀏覽器：<br>
                            <code>{reset_url}</code>
                        </p>

                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

                        <p style="color: #999; font-size: 12px; text-align: center;">
                            此為系統自動發送的郵件，請勿回覆<br>
                            © 2024 Duotopia - AI 驅動的英語學習平台
                        </p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 純文字版本
            text_content = f"""
            您好，{student.name}！

            我們收到了您的密碼重設請求。

            請使用以下連結重設您的密碼：
            {reset_url}

            此連結將在 2 小時後失效。

            如果您沒有要求重設密碼，請忽略此郵件。

            Duotopia 團隊
            """

            # 創建 email 訊息
            msg = MIMEMultipart("alternative")
            msg["Subject"] = "Duotopia - 重設您的密碼"
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = student.email

            # 添加內容
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            # 如果 SMTP 未設定，只記錄日誌（開發模式）
            if not self.smtp_user or not self.smtp_password:
                logger.info(f"[開發模式] 學生密碼重設連結: {reset_url}")
                print(f"\n📧 [開發模式] 學生密碼重設 Email 已發送到: {student.email}")
                print(f"🔗 密碼重設連結: {reset_url}")
                return True

            # 發送 email
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"學生密碼重設郵件已發送到: {student.email}")
            return True

        except Exception as e:
            logger.error(f"發送學生密碼重設郵件失敗 ({student.email}): {str(e)}")
            return False

    def send_refund_notification(
        self,
        teacher_email: str,
        teacher_name: str,
        refund_amount: float,
        original_amount: float,
        refund_type: str,
        subscription_type: str,
        days_deducted: int,
        new_end_date: datetime,
    ) -> bool:
        """
        發送退款通知郵件

        Args:
            teacher_email: 教師 email
            teacher_name: 教師姓名
            refund_amount: 退款金額
            original_amount: 原始交易金額
            refund_type: 退款類型 (full/partial)
            subscription_type: 訂閱方案
            days_deducted: 扣除天數
            new_end_date: 新到期日

        Returns:
            是否成功發送
        """
        try:
            # 建立 HTML 郵件內容
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{
                        background-color: #4F46E5; color: white;
                        padding: 20px; text-align: center;
                    }}
                    .content {{ background-color: #f9fafb; padding: 30px; }}
                    .info-box {{
                        background-color: #fff; border: 1px solid #e5e7eb;
                        border-radius: 8px; padding: 20px; margin: 20px 0;
                    }}
                    .amount {{
                        font-size: 24px; font-weight: bold; color: #DC2626;
                    }}
                    .footer {{
                        text-align: center; color: #6b7280;
                        padding: 20px; font-size: 14px;
                    }}
                    .button {{
                        background-color: #4F46E5; color: white;
                        padding: 12px 24px; text-decoration: none;
                        border-radius: 6px; display: inline-block;
                        margin: 20px 0;
                    }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Duotopia 退款通知</h1>
                    </div>
                    <div class="content">
                        <p>親愛的 {teacher_name} 老師，您好：</p>

                        <p>您的訂閱退款已完成處理，以下是退款詳情：</p>

                        <div class="info-box">
                            <h3>💰 退款資訊</h3>
                            <p><strong>退款金額：</strong><span class="amount">NT$ {int(refund_amount)}</span></p>
                            <p><strong>原始金額：</strong>NT$ {int(original_amount)}</p>
                            <p><strong>退款類型：</strong>{'全額退款' if refund_type == 'full' else '部分退款'}</p>
                            <p><strong>訂閱方案：</strong>{subscription_type}</p>
                        </div>

                        <div class="info-box">
                            <h3>📅 訂閱調整</h3>
                            <p><strong>扣除天數：</strong>{days_deducted} 天</p>
                            <p><strong>新到期日：</strong>{new_end_date.strftime('%Y年%m月%d日')}</p>
                        </div>

                        <p>退款金額將在 7-14 個工作天內退回您的原付款方式。</p>

                        <p>如有任何問題，請透過 LINE 客服聯繫我們。</p>

                        <center>
                            <a href="{self.frontend_url}/subscription" class="button">查看訂閱狀態</a>
                        </center>
                    </div>
                    <div class="footer">
                        <p>此郵件由系統自動發送，請勿直接回覆。</p>
                        <p>&copy; 2025 Duotopia. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 建立郵件
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"Duotopia 退款通知 - NT$ {int(refund_amount)}"
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = teacher_email

            # 加入 HTML 內容
            html_part = MIMEText(html_content, "html", "utf-8")
            msg.attach(html_part)

            # 發送郵件
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"✅ Refund notification email sent to: {teacher_email}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send refund notification email: {str(e)}")
            return False

    def send_renewal_success(
        self,
        teacher_email: str,
        teacher_name: str,
        new_end_date: datetime,
        plan_name: str,
    ) -> bool:
        """
        發送續訂成功通知

        Args:
            teacher_email: 老師 Email
            teacher_name: 老師姓名
            new_end_date: 新的到期日
            plan_name: 方案名稱
        """
        try:
            subject = "✅ Duotopia 訂閱已自動續訂"

            html_content = f"""
            <h2>訂閱續訂成功</h2>
            <p>親愛的 {teacher_name} 老師，您好：</p>

            <p>您的 Duotopia 訂閱已自動續訂成功！</p>

            <div style="background-color: #f0f9ff; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0;">
                <p><strong>方案資訊</strong></p>
                <p>訂閱方案：{plan_name}</p>
                <p>新到期日：{new_end_date.strftime('%Y年%m月%d日')}</p>
            </div>

            <p>感謝您持續支持 Duotopia！</p>

            <p>如有任何問題，請隨時聯繫我們。</p>

            <hr style="margin: 30px 0;">
            <p style="color: #666; font-size: 12px;">
                此為系統自動發送的郵件，請勿直接回覆。<br>
                Duotopia 英語學習平台
            </p>
            """

            self.send_email(teacher_email, subject, html_content)
            logger.info(f"✅ Renewal success email sent to {teacher_email}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send renewal success email: {str(e)}")
            return False

    def send_renewal_reminder(
        self,
        teacher_email: str,
        teacher_name: str,
        end_date: datetime,
        days_remaining: int,
        plan_name: str,
    ) -> bool:
        """
        發送續訂提醒

        Args:
            teacher_email: 老師 Email
            teacher_name: 老師姓名
            end_date: 到期日
            days_remaining: 剩餘天數
            plan_name: 方案名稱
        """
        try:
            subject = f"⏰ Duotopia 訂閱將於 {days_remaining} 天後到期"

            html_content = f"""
            <h2>訂閱即將到期提醒</h2>
            <p>親愛的 {teacher_name} 老師，您好：</p>

            <p>您的 Duotopia 訂閱即將到期，請留意以下資訊：</p>

            <div style="background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
                <p><strong>訂閱資訊</strong></p>
                <p>訂閱方案：{plan_name}</p>
                <p>到期日：{end_date.strftime('%Y年%m月%d日')}</p>
                <p>剩餘天數：<strong>{days_remaining} 天</strong></p>
            </div>

            <p>由於您已開啟自動續訂，系統將於到期日自動延長您的訂閱。</p>

            <p>如需取消自動續訂，請至「訂閱管理」頁面進行設定。</p>

            <hr style="margin: 30px 0;">
            <p style="color: #666; font-size: 12px;">
                此為系統自動發送的郵件，請勿直接回覆。<br>
                Duotopia 英語學習平台
            </p>
            """

            self.send_email(teacher_email, subject, html_content)
            logger.info(f"✅ Renewal reminder email sent to {teacher_email}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send renewal reminder email: {str(e)}")
            return False

    def send_billing_daily_summary(
        self,
        admin_email: str,
        admin_name: str,
        billing_data: dict,
        analysis: dict,
    ) -> bool:
        """
        發送每日帳單摘要郵件

        Args:
            admin_email: 管理員 Email
            admin_name: 管理員姓名
            billing_data: 帳單數據（來自 billing_service）
            analysis: AI 分析結果

        Returns:
            是否成功發送
        """
        try:
            # 建立服務費用排行表格
            top_services_rows = ""
            for service in billing_data.get("top_services", [])[:5]:
                service_name = service.get("service", "Unknown")
                cost = service.get("cost", 0)
                top_services_rows += f"""
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">{service_name}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">
                        ${cost:.2f}
                    </td>
                </tr>
                """

            # 建立異常警報區域
            anomaly_section = ""
            if analysis.get("has_anomalies"):
                anomaly_section = """
                <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
                    <h3 style="color: #dc2626; margin-top: 0;">⚠️ 異常警報</h3>
                """
                for anomaly in analysis.get("anomalies", []):
                    service = anomaly.get("service", "Unknown")
                    increase = anomaly.get("increase_percent", 0)
                    current = anomaly.get("current_cost", 0)
                    previous = anomaly.get("previous_cost", 0)
                    anomaly_section += f"""
                    <div style="background-color: white; padding: 10px; margin: 10px 0; border-radius: 4px;">
                        <strong>{service}</strong>:
                        ${previous:.2f} → ${current:.2f}
                        <span style="color: #dc2626; font-weight: bold;">(+{increase:.1f}%)</span>
                    </div>
                    """
                anomaly_section += "</div>"

            # 建立建議區域
            recommendations_section = ""
            if analysis.get("recommendations"):
                recommendations_section = """
                <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                    <h3 style="color: #1e40af; margin-top: 0;">💡 AI 建議</h3>
                    <ul style="margin: 10px 0;">
                """
                for rec in analysis.get("recommendations", []):
                    recommendations_section += f"<li style='margin: 5px 0;'>{rec}</li>"
                recommendations_section += "</ul></div>"

            # 建立趨勢圖表 ASCII art（簡化版）
            daily_costs = billing_data.get("daily_costs", [])[-7:]  # 最近7天
            trend_chart = self._generate_trend_chart_html(daily_costs)

            # 構建完整 HTML 郵件
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 800px; margin: 0 auto; padding: 20px; }}
                    .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                               color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }}
                    .content {{ background-color: #ffffff; padding: 30px; border: 1px solid #e5e7eb;
                                border-top: none; border-radius: 0 0 10px 10px; }}
                    .stat-card {{ background: #f9fafb; border-radius: 8px; padding: 20px; margin: 15px 0;
                                  border: 1px solid #e5e7eb; }}
                    .stat-value {{ font-size: 32px; font-weight: bold; color: #1f2937; }}
                    .stat-label {{ color: #6b7280; font-size: 14px; }}
                    table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
                    th {{ background-color: #f3f4f6; padding: 12px; text-align: left; font-weight: 600; }}
                    .footer {{ text-align: center; color: #6b7280; padding: 20px; font-size: 12px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📊 GCP 帳單每日摘要</h1>
                        <p style="margin: 5px 0; opacity: 0.9;">
                            {billing_data.get("period", {}).get("start", "")} -
                            {billing_data.get("period", {}).get("end", "")}
                        </p>
                    </div>

                    <div class="content">
                        <p>親愛的 {admin_name}，</p>

                        <p>以下是您的 GCP 帳單每日摘要報告：</p>

                        <!-- 總費用卡片 -->
                        <div class="stat-card">
                            <div class="stat-label">過去 7 天總費用</div>
                            <div class="stat-value">${billing_data.get("total_cost", 0):.2f}</div>
                            <div style="color: #6b7280; font-size: 14px; margin-top: 5px;">
                                日均: ${billing_data.get("total_cost", 0) / 7:.2f}
                            </div>
                        </div>

                        <!-- 異常警報 -->
                        {anomaly_section}

                        <!-- Top 服務費用 -->
                        <h3 style="margin-top: 30px;">🏆 Top 5 服務費用</h3>
                        <table>
                            <thead>
                                <tr>
                                    <th>服務名稱</th>
                                    <th style="text-align: right;">費用</th>
                                </tr>
                            </thead>
                            <tbody>
                                {top_services_rows}
                            </tbody>
                        </table>

                        <!-- 每日趨勢圖 -->
                        <h3 style="margin-top: 30px;">📈 過去 7 天費用趨勢</h3>
                        {trend_chart}

                        <!-- AI 分析建議 -->
                        {recommendations_section}

                        <!-- 分析洞察 -->
                        <div style="background-color: #f0fdf4; border-left: 4px solid #10b981;
                                    padding: 15px; margin: 20px 0;">
                            <h3 style="color: #047857; margin-top: 0;">🔍 AI 分析洞察</h3>
                            <p>{analysis.get("summary", "系統運作正常，無異常費用增長。")}</p>
                        </div>

                        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">

                        <p style="color: #6b7280; font-size: 14px;">
                            此報告由 Duotopia 帳單監控系統自動生成。<br>
                            如需查看詳細數據，請登入
                            <a href="{self.frontend_url}/admin/billing">管理後台</a>。
                        </p>
                    </div>

                    <div class="footer">
                        <p>© 2025 Duotopia. All rights reserved.</p>
                        <p>此郵件由系統自動發送，請勿直接回覆。</p>
                    </div>
                </div>
            </body>
            </html>
            """

            # 發送郵件
            subject = f"📊 GCP 帳單每日摘要 - ${billing_data.get('total_cost', 0):.2f} (過去7天)"
            if analysis.get("has_anomalies"):
                subject = f"⚠️ {subject} - 偵測到異常"

            success = self.send_email(admin_email, subject, html_content)

            if success:
                logger.info(f"✅ Daily billing summary sent to {admin_email}")
            else:
                logger.error(f"❌ Failed to send daily billing summary to {admin_email}")

            return success

        except Exception as e:
            logger.error(f"❌ Failed to send billing summary email: {str(e)}")
            return False

    def _generate_trend_chart_html(self, daily_costs: list) -> str:
        """生成簡易的趨勢圖表 HTML"""
        if not daily_costs:
            return "<p>暫無數據</p>"

        max_cost = max([item["cost"] for item in daily_costs]) if daily_costs else 1
        if max_cost == 0:
            max_cost = 1  # 避免除以零

        chart_html = """
        <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 15px 0;">
        """

        for item in daily_costs:
            date = item["date"]
            cost = item["cost"]
            percentage = (cost / max_cost) * 100

            chart_html += f"""
            <div style="margin: 8px 0;">
                <div style="display: flex; align-items: center;">
                    <div style="width: 80px; font-size: 12px; color: #6b7280;">{date}</div>
                    <div style="flex: 1; background: #e5e7eb; border-radius: 4px; height: 24px; position: relative;">
                        <div style="background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                                    width: {percentage}%; height: 100%; border-radius: 4px;"></div>
                    </div>
                    <div style="width: 80px; text-align: right; font-weight: 600; color: #1f2937;">
                        ${cost:.2f}
                    </div>
                </div>
            </div>
            """

        chart_html += "</div>"
        return chart_html


# 全域 email 服務實例
email_service = EmailService()
