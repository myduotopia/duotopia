"""Supabase Realtime broadcast 輔助（Issue #835 / PR #881 點 1）.

老師收卷時，後端 HTTP POST 一則 broadcast 到 ``live-quiz:{assignment_id}`` 頻道，
全班訂閱該頻道的學生即時收到「已收卷」事件並跳離考卷頁，省去學生端高頻輪詢。

設計重點：
- **絕不破壞收卷流程**：未設定 Supabase 環境變數或網路失敗一律靜默略過，
  由前端既有 polling fallback 接手（最多延遲一個輪詢間隔才偵測到收卷）。
- **不需 table replication**：用 Realtime *Broadcast*（ephemeral pub/sub），
  非 ``postgres_changes``，故不依賴 RLS 或學生的 Supabase Auth session。
- 金鑰優先序：SERVICE_KEY > SUPABASE_KEY > ANON_KEY。Broadcast 公開頻道
  以 anon key 即可送，service role 更穩妥。

頻道安全性：收卷事件 payload 僅含 assignment_id + closed_at（無答案/分數），
即使他人猜到頻道名也只會收到「某考卷已收卷」的低敏訊號。
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

# Realtime broadcast REST endpoint（相對 SUPABASE_URL）。
_BROADCAST_PATH = "/realtime/v1/api/broadcast"
_QUIZ_CLOSED_EVENT = "quiz_closed"


def _resolve_key() -> Optional[str]:
    """取可用金鑰，優先 service role。"""
    return (
        getattr(settings, "SUPABASE_SERVICE_KEY", None)
        or getattr(settings, "SUPABASE_KEY", None)
        or getattr(settings, "SUPABASE_ANON_KEY", None)
    )


def quiz_channel_topic(assignment_id: int) -> str:
    """老師端 Assignment.id 對應的收卷頻道名（前後端須一致）。"""
    return f"live-quiz:{assignment_id}"


async def broadcast_quiz_closed(assignment_id: int, closed_at_iso: str) -> bool:
    """推播「老師已收卷」給該考卷頻道。

    回傳 True 表示已成功送出；False 表示未設定或送出失敗（呼叫端不需處理，
    fallback polling 會接手）。本函式吞掉所有例外，永不向上拋。
    """
    base_url = getattr(settings, "SUPABASE_URL", None)
    key = _resolve_key()
    if not base_url or not key:
        logger.info(
            "Supabase Realtime 未設定（SUPABASE_URL/KEY 缺），略過收卷 broadcast；"
            "學生端 polling fallback 接手。assignment_id=%s",
            assignment_id,
        )
        return False

    url = base_url.rstrip("/") + _BROADCAST_PATH
    payload = {
        "messages": [
            {
                "topic": quiz_channel_topic(assignment_id),
                "event": _QUIZ_CLOSED_EVENT,
                "payload": {
                    "assignment_id": assignment_id,
                    "closed_at": closed_at_iso,
                },
                "private": False,
            }
        ]
    }
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.warning(
                "收卷 broadcast 非 2xx（status=%s）：assignment_id=%s body=%s",
                resp.status_code,
                assignment_id,
                resp.text[:200],
            )
            return False
        return True
    except Exception as exc:  # noqa: BLE001 — 絕不讓 broadcast 失敗影響收卷
        logger.warning(
            "收卷 broadcast 失敗（忽略，fallback polling 接手）：assignment_id=%s err=%s",
            assignment_id,
            exc,
        )
        return False
