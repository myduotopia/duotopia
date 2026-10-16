"""情境對話逐題 AI 評分的「正在進行中」鎖（issue #1025）。

## 為什麼光是先扣額度不夠

PR #1036 review 指出老師雙擊會打兩次 Gemini。第一版的修法是把額度從「打完才扣」改成
「打之前先扣」，但那只擋得住**上限邊界**那一下：計數還在 0/3 時，兩個並發請求都滿足
``count < 3``，兩個都扣成功（0→1、1→2）、兩個都打了 AI。持久化的計數是對的，錢還是
付了兩次（#1025 本機 review 指出）。

真正要擋的是「同一題同時有兩個分析在跑」，那需要一個**在進行中的標記**，不是計數上限。

## 做法

``student_item_progress.scenario_grading_started_at``：

* **搶鎖**＝一次原子 UPDATE，條件是「額度還有」**且**「沒人在跑（或上次跑到一半死了）」，
  同時寫入 started_at 與 count+1。兩個並發請求只有一個會匹配到列。
* **放鎖**＝把 started_at 清成 NULL（成功、失敗、中途取消都要放）。
* **逾時自動放**：程序被殺掉時不會執行放鎖，所以超過 ``STALE_AFTER_SECONDS`` 的
  started_at 視為失效，下一個請求搶得到。沒有這道的話那一題會永久卡住。

逾時比對用 Python 算出 cutoff 再傳進 SQL，不用 ``now() - interval``：後者是
PostgreSQL 專屬語法，測試跑在 SQLite 上。
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.progress import StudentItemProgress
from services.analysis_quota import MAX_AI_ANALYSIS_ATTEMPTS

logger = logging.getLogger(__name__)

# 超過這個時間沒放鎖就視為失效。
#
# 取 3 分鐘：Gemini 讀音檔 + 評分正常是數秒，冷啟動加上重試也遠低於此；而老師等不到
# 結果時重按的間隔通常是幾十秒。設太短會讓慢的那次被第二次請求插隊（兩個都在跑），
# 設太長則是那一題卡住的時間。
STALE_AFTER_SECONDS = 180

# 搶不到鎖的兩種原因 —— 對老師的意思完全不同，呼叫端要回不同狀態碼
CLAIM_OK = "ok"
CLAIM_IN_PROGRESS = "in_progress"
CLAIM_QUOTA_EXHAUSTED = "quota_exhausted"


def claim(db: Session, progress: StudentItemProgress) -> Tuple[str, int]:
    """搶下這一題的評分權，回傳 ``(結果, 目前計數)``。

    ``CLAIM_OK`` 代表額度已扣、鎖已拿到，呼叫端可以打 AI，結束後**務必**呼叫
    :func:`release`。另兩種結果代表沒搶到，額度沒有被扣。
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=STALE_AFTER_SECONDS)

    rows = (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.id == progress.id,
            StudentItemProgress.ai_analysis_count < MAX_AI_ANALYSIS_ATTEMPTS,
            or_(
                StudentItemProgress.scenario_grading_started_at.is_(None),
                StudentItemProgress.scenario_grading_started_at < cutoff,
            ),
        )
        .update(
            {
                StudentItemProgress.ai_analysis_count: (
                    StudentItemProgress.ai_analysis_count + 1
                ),
                StudentItemProgress.scenario_grading_started_at: now,
            },
            synchronize_session="fetch",
        )
    )
    db.commit()

    if rows == 1:
        return CLAIM_OK, int(progress.ai_analysis_count or 0)

    # 沒搶到：回頭看是「額度用完」還是「有人在跑」。重讀一次而不是信記憶體裡的值 ——
    # 搶輸的時候那個值可能是舊的。
    db.refresh(progress)
    count = int(progress.ai_analysis_count or 0)
    if count >= MAX_AI_ANALYSIS_ATTEMPTS:
        return CLAIM_QUOTA_EXHAUSTED, count
    return CLAIM_IN_PROGRESS, count


def release(db: Session, progress: StudentItemProgress, refund: bool) -> None:
    """放掉鎖。``refund=True`` 時連同把扣掉的那一次還回去。

    一定要在 ``finally`` 裡呼叫：老師中途關掉分頁時 Starlette 丟的是
    ``asyncio.CancelledError``（BaseException），``except Exception`` 接不到，
    鎖與額度都會留在那裡（同 PR #1027 review R2 的理由）。
    """
    values = {StudentItemProgress.scenario_grading_started_at: None}
    query = db.query(StudentItemProgress).filter(StudentItemProgress.id == progress.id)
    if refund:
        # 不會扣成負數：就算例外路徑重入也只是回到 0
        query.filter(StudentItemProgress.ai_analysis_count > 0).update(
            {
                StudentItemProgress.ai_analysis_count: (
                    StudentItemProgress.ai_analysis_count - 1
                ),
                **values,
            },
            synchronize_session="fetch",
        )
        # 計數已經是 0 時上面那句不會匹配到列，鎖還是要放掉
        db.query(StudentItemProgress).filter(
            StudentItemProgress.id == progress.id
        ).update(values, synchronize_session="fetch")
    else:
        query.update(values, synchronize_session="fetch")
    db.commit()
