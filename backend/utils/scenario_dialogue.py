"""情境對話（Scenario Dialogue）資料正規化 — Issue #1013。

老師端面板 ``frontend/src/components/ScenarioDialoguePanel.tsx`` 比其他題型多出
兩層資料，這個模組是它們「怎麼存」的**唯一**判定處：

* **整份設定** —— 情境內容、情境圖（最多 5 張，#1146）、題目難度（CEFR）、作答
  指引、整體評分標準（時態／語態）、翻譯語言、TTS 設定，以及引導式對話的回答
  （#1146，供「上一步」還原）。存進 ``contents.scenario_settings``（JSONB）。
* **逐題資料** —— 時態／語態覆寫、必用字詞、參考答案、評分備註、圖片 prompt。
  存進 ``content_items.item_metadata['scenario_dialogue']``。

題目本文 / 翻譯 / 圖片 / 音檔沿用既有欄位（``text`` / ``translation`` /
``image_url`` / ``audio_url``），不另開欄位。

逐題資料放 ``item_metadata`` 而不是新欄位，有兩個理由：

1. 作業副本（``routers/assignments/crud.py``）、即刻練習、教材複製都已經把
   ``item_metadata`` 整包 copy 過去，放這裡等於自動跟著複製，不必再改一輪；
2. ``tense_override`` 需要區分兩種**行為不同**的狀態，只有 JSON 表達得出來（見下）。

tense_override / voice_override 的 null 語意（**不可壓平**）
-----------------------------------------------------------

``None``
    沿用整份設定的 ``global_tense`` / ``global_voice``。之後老師改整體，**本題跟著變**。

``{"time": "", "aspect": ""}`` / ``""``
    本題已脫鉤，明確「不指定」。之後改整體，**本題不受影響**。

兩者在 UI 上看起來都是空的，但行為完全不同。因此本模組一律用 ``is None`` 判斷，
**禁止**用 truthiness（``or`` / ``if not x``）把兩者壓成同一個值。生效值請一律走
:func:`resolve_effective_tense` / :func:`resolve_effective_voice`，不要在呼叫端自己寫。

reference_answer 不得外流到學生端
---------------------------------

``reference_answer`` 只給 AI 評分當**語言特徵**對照（時態、句型、用字水準、資訊
完整度），學生端絕對看不到，而且**不可拿來逐字比對** —— 口說同一題每個學生講的
內容本來就不同，逐字比對會把所有與範例不同的答案誤判成錯。任何送往學生端的序列化
都必須走 :func:`public_item_view`，它會把 ``reference_answer`` 與 ``image_prompt``
（內部用的生成 prompt）拿掉。

穩定代碼
--------

時態／語態存的是穩定代碼（``past`` / ``simple`` / ``perfectProgressive`` /
``active`` …），不是中文。代碼與前端 ``TENSE_TIMES`` / ``TENSE_ASPECTS`` /
``VOICES`` 一一對應，老師切換介面語言不會改變存進資料庫的值。未知代碼一律擋下
（丟 ``ValueError``），避免前端／AI 產題送進髒資料後才在評分階段爆掉。
"""
from typing import Any, Dict, List, Optional

# item_metadata 底下的命名空間 key
SCENARIO_ITEM_KEY = "scenario_dialogue"

# 一份情境對話的題數上下限（#864；前端 MIN_ITEMS / MAX_ITEMS 同值）
MIN_ITEMS = 3
MAX_ITEMS = 10

# ---- 穩定代碼（與 ScenarioDialoguePanel.tsx 的常數一一對應）----
TENSE_TIMES = frozenset({"present", "past", "future"})
TENSE_ASPECTS = frozenset({"simple", "progressive", "perfect", "perfectProgressive"})
VOICES = frozenset({"active", "passive"})
CEFR_LEVELS = frozenset({"A1", "A2", "B1", "B2", "C1", "C2"})

# ---- #1146 引導式對話 ----
# 「需要情境嗎？」的回答：不需要（問日常生活）／我有現成的／請 AI 幫我寫
SCENARIO_MODES = frozenset({"none", "existing", "ai"})
# 「題目怎麼來？」的回答：自己輸入／請 AI 出題
QUESTION_SOURCES = frozenset({"manual", "ai"})
# 一份情境最多幾張情境圖（前端 MAX_SCENARIO_IMAGES 同值）。題目圖仍是每題 1 張，不在此列。
MAX_SCENARIO_IMAGES = 5
# 單一網址長度上限 —— 正常的 GCS 公開網址遠低於此，只是擋異常 payload
MAX_IMAGE_URL_CHARS = 2048

