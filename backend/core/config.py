"""
Configuration for multi-database support
Supports switching between Supabase and Cloud SQL
"""

import os
from types import MappingProxyType
from typing import Literal, Mapping, Optional  # noqa: F401
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv

# 載入環境變數
# 環境優先順序：.env.local > .env.staging > .env
root_dir = Path(__file__).parent.parent.parent

# 先嘗試載入 .env.local（本地開發）
env_local = root_dir / ".env.local"
env_staging = root_dir / ".env.staging"
env_default = root_dir / ".env"

# Silent loading - no console output for security
if env_local.exists():
    load_dotenv(env_local, override=True)
elif env_staging.exists() and os.getenv("ENVIRONMENT") == "staging":
    load_dotenv(env_staging, override=True)
elif env_default.exists():
    load_dotenv(env_default, override=True)
else:
    load_dotenv()


class Settings:
    # Environment
    ENVIRONMENT: Literal["local", "staging", "production"] = os.getenv(
        "ENVIRONMENT", "local"
    )
    DATABASE_TYPE: Literal["local", "supabase", "cloudsql"] = os.getenv(
        "DATABASE_TYPE", "local"
    )

    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://duotopia_user:duotopia_pass@localhost:5432/duotopia",
    )

    # JWT Settings
    JWT_SECRET: str = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "30"))

    # Supabase (optional)
    SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL")
    SUPABASE_KEY: Optional[str] = os.getenv("SUPABASE_KEY")
    # Realtime broadcast 用（#835 live quiz 收卷推播）。優先 service role；
    # 缺則退回 SUPABASE_KEY / SUPABASE_ANON_KEY。三者皆無 → broadcast 靜默略過（fallback polling 接手）。
    SUPABASE_SERVICE_KEY: Optional[str] = os.getenv("SUPABASE_SERVICE_KEY")
    SUPABASE_ANON_KEY: Optional[str] = os.getenv("SUPABASE_ANON_KEY")

    # Google OAuth (optional) — 老師端 Google 登入（#740）
    GOOGLE_CLIENT_ID: Optional[str] = os.getenv("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: Optional[str] = os.getenv("GOOGLE_CLIENT_SECRET")
    # 註冊在 Google Console 的 redirect URI。
    # develop / staging / per-issue → staging 後端的 /api/auth/google/relay
    # production → https://duotopia.co/auth/google/callback
    GOOGLE_REDIRECT_URI: Optional[str] = os.getenv("GOOGLE_REDIRECT_URI")

    # 本環境前端網址（Google OAuth state 帶回 relay 用）
    FRONTEND_URL: Optional[str] = os.getenv("FRONTEND_URL")

    # 1Campus SSO (optional)
    ONE_CAMPUS_CLIENT_ID: Optional[str] = os.getenv("ONE_CAMPUS_CLIENT_ID")
    ONE_CAMPUS_CLIENT_SECRET: Optional[str] = os.getenv("ONE_CAMPUS_CLIENT_SECRET")
    ONE_CAMPUS_API_BASE_URL: str = os.getenv(
        "ONE_CAMPUS_API_BASE_URL", "https://devapi.1campus.net"
    )

    # 1Campus OAuth (auth.ischool.com.tw)
    ONE_CAMPUS_OAUTH_CLIENT_ID: Optional[str] = os.getenv("ONE_CAMPUS_OAUTH_CLIENT_ID")
    ONE_CAMPUS_OAUTH_CLIENT_SECRET: Optional[str] = os.getenv(
        "ONE_CAMPUS_OAUTH_CLIENT_SECRET"
    )
    ONE_CAMPUS_OAUTH_REDIRECT_URI: Optional[str] = os.getenv(
        "ONE_CAMPUS_OAUTH_REDIRECT_URI"
    )

    # LINE 官方帳號（issue #804 — 自動發布更新公告）
    # 必須是 Duotopia 官方帳號的 Messaging API token：production 會 broadcast
    # 給這個帳號的所有好友。刻意不與 CI 通知 bot 共用，避免廣播到錯的帳號。
    LINE_ANNOUNCE_CHANNEL_ACCESS_TOKEN: Optional[str] = os.getenv(
        "LINE_ANNOUNCE_CHANNEL_ACCESS_TOKEN"
    )
    # 公告審核者（單一使用者）：
    # - 建立草稿時（staging / production）推一則「待審核」通知
    # - 非 production 環境「發布 LINE」時只推給這個人（production 才 broadcast）
    # LINE user ID 依 provider 而不同，必須是官方帳號同一個 provider 底下的 ID
    LINE_ANNOUNCE_USER_ID: Optional[str] = os.getenv("LINE_ANNOUNCE_USER_ID")
    # 更新公告的樣板圖（先用官網 OG 圖佔位，換圖不用改程式）
    RELEASE_ANNOUNCEMENT_BANNER_URL: Optional[str] = os.getenv(
        "RELEASE_ANNOUNCEMENT_BANNER_URL"
    )
    # CI 呼叫「產生公告草稿」webhook 用的密鑰
    RELEASE_WEBHOOK_SECRET: Optional[str] = os.getenv("RELEASE_WEBHOOK_SECRET")

    # OpenAI (optional)
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")

    # Azure Speech Services (optional)
    AZURE_SPEECH_KEY: Optional[str] = os.getenv("AZURE_SPEECH_KEY")
    # 預設 japaneast（東京）：教育部校園徵求案規定不得連線至中國大陸含港澳，
    # Azure eastasia 實體位於香港，故預設值改為合規的 japaneast，
    # 避免漏設環境變數時靜默 fallback 到香港（Issue #958）
    AZURE_SPEECH_REGION: Optional[str] = os.getenv("AZURE_SPEECH_REGION", "japaneast")
    AZURE_SPEECH_ENDPOINT: Optional[str] = os.getenv("AZURE_SPEECH_ENDPOINT")

    # Resource Account (資源教材包來源帳號)
    RESOURCE_ACCOUNT_EMAIL: str = os.getenv(
        "RESOURCE_ACCOUNT_EMAIL", "contact@duotopia.co"
    )

    # GCP (optional)
    GCP_PROJECT_ID: Optional[str] = os.getenv("GCP_PROJECT_ID", "duotopia-469413")

    # Vertex AI (Gemini) - 用於替代 OpenAI
    USE_VERTEX_AI: bool = os.getenv("USE_VERTEX_AI", "false").lower() == "true"
    VERTEX_AI_PROJECT_ID: Optional[str] = os.getenv(
        "VERTEX_AI_PROJECT_ID", "duotopia-472708"
    )
    # 預設 asia-northeast1（東京）：收斂學生學習資料出境範圍至亞洲（Issue #959）。
    # asia-east1（台灣）經實測無 Gemini 模型（404），asia-northeast1 是唯一
    # 提供我們所需 Gemini 模型的亞洲 region，且與 Azure Speech（japaneast）
    # 同在日本東京，合規（非中港澳）。
    #
    # ⚠️ 不要改成 "global"：那會讓請求被導到全球任意 region，推翻 #959 對
    # 教育部 115 年校園徵求案「對外連線清單」的承諾。改這個值是合規決策，
    # 不是技術選擇。迴歸測試：tests/unit/test_issue_1119_model_migration.py
    VERTEX_AI_LOCATION: str = os.getenv("VERTEX_AI_LOCATION", "asia-northeast1")

    # ── 生圖例外（Issue #1158）──────────────────────────────────────────
    # 情境對話的 AI 生圖是**唯一**不走上面 VERTEX_AI_LOCATION 的呼叫：亞洲 region
    # 沒有任何可用的 Gemini 生圖模型（2026-10-29 實測 asia-northeast1 全部 404），
    # 所以生圖改走 global（或 us-central1）。
    #
    # 這是 #959「學生學習資料不出亞洲」承諾的例外，成立的前提是：生圖**只送老師
    # 自己寫的描述與情境文字**，不送任何學生資料（姓名、錄音、作答）。往這條路徑
    # 加任何學生資料之前，必須先重新取得合規確認。
    # 詳見 docs/design/issue-1073-vertex-sdk-migration.md「生圖例外」段。
    #
    # 模型選擇：2026-10-29 實測，global 上可用的 Gemini 生圖模型有
    # gemini-3.1-flash-lite-image、gemini-3.1-flash-image、gemini-3-pro-image
    # （us-central1 上 3.x 生圖模型全部 404；gemini-2.5-flash-image 屬已退役的 2.5 系列不採用）。
    # 取最便宜的 flash-lite：單張 4:3 實測輸出 1120 image tokens，黑白線稿品質足夠。
    # 迴歸測試：tests/unit/test_issue_1119_model_migration.py
    VERTEX_IMAGE_MODEL: str = os.getenv(
        "VERTEX_IMAGE_MODEL", "gemini-3.1-flash-lite-image"
    )
    VERTEX_IMAGE_LOCATION: str = os.getenv("VERTEX_IMAGE_LOCATION", "global")

    # 模型 ID 單一來源（Issue #1119）。
    #
    # gemini-2.5-flash / gemini-2.5-pro 於 2026-10-20 退役，必須汰換。
    # 選 gemini-3.5-flash 的原因：2026-10-16 實測，它是 asia-northeast1
    # **唯一**可用的 Gemini 3.x 模型 —— 較便宜的 gemini-3.5-flash-lite、
    # gemini-3.1-flash-lite 與 pro 級的 3.x 在所有亞洲 region 都是 404，
    # 只在 global / us-central1 才有。要用它們就得放棄 #959 的出境收斂。
    #
    # 成本：$1.50/$9.00 per 1M（非 global endpoint 再 +10%），比 2.5-flash 的
    # $0.30/$2.50 貴。以 prod 近 30 天約 863 次呼叫估算，月費從約 $0.6 升到
    # 約 $2.4，差額不具實質影響。
    #
    # pro 併入 flash：東京沒有任何 3.x pro（gemini-3.1-pro-preview 實測 404），
    # 且 pro 只有帳單分析的內部 cron 在用（billing_analysis_service.py）。
    VERTEX_AI_FLASH_MODEL: str = os.getenv("VERTEX_AI_FLASH_MODEL", "gemini-3.5-flash")
    VERTEX_AI_PRO_MODEL: str = os.getenv("VERTEX_AI_PRO_MODEL", "gemini-3.5-flash")

    # 模型單價（美元／百萬 token，僅供成本觀測，非計費用途）。
    #
    # 放在這裡而不是各服務各寫一份：模型 ID 之前就是散在 4 個檔案才會在
    # 2.5 退役時沒人發現，價格表同樣會各自飄（PR #1122 review 第 6 點）。
    #
    # gemini-3.5-flash 官方 $1.50 / $9.00（global endpoint），我們跑在
    # asia-northeast1（非 global）要 +10% → $1.65 / $9.90。
    # 2026-10-16 查證：https://cloud.google.com/vertex-ai/generative-ai/pricing
    #
    # ⚠️ 以模型名為 key —— 換模型但忘了加價格，成本統計會靜默變 0。
    # 迴歸測試：tests/unit/test_issue_1119_model_migration.py
    # 用 MappingProxyType 真正唯讀：三個服務共用同一個物件，
    # 執行期被改到會讓成本統計無聲走鐘（PR #1122 review 第 2 點）
    VERTEX_AI_PRICING_USD_PER_1M: Mapping[str, Mapping[str, float]] = MappingProxyType(
        {
            "gemini-3.5-flash": MappingProxyType({"input": 1.65, "output": 9.90}),
        }
    )

    # TapPay Configuration
    TAPPAY_ENV: Literal["sandbox", "production"] = os.getenv("TAPPAY_ENV", "sandbox")

    @property
    def tappay_app_id(self) -> str:
        """Get TapPay APP_ID based on environment"""
        if self.TAPPAY_ENV == "production":
            return os.getenv("TAPPAY_PRODUCTION_APP_ID", "")
        return os.getenv("TAPPAY_SANDBOX_APP_ID", "164155")

    @property
    def tappay_app_key(self) -> str:
        """Get TapPay APP_KEY based on environment"""
        if self.TAPPAY_ENV == "production":
            return os.getenv("TAPPAY_PRODUCTION_APP_KEY", "")
        return os.getenv("TAPPAY_SANDBOX_APP_KEY", "")

    @property
    def tappay_partner_key(self) -> str:
        """Get TapPay PARTNER_KEY based on environment"""
        if self.TAPPAY_ENV == "production":
            return os.getenv("TAPPAY_PRODUCTION_PARTNER_KEY", "")
        return os.getenv("TAPPAY_SANDBOX_PARTNER_KEY", "")

    @property
    def tappay_merchant_id(self) -> str:
        """Get TapPay MERCHANT_ID based on environment"""
        if self.TAPPAY_ENV == "production":
            return os.getenv("TAPPAY_PRODUCTION_MERCHANT_ID", "")
        return os.getenv("TAPPAY_SANDBOX_MERCHANT_ID", "")

    @property
    def deployment_name(self) -> str:
        """Get deployment name for logging"""
        return f"{self.ENVIRONMENT}-{self.DATABASE_TYPE}"

    @property
    def is_free_tier(self) -> bool:
        """Check if using free tier database"""
        return self.DATABASE_TYPE == "supabase" or self.DATABASE_TYPE == "local"

    @property
    def is_production(self) -> bool:
        """Check if running in production"""
        return self.ENVIRONMENT == "production"

    @property
    def is_staging(self) -> bool:
        """Check if running in staging"""
        return self.ENVIRONMENT == "staging"

    @property
    def is_local(self) -> bool:
        """Check if running locally"""
        return self.ENVIRONMENT == "local"

    def get_cost_per_day(self) -> float:
        """Get estimated daily cost in USD"""
        if self.DATABASE_TYPE == "cloudsql":
            return 2.28  # Cloud SQL with public IP
        return 0.0  # Supabase or local

    def get_database_info(self) -> dict:
        """Get database information for health checks"""
        return {
            "type": self.DATABASE_TYPE,
            "environment": self.ENVIRONMENT,
            "deployment": self.deployment_name,
            "is_free_tier": self.is_free_tier,
            "daily_cost_usd": self.get_cost_per_day(),
        }

    def validate(self):
        """Validate configuration"""
        if not self.DATABASE_URL:
            raise ValueError("DATABASE_URL is required")

        if self.DATABASE_TYPE == "supabase" and not self.SUPABASE_URL:
            # Silent warning - don't expose configuration details
            pass

        if (
            self.is_production
            and self.JWT_SECRET == "your-secret-key-change-in-production"
        ):
            raise ValueError("Please set a secure JWT_SECRET for production")

        return True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    settings = Settings()
    settings.validate()
    return settings


# Export for convenience
settings = get_settings()
