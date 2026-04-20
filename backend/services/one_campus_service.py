"""
1Campus API integration service.

Handles:
- OAuth client_credentials token management with caching
- OAuth 2.0 Authorization Code flow (auth.ischool.com.tw)
- Identity code exchange (SSO login)
- getUserRole for cross-school identity data (idNumberHash)
"""

import asyncio
import logging
import re
import time
from typing import Optional

import httpx

from utils.http_client import get_http_client
from core.config import settings

# Validation patterns for URL-interpolated parameters
_DSNS_RE = re.compile(r"^[a-zA-Z0-9._-]{1,100}$")
_CODE_RE = re.compile(r"^[a-zA-Z0-9_-]{1,200}$")

logger = logging.getLogger(__name__)

# 1Campus API base URL
ONE_CAMPUS_API_BASE = (
    getattr(settings, "ONE_CAMPUS_API_BASE_URL", None) or "https://devapi.1campus.net"
)

ONE_CAMPUS_CLIENT_ID = getattr(settings, "ONE_CAMPUS_CLIENT_ID", None)
ONE_CAMPUS_CLIENT_SECRET = getattr(settings, "ONE_CAMPUS_CLIENT_SECRET", None)

# 1Campus OAuth (auth.ischool.com.tw)
ONE_CAMPUS_OAUTH_BASE = "https://auth.ischool.com.tw"
ONE_CAMPUS_OAUTH_CLIENT_ID = getattr(settings, "ONE_CAMPUS_OAUTH_CLIENT_ID", None)
ONE_CAMPUS_OAUTH_CLIENT_SECRET = getattr(
    settings, "ONE_CAMPUS_OAUTH_CLIENT_SECRET", None
)
ONE_CAMPUS_OAUTH_REDIRECT_URI = getattr(
    settings, "ONE_CAMPUS_OAUTH_REDIRECT_URI", None
)

# Token cache (module-level singleton) with asyncio.Lock to prevent race conditions
_token_cache: dict = {"access_token": None, "expires_at": 0}
_token_lock = asyncio.Lock()


async def _get_access_token() -> str:
    """Get 1Campus data API access_token via client_credentials.

    Caches the token and refreshes 2 minutes before expiry.
    Uses asyncio.Lock to prevent concurrent token fetches.
    """
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now:
        return _token_cache["access_token"]

    async with _token_lock:
        # Double-check after acquiring lock
        now = time.time()
        if _token_cache["access_token"] and _token_cache["expires_at"] > now:
            return _token_cache["access_token"]

        if not ONE_CAMPUS_CLIENT_ID or not ONE_CAMPUS_CLIENT_SECRET:
            raise RuntimeError(
                "ONE_CAMPUS_CLIENT_ID and ONE_CAMPUS_CLIENT_SECRET must be set"
            )

        client = get_http_client()
        resp = await client.post(
            f"{ONE_CAMPUS_API_BASE}/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": ONE_CAMPUS_CLIENT_ID,
                "client_secret": ONE_CAMPUS_CLIENT_SECRET,
                "scope": "jasmine,jasmine.idNumberHash,jasmine.profile",
            },
        )
        resp.raise_for_status()
        data = resp.json()

        expires_in = data.get("expires_in", 3600)
        _token_cache["access_token"] = data["access_token"]
        # Refresh 2 minutes early
        _token_cache["expires_at"] = now + expires_in - 120

        logger.info("1Campus access_token acquired (expires_in=%s)", expires_in)
        return data["access_token"]


