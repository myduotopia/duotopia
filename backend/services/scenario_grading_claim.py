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
from typing import Optional, Tuple

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


def claim(
    db: Session, progress: StudentItemProgress
) -> Tuple[str, int, Optional[datetime]]:
    """搶下這一題的評分權，回傳 ``(結果, 目前計數, 鎖的 token)``。

    ``CLAIM_OK`` 代表額度已扣、鎖已拿到，呼叫端可以打 AI，結束後**務必**把那個
    token 交給 :func:`release`。另兩種結果代表沒搶到，額度沒有被扣，token 是 None。

    token 就是寫進 ``scenario_grading_started_at`` 的時間戳 —— release 用它確認
    「鎖還是我的」才動手，否則逾時被接手之後會去清掉別人的鎖（PR #1123 review）。
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
        return CLAIM_OK, int(progress.ai_analysis_count or 0), now

    # 沒搶到：回頭看是「額度用完」還是「有人在跑」。重讀一次而不是信記憶體裡的值 ——
    # 搶輸的時候那個值可能是舊的。
    db.refresh(progress)
    count = int(progress.ai_analysis_count or 0)
    if count >= MAX_AI_ANALYSIS_ATTEMPTS:
        return CLAIM_QUOTA_EXHAUSTED, count, None
    return CLAIM_IN_PROGRESS, count, None


def release(
    db: Session,
    progress: StudentItemProgress,
    token: Optional[datetime],
    refund: bool,
) -> bool:
    """放掉鎖，回傳是否真的放到。``refund=True`` 時連同把扣掉的那一次還回去。

    一定要在 ``finally`` 裡呼叫：老師中途關掉分頁時 Starlette 丟的是
    ``asyncio.CancelledError``（BaseException），``except Exception`` 接不到，
    鎖與額度都會留在那裡（同 PR #1027 review R2 的理由）。

    ## 為什麼要帶 token

    只比對 id 就無條件清掉 ``started_at`` 的話，**會清掉別人的鎖**：A 跑超過
    ``STALE_AFTER_SECONDS`` 被 B 接手，A 回來時把 B 的鎖清掉、還把 B 的那一次額度
    退掉，於是第三個請求在 B 還在跑的時候又進來了（PR #1123 review 2、3）。

    帶 token 之後，A 的 UPDATE 匹配不到列（``started_at`` 已經是 B 寫的值），
    什麼都不動。**代價是 A 自己扣掉的那一次不會退** —— 單一計數器分不出哪個 +1
    是誰的，退掉就會變成退 B 的。A 跑超過 180 秒本來就是異常，算它一次比誤退
    別人的安全。

    ## db.rollback()

    開頭先 rollback：呼叫端的 ``db.commit()`` 可能已經失敗（連線斷掉之類），
    session 會停在失敗狀態，這裡再下查詢會丟 ``PendingRollbackError``，把原本的
    錯誤蓋掉、而且鎖要卡到逾時才會放（PR #1123 review 1）。
    rollback 不會丟掉 claim 寫的東西 —— 那個 commit 早就完成了。
    """
    db.rollback()

    if token is None:
        # 沒搶到鎖的人不該放鎖
        return False

    values: dict = {StudentItemProgress.scenario_grading_started_at: None}
    if refund:
        # token 還對得上就代表 claim 的 +1 還在（release 一個 claim 只會成功一次），
        # 所以這裡直接 -1 不需要再防負數：重複呼叫時 token 已被清成 NULL，
        # 第二次就匹配不到列了。
        values[StudentItemProgress.ai_analysis_count] = (
            StudentItemProgress.ai_analysis_count - 1
        )

    rows = (
        db.query(StudentItemProgress)
        .filter(
            StudentItemProgress.id == progress.id,
            StudentItemProgress.scenario_grading_started_at == token,
        )
        .update(values, synchronize_session="fetch")
    )
    db.commit()

    if rows == 0:
        logger.warning("scenario_grading_claim | 鎖已被接手，不動它 | progress=%s", progress.id)
    return rows == 1