# 「不指定」的時態 —— 整份設定沒有「沿用」的上層，所以缺值時落在這裡而不是 None
EMPTY_TENSE: Dict[str, str] = {"time": "", "aspect": ""}


def _text(value: Any) -> str:
    """任何缺值都收斂成空字串（空字串在本題型是合法值，不是「未設定」）。"""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"預期字串，收到 {type(value).__name__}")
    return value


def _code(value: Any, allowed: frozenset, field: str) -> str:
    """驗證穩定代碼。空字串 = 不指定（合法）；未知代碼直接擋下。"""
    text = _text(value)
    if text == "":
        return ""
    if text not in allowed:
        raise ValueError(f"{field} 不是合法代碼：{text!r}（可用：{sorted(allowed)}）")
    return text


def normalize_tense(raw: Any, field: str = "tense") -> Optional[Dict[str, str]]:
    """時態正規化。

    ``None`` 原封不動回傳 ``None``（逐題＝沿用整體；整體＝呼叫端自行補 EMPTY_TENSE）。
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"{field} 需為物件或 null，收到 {type(raw).__name__}")
    return {
        "time": _code(raw.get("time"), TENSE_TIMES, f"{field}.time"),
        "aspect": _code(raw.get("aspect"), TENSE_ASPECTS, f"{field}.aspect"),
    }


def normalize_voice(raw: Any, field: str = "voice") -> Optional[str]:
    """語態正規化。``None`` 保持 ``None``（沿用整體），``""`` 是「明確不指定」。"""
    if raw is None:
        return None
    return _code(raw, VOICES, field)


def _normalize_keywords(raw: Any) -> List[str]:
    """必用字詞 —— 逐題獨立、不繼承整體。去掉空白項，保留老師輸入的順序。"""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(f"keywords 需為陣列，收到 {type(raw).__name__}")
    return [w.strip() for w in (_text(x) for x in raw) if w.strip()]


def _normalize_tts_settings(raw: Any) -> Optional[Dict[str, str]]:
    """TTS 設定（accent / gender / speed）。沒帶就是沒帶，不硬塞預設值。"""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"tts_settings 需為物件或 null，收到 {type(raw).__name__}")
    return {
        "accent": _text(raw.get("accent")),
        "gender": _text(raw.get("gender")),
        "speed": _text(raw.get("speed")),
    }


def normalize_scenario_images(raw: Any) -> List[str]:
    """情境圖網址清單（#1146）。去掉空白項；超過上限直接擋下，不靜靜截斷。

    靜靜截斷的話，老師以為存了 6 張、學生只看到 5 張，而且他完全不知道少了哪一張 ——
    前端擷取時已經「保留前 5 張並提示」，送到這裡還超過就是前端的 bug，該讓它爆出來。
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(f"scenario_images 需為陣列，收到 {type(raw).__name__}")
    urls = [u.strip() for u in (_text(x) for x in raw) if u.strip()]
    if len(urls) > MAX_SCENARIO_IMAGES:
        raise ValueError(f"情境圖最多 {MAX_SCENARIO_IMAGES} 張，收到 {len(urls)} 張")
    for url in urls:
        if len(url) > MAX_IMAGE_URL_CHARS:
            raise ValueError("情境圖網址過長")
    return urls


