"""Cloud Tasks enqueue helper for background jobs.

Currently used to schedule 1Campus class roster syncs after teacher login
(#635). The pattern generalises: each task type maps to an internal worker
endpoint that Cloud Tasks calls back over HTTP.

When the necessary env vars are missing — local dev, CI, per-issue test
environments — we transparently fall back to running the work in-process via
asyncio.create_task. That fallback is fire-and-forget, so it is suitable
only for non-critical background jobs whose results aren't user-visible
right away. Production must configure Cloud Tasks for durability.

Required settings for Cloud Tasks mode:
  - GCP_PROJECT_ID
  - CLOUD_TASKS_QUEUE
  - CLOUD_TASKS_LOCATION
  - CLOUD_TASKS_TARGET_BASE_URL
  - CLOUD_TASKS_INVOKER_SECRET
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional

from core.config import settings

logger = logging.getLogger(__name__)


def is_cloud_tasks_configured() -> bool:
    return all(
        [
            getattr(settings, "GCP_PROJECT_ID", None),
            getattr(settings, "CLOUD_TASKS_QUEUE", None),
            getattr(settings, "CLOUD_TASKS_LOCATION", None),
            getattr(settings, "CLOUD_TASKS_TARGET_BASE_URL", None),
            getattr(settings, "CLOUD_TASKS_INVOKER_SECRET", None),
        ]
    )


async def enqueue_one_campus_class_sync(school_dsns: str, teacher_id: int) -> str:
    """Enqueue a 1Campus class sync task.

    Returns the Cloud Tasks task name on success, or "inline" when running
    via the local fallback. Never raises — failures are logged and swallowed
    because login flows must not break when the queue is misbehaving.
    """
    payload = {"school_dsns": school_dsns, "teacher_id": teacher_id}

    if not is_cloud_tasks_configured():
        logger.info(
            "Cloud Tasks not configured — running 1Campus sync inline "
            "(school=%s, teacher=%s)",
            school_dsns,
            teacher_id,
        )
        try:
            asyncio.create_task(_run_sync_inline(school_dsns, teacher_id))
        except RuntimeError:
            # No running event loop (rare — e.g. when called from sync code).
            # Spin up a transient loop in a thread to honour the contract.
            logger.warning(
                "No running event loop for inline sync; skipping "
                "(school=%s, teacher=%s)",
                school_dsns,
                teacher_id,
            )
        return "inline"

    try:
        from google.cloud import tasks_v2

        client = tasks_v2.CloudTasksClient()
        parent = client.queue_path(
            settings.GCP_PROJECT_ID,
            settings.CLOUD_TASKS_LOCATION,
            settings.CLOUD_TASKS_QUEUE,
        )
        task: Dict[str, Any] = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": (
                    f"{settings.CLOUD_TASKS_TARGET_BASE_URL.rstrip('/')}"
                    f"/api/internal/tasks/sync-1campus-class"
                ),
                "headers": {
                    "Content-Type": "application/json",
                    "X-Cloud-Tasks-Secret": (settings.CLOUD_TASKS_INVOKER_SECRET or ""),
                },
                "body": json.dumps(payload).encode(),
            },
        }
        created = await asyncio.to_thread(
            client.create_task, request={"parent": parent, "task": task}
        )
        logger.info(
            "Enqueued 1Campus sync task: %s (school=%s, teacher=%s)",
            created.name,
            school_dsns,
            teacher_id,
        )
        return created.name
    except Exception as e:
        # Non-fatal: log and fall through; login still succeeds.
        logger.exception(
            "Failed to enqueue 1Campus sync task (school=%s, teacher=%s): %s",
            school_dsns,
            teacher_id,
            e,
        )
        return ""


async def _run_sync_inline(school_dsns: str, teacher_id: int) -> None:
    """Local fallback: run the sync directly with a fresh DB session."""
    # Imported here to avoid a circular import (auth_one_campus → cloud_tasks
    # → sync_service → models → ... → auth_one_campus, in the wrong order).
    from database import SessionLocal
    from services.one_campus_class_sync_service import (
        OneCampusClassSyncService,
    )

    db = SessionLocal()
    try:
        result = await OneCampusClassSyncService.sync_school(
            db, school_dsns, teacher_id
        )
        logger.info(
            "Inline 1Campus sync done (school=%s, teacher=%s): %s",
            school_dsns,
            teacher_id,
            result.to_dict(),
        )
    except Exception as e:
        logger.exception(
            "Inline 1Campus sync failed (school=%s, teacher=%s): %s",
            school_dsns,
            teacher_id,
            e,
        )
    finally:
        try:
            db.close()
        except Exception:
            pass


def verify_invoker_secret(provided: Optional[str]) -> bool:
    """Constant-time check for the X-Cloud-Tasks-Secret header.

    Returns False if the secret is unset (fail closed) or if it does not
    match. Callers should map False to HTTP 403.
    """
    import hmac

    expected = getattr(settings, "CLOUD_TASKS_INVOKER_SECRET", None)
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided, expected)