class OneCampusService:
    """1Campus API client."""

    @staticmethod
    def get_oauth_authorize_url() -> str:
        """Build the OAuth authorize URL for 1Campus SSO.

        The frontend redirects the user to this URL to initiate login.
        """
        if not ONE_CAMPUS_OAUTH_CLIENT_ID or not ONE_CAMPUS_OAUTH_REDIRECT_URI:
            raise RuntimeError(
                "ONE_CAMPUS_OAUTH_CLIENT_ID and ONE_CAMPUS_OAUTH_REDIRECT_URI must be set"
            )
        return (
            f"{ONE_CAMPUS_OAUTH_BASE}/oauth/authorize.php"
            f"?client_id={ONE_CAMPUS_OAUTH_CLIENT_ID}"
            f"&response_type=code"
            f"&redirect_uri={ONE_CAMPUS_OAUTH_REDIRECT_URI}"
            f"&scope=User.Mail,User.BasicInfo"
        )

    @staticmethod
    async def exchange_oauth_code(code: str) -> dict:
        """Exchange an OAuth authorization code for an access token.

        POST https://auth.ischool.com.tw/oauth/token.php

        Returns dict with keys: access_token, expires_in, token_type, scope, refresh_token.
        """
        if not ONE_CAMPUS_OAUTH_CLIENT_ID or not ONE_CAMPUS_OAUTH_CLIENT_SECRET:
            raise RuntimeError(
                "ONE_CAMPUS_OAUTH_CLIENT_ID and ONE_CAMPUS_OAUTH_CLIENT_SECRET must be set"
            )
        if not ONE_CAMPUS_OAUTH_REDIRECT_URI:
            raise RuntimeError("ONE_CAMPUS_OAUTH_REDIRECT_URI must be set")

        client = get_http_client()
        resp = await client.post(
            f"{ONE_CAMPUS_OAUTH_BASE}/oauth/token.php",
            data={
                "client_id": ONE_CAMPUS_OAUTH_CLIENT_ID,
                "client_secret": ONE_CAMPUS_OAUTH_CLIENT_SECRET,
                "redirect_uri": ONE_CAMPUS_OAUTH_REDIRECT_URI,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    async def get_oauth_user_info(access_token: str) -> dict:
        """Get user info from 1Campus OAuth.

        GET https://auth.ischool.com.tw/services/me.php?access_token=xxx

        Returns dict with keys: uuid, firstName, lastName, language, mail.
        """
        client = get_http_client()
        resp = await client.get(
            f"{ONE_CAMPUS_OAUTH_BASE}/services/me.php",
            params={"access_token": access_token},
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    async def exchange_identity_code(school_dsns: str, code: str) -> dict:
        """Exchange a one-time identity code for user info.

        GET /{schoolDsns}/identity/{code}
        Code expires after 30 seconds.

        Returns dict with keys: account, roleType, student/teacher/parent, schoolDsns, etc.
        Raises httpx.HTTPStatusError on 404 (not found), 410 (expired), 500.
        """
        if not _DSNS_RE.match(school_dsns):
            raise ValueError(f"Invalid schoolDsns format: {school_dsns!r}")
        if not _CODE_RE.match(code):
            raise ValueError(f"Invalid identity code format")

        client = get_http_client()
        resp = await client.get(
            f"{ONE_CAMPUS_API_BASE}/{school_dsns}/identity/{code}",
        )
        if resp.status_code == 404:
            raise OneCampusCodeNotFoundError("Identity code not found or already used")
        if resp.status_code == 410:
            raise OneCampusCodeExpiredError("Identity code expired (30s limit)")
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    async def get_user_role(
        account: Optional[str] = None,
        id_number_hash: Optional[str] = None,
    ) -> dict:
        """Get user's roles across all authorized schools.

        GET /api/jasmine/getUserRole?account=xxx
        Returns schools with teacher/student/parent roles.
        Includes idNumberHash when scope jasmine.idNumberHash is granted.
        """
        token = await _get_access_token()
        client = get_http_client()

        params = {}
        if account:
            params["account"] = account
        if id_number_hash:
            params["idNumberHash"] = id_number_hash

        resp = await client.get(
            f"{ONE_CAMPUS_API_BASE}/api/jasmine/getUserRole",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()


class OneCampusCodeNotFoundError(Exception):
    pass


class OneCampusCodeExpiredError(Exception):
    pass