def normalize_settings(raw: Any) -> Optional[Dict[str, Any]]:
    """整份設定正規化，回傳可直接寫進 ``contents.scenario_settings`` 的 dict。

    ``None`` 代表「這次請求沒帶設定」→ 呼叫端不要動既有值。
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"scenario_settings 需為物件，收到 {type(raw).__name__}")

    # 整體評分標準沒有「沿用上層」這回事，所以 None 落成 EMPTY_TENSE 而非保留 None
    global_tense = normalize_tense(raw.get("global_tense"), "global_tense")
    global_voice = normalize_voice(raw.get("global_voice"), "global_voice")

    return {
        # 情境內容：空字串合法（老師只給標題、自己出題也存得起來）
        "scenario_content": _text(raw.get("scenario_content")),
        "question_level": _code(
            raw.get("question_level"), CEFR_LEVELS, "question_level"
        ),
        "global_rubric": _text(raw.get("global_rubric")),
        "global_tense": dict(EMPTY_TENSE) if global_tense is None else global_tense,
        "global_voice": "" if global_voice is None else global_voice,
        "translate_language": _text(raw.get("translate_language")),
        "tts_settings": _normalize_tts_settings(raw.get("tts_settings")),
        # ---- #1146 引導式對話：題目清單頁按「上一步」回到對話時，靠這幾項還原已答
        # 步驟。舊資料沒有它們 → 一律落成空值，前端再由情境文章有無推斷。
        "scenario_mode": _code(
            raw.get("scenario_mode"), SCENARIO_MODES, "scenario_mode"
        ),
        "question_source": _code(
            raw.get("question_source"), QUESTION_SOURCES, "question_source"
        ),
        "goal": _text(raw.get("goal")),
        "article_level": _code(raw.get("article_level"), CEFR_LEVELS, "article_level"),
        "direction": _text(raw.get("direction")),
        "scenario_images": normalize_scenario_images(raw.get("scenario_images")),
    }


def normalize_item(raw: Any) -> Dict[str, Any]:
    """逐題資料正規化，回傳寫進 ``item_metadata['scenario_dialogue']`` 的區塊。"""
    if not isinstance(raw, dict):
        raise ValueError(f"{SCENARIO_ITEM_KEY} 需為物件，收到 {type(raw).__name__}")
    return {
        # 兩個 override 一律保留 None／值的差別，這裡不可以用 `or` 折疊
        "tense_override": normalize_tense(raw.get("tense_override"), "tense_override"),
        "voice_override": normalize_voice(raw.get("voice_override"), "voice_override"),
        "keywords": _normalize_keywords(raw.get("keywords")),
        # 只給 AI 當語言特徵對照，學生端看不到（見模組說明）
        "reference_answer": _text(raw.get("reference_answer")),
        "rubric_note": _text(raw.get("rubric_note")),
        "image_prompt": _text(raw.get("image_prompt")),
    }


def build_item_metadata_block(
    item_data: Dict[str, Any],
    existing_metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """從一筆 item payload 取出情境對話區塊，供寫入 ``item_metadata`` 使用。

    payload 沒帶 ``scenario_dialogue``（或帶 ``null``）時**沿用既有值**：次要儲存
    路徑（例如只更新音檔）不見得會帶整包，重建 metadata 時不能把老師填的參考答案
    與覆寫洗掉 —— 同 ``example_sentence_translation_lang`` 的處理方式（#1004）。

    回傳 ``None`` 代表「沒有東西要寫」，呼叫端就不要放這個 key。
    """
    raw = item_data.get(SCENARIO_ITEM_KEY)
    if raw is None:
        if existing_metadata:
            existing = existing_metadata.get(SCENARIO_ITEM_KEY)
            if isinstance(existing, dict):
                return existing
        return None
    return normalize_item(raw)


def read_item_block(
    item_metadata: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """從 ``item_metadata`` 取出情境對話區塊（沒有就 ``None``）。"""
    if not item_metadata:
        return None
    block = item_metadata.get(SCENARIO_ITEM_KEY)
    return block if isinstance(block, dict) else None


def resolve_effective_tense(
    item_block: Optional[Dict[str, Any]],
    settings: Optional[Dict[str, Any]],
) -> Dict[str, str]:
    """本題實際生效的時態 —— null 語意的唯一落實處。

    ``tense_override is None`` → 取整體；否則取本題自己的值（即使是空的）。
    """
    override = (item_block or {}).get("tense_override")
    if override is None:
        global_tense = (settings or {}).get("global_tense")
        if isinstance(global_tense, dict):
            return {
                "time": global_tense.get("time", ""),
                "aspect": global_tense.get("aspect", ""),
            }
        return dict(EMPTY_TENSE)
    return {"time": override.get("time", ""), "aspect": override.get("aspect", "")}


def resolve_effective_voice(
    item_block: Optional[Dict[str, Any]],
    settings: Optional[Dict[str, Any]],
) -> str:
    """本題實際生效的語態。``voice_override is None`` → 取整體。"""
    override = (item_block or {}).get("voice_override")
    if override is None:
        # 用 is None 而不是 `or ""`：本模組自己的規則就是「不可用 truthiness 折疊」，
        # 今天 global_voice 的合法值恰好只有 active / passive / ""，但哪天多一個
        # falsy 的值，`or` 會把它靜靜地當成沒設定。
        global_voice = (settings or {}).get("global_voice")
        return "" if global_voice is None else global_voice
    return override


def public_item_view(
    item_block: Optional[Dict[str, Any]],
    settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """學生端安全版：**不含** ``reference_answer`` 與 ``image_prompt``。

    override 已在此解析成生效值，學生端不需要（也不該）自己再做繼承推導。
    任何回傳給學生的端點都必須用這個，不要直接吐 ``item_metadata``。
    """
    return {
        "keywords": list((item_block or {}).get("keywords") or []),
        "rubric_note": (item_block or {}).get("rubric_note", ""),
        "tense": resolve_effective_tense(item_block, settings),
        "voice": resolve_effective_voice(item_block, settings),
    }


def teacher_item_view(
    item_block: Optional[Dict[str, Any]],
    settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """老師端（批改頁）版本：**含** ``reference_answer``。

    與 :func:`public_item_view` 是一對 —— 兩邊的差別只有「參考答案給不給」，所以放在
    一起，改一邊時另一邊就在眼前。批改端點原本是手寫這個 dict（#1034 review 指出），
    那等於在模組外面複製了一份形狀，而本模組的定位就是這些資料「怎麼存、怎麼給」的
    唯一判定處。

    ``reference_answer`` 是**示範回答不是唯一正解**：口說同一題每個學生講的內容本來
    就不同，老師要看的是語言特徵（時態、句型、用字水準、資訊完整度）而不是逐字比對
    （#864 規格 3-3）。批改 Panel 上那行提示就是在講這件事。
    """
    block = item_block or {}
    return {
        **public_item_view(item_block, settings),
        "reference_answer": block.get("reference_answer", ""),
    }


def grading_criteria(
    question: str,
    item_block: Optional[Dict[str, Any]],
    settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """AI 評分需要的全部依據（#1035）。

    就是 :func:`teacher_item_view` 再補上題目本文與整份設定裡與評分有關的兩項
    （整體作答指引、題目難度）。放在這裡而不是評分端點裡手組，理由同
    ``teacher_item_view`` 的說明：資料形狀只能有一處。

    刻意**不含** ``image_prompt`` —— 生圖用的描述不是評分依據，餵進 prompt 只會
    讓模型拿畫面內容去要求學生。

    #1146 起帶上**情境文章與情境圖**：題目常是「圖中的人在做什麼？」這類只看題目
    本文答不出來的問題，評分端看不到情境就只能瞎猜學生答得對不對。代價是每次評分的
    input token 變多（圖片尤其明顯），這是使用者確認過的取捨。
    """
    settings = settings or {}
    images = settings.get("scenario_images")
    return {
        **teacher_item_view(item_block, settings),
        "question": question,
        "global_rubric": settings.get("global_rubric", ""),
        "question_level": settings.get("question_level", ""),
        "scenario_content": settings.get("scenario_content", "") or "",
        "scenario_images": list(images) if isinstance(images, list) else [],
    }


def public_settings_view(settings: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """學生端安全版的整份設定：情境內容、情境圖與作答指引學生看得到，其餘是出題端的事。

    ``goal`` / ``direction`` / ``scenario_mode`` 等 #1146 新增的對話紀錄是老師出題時
    的內部筆記，**不給學生**。
    """
    settings = settings or {}
    images = settings.get("scenario_images")
    return {
        "scenario_content": settings.get("scenario_content", ""),
        "scenario_images": list(images) if isinstance(images, list) else [],
        "global_rubric": settings.get("global_rubric", ""),
        "translate_language": settings.get("translate_language", ""),
    }


def copy_settings(value: Any) -> Optional[Dict[str, Any]]:
    """複製整份設定，給「內容副本」路徑使用（作業副本／即刻練習／教材複製）。

    副本一定要帶著整份設定走：逐題的 ``tense_override=None`` 是「沿用整體」，副本沒有
    整體可沿用的話，同一題在副本裡的生效時態就會跟原本不一樣。

    非 dict（含 ``None``、其他題型）一律回 ``None``。淺拷貝即可 —— 這份 dict 只有一層
    巢狀（``global_tense`` / ``tts_settings``），而它們在正規化之後就不再被就地修改，
    每次寫入都是整包換新。
    """
    return dict(value) if isinstance(value, dict) else None


def validate_item_count(count: int) -> None:
    """一份情境對話 3~10 題（#864）。前端擋過一次，後端不能只信前端。"""
    if count < MIN_ITEMS or count > MAX_ITEMS:
        raise ValueError(f"情境對話題數需介於 {MIN_ITEMS}~{MAX_ITEMS} 題，收到 {count} 題")
