"""
考點初始資料 seed（Issue #1061 / #1062）。

考點由平台維護：這裡是初版考點樹（草稿，內容待人工審），用 ``code`` upsert，
可重複執行——已存在的考點只更新 names / parent / order，不會重建、不會改 status，
alias 已存在（不分大小寫）就跳過。**不會刪除**任何 DB 裡多出來的考點。

不放進 migration 的原因：考點內容會持續調整，seed 可獨立重跑；migration 只管
結構。

用法（不改 .env，用環境變數指定要連哪顆 DB）：
    cd backend
    DATABASE_URL="<develop session pooler url>" PYTHONUTF8=1 \\
        venv/Scripts/python.exe scripts/seed_exam_points.py            # 預覽
    DATABASE_URL="..." PYTHONUTF8=1 venv/Scripts/python.exe scripts/seed_exam_points.py --execute
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
from sqlalchemy import create_engine, func  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import models  # noqa: F401, E402  register all models
from models import ExamPoint, ExamPointAlias  # noqa: E402
from models.question_bank import EXAM_POINT_STATUS_ACTIVE  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# (code, zh-TW, en, aliases)。code 用「.」分層，parent 由 code 去掉最後一段推得。
# 同一考點只能有一個正式名稱；常見異名放 aliases，讓「現完式」也能對回來。
EXAM_POINTS = [
    # ---- 文法 ----
    ("grammar", "文法", "Grammar", []),
    ("grammar.tense", "時態", "Tenses", ["時式"]),
    ("grammar.tense.present_simple", "現在簡單式", "Present Simple", ["現在式", "簡單現在式"]),
    ("grammar.tense.present_continuous", "現在進行式", "Present Continuous", ["現進式"]),
    (
        "grammar.tense.present_perfect",
        "現在完成式",
        "Present Perfect",
        ["現完式", "現在完成時態", "present perfect tense"],
    ),
    ("grammar.tense.past_simple", "過去簡單式", "Past Simple", ["過去式", "簡單過去式"]),
    ("grammar.tense.past_continuous", "過去進行式", "Past Continuous", []),
    ("grammar.tense.past_perfect", "過去完成式", "Past Perfect", ["過完式"]),
    (
        "grammar.tense.future_simple",
        "未來簡單式",
        "Future Simple",
        ["未來式", "will / be going to"],
    ),
    ("grammar.modal", "助動詞", "Modal Verbs", ["情態助動詞"]),
    ("grammar.passive", "被動語態", "Passive Voice", ["被動式"]),
    ("grammar.conditional", "條件句", "Conditionals", ["假設語氣", "if 子句"]),
    ("grammar.relative_clause", "關係子句", "Relative Clauses", ["關係代名詞", "形容詞子句"]),
    ("grammar.noun_clause", "名詞子句", "Noun Clauses", []),
    ("grammar.adverb_clause", "副詞子句", "Adverb Clauses", ["連接詞子句"]),
    ("grammar.comparison", "比較級與最高級", "Comparatives & Superlatives", ["比較級", "最高級"]),
    (
        "grammar.gerund_infinitive",
        "動名詞與不定詞",
        "Gerunds & Infinitives",
        ["動名詞", "不定詞", "to V / Ving"],
    ),
    ("grammar.article", "冠詞", "Articles", ["a / an / the"]),
    ("grammar.preposition", "介系詞", "Prepositions", ["介詞"]),
    ("grammar.pronoun", "代名詞", "Pronouns", []),
    ("grammar.question", "疑問句", "Questions", ["wh- 問句", "yes/no 問句"]),
    ("grammar.subject_verb_agreement", "主詞動詞一致", "Subject-Verb Agreement", ["主動一致"]),
    ("grammar.word_order", "詞序", "Word Order", ["語序"]),
    # ---- 字彙 ----
    ("vocab", "字彙", "Vocabulary", ["單字"]),
    ("vocab.meaning", "字義", "Word Meaning", ["單字意思"]),
    ("vocab.collocation", "搭配詞", "Collocations", ["片語搭配"]),
    ("vocab.phrasal_verb", "片語動詞", "Phrasal Verbs", ["動詞片語"]),
    ("vocab.word_form", "詞性變化", "Word Forms", ["詞類變化", "part of speech"]),
    ("vocab.synonym_antonym", "同義／反義字", "Synonyms & Antonyms", ["同義字", "反義字"]),
    ("vocab.idiom", "慣用語", "Idioms", ["成語", "俚語"]),
    # ---- 閱讀 ----
    ("reading", "閱讀理解", "Reading Comprehension", ["閱讀"]),
    ("reading.main_idea", "主旨大意", "Main Idea", ["文章主旨"]),
    ("reading.detail", "細節理解", "Supporting Details", ["細節題"]),
    ("reading.inference", "推論", "Inference", ["推理題"]),
    ("reading.vocabulary_in_context", "上下文猜字", "Vocabulary in Context", ["字義推測"]),
    ("reading.reference", "指涉理解", "Reference", ["代名詞指涉"]),
    ("reading.text_structure", "篇章結構", "Text Structure", ["段落結構"]),
    # ---- 聽力 ----
    ("listening", "聽力理解", "Listening Comprehension", ["聽力"]),
    ("listening.picture", "看圖辨義", "Picture Description", ["圖片聽力"]),
    ("listening.response", "簡答應答", "Appropriate Response", ["問答", "應答題"]),
    ("listening.dialogue", "對話理解", "Dialogue Comprehension", ["對話聽力", "簡短對話"]),
    ("listening.monologue", "短文聽解", "Monologue Comprehension", ["獨白聽力", "短文聽力"]),
    # ---- 語用 ----
    ("pragmatics", "語用與情境", "Pragmatics", ["情境用語"]),
    ("pragmatics.daily_conversation", "日常對話", "Daily Conversation", ["生活會話"]),
    ("pragmatics.function", "語言功能", "Language Functions", ["請求", "道歉", "邀請"]),
]


def _parent_code(code: str):
    return code.rsplit(".", 1)[0] if "." in code else None


def seed(session, execute: bool) -> None:
    created = updated = aliases_added = 0
    by_code = {ep.code: ep for ep in session.query(ExamPoint).all()}
    existing_aliases = {
        a[0].lower() for a in session.query(func.lower(ExamPointAlias.alias)).all()
    }

    for order, (code, zh, en, aliases) in enumerate(EXAM_POINTS):
        parent_code = _parent_code(code)
        parent = by_code.get(parent_code) if parent_code else None
        if parent_code and parent is None:
            raise SystemExit(f"parent {parent_code} of {code} 未定義，請調整順序")

        ep = by_code.get(code)
        names = {"zh-TW": zh, "en": en}
        if ep is None:
            ep = ExamPoint(
                code=code,
                names=names,
                parent_id=parent.id if parent else None,
                status=EXAM_POINT_STATUS_ACTIVE,
                order_index=order,
            )
            session.add(ep)
            session.flush()
            by_code[code] = ep
            created += 1
            print(f"  + {code}  {zh} / {en}")
        else:
            changed = (
                ep.names != names
                or ep.parent_id != (parent.id if parent else None)
                or ep.order_index != order
            )
            if changed:
                ep.names = names
                ep.parent_id = parent.id if parent else None
                ep.order_index = order
                updated += 1
                print(f"  ~ {code}  {zh} / {en}")

        for alias in aliases:
            if alias.lower() in existing_aliases:
                continue
            session.add(ExamPointAlias(exam_point_id=ep.id, alias=alias))
            existing_aliases.add(alias.lower())
            aliases_added += 1
            print(f"      alias: {alias} -> {code}")

    print(
        f"\n考點 新增 {created}、更新 {updated}；alias 新增 {aliases_added}"
        f"（DB 既有 {len(by_code) - created} 筆保留）"
    )
    if execute:
        session.commit()
        print("✅ 已寫入")
    else:
        session.rollback()
        print("（預覽，未寫入；加 --execute 才會寫）")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed exam points (upsert by code)")
    parser.add_argument("--execute", action="store_true", help="實際寫入 DB")
    args = parser.parse_args()

    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL 未設定")
    # 不印連線字串，只印 host 尾段供辨認
    host = url.split("@")[-1].split("/")[0]
    print(f"DB host: {host}")

    engine = create_engine(url)
    session = sessionmaker(bind=engine)()
    try:
        seed(session, execute=args.execute)
    finally:
        session.close()


if __name__ == "__main__":
    main()
