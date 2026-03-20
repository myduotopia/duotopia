"""
Translation service using OpenAI API or Vertex AI (Gemini)

Supports switching between OpenAI and Vertex AI via USE_VERTEX_AI environment variable.
"""

import os
import json as json_module
import asyncio
import logging
from pathlib import Path
from typing import List, Dict, Optional  # noqa: F401
from openai import OpenAI, AsyncOpenAI
from dotenv import load_dotenv
from utils.http_client import get_http_client

# 載入文法規則（按 CEFR 級別）
_grammar_rules_path = Path(__file__).parent.parent / "config" / "grammar_by_level.json"
with open(_grammar_rules_path, "r", encoding="utf-8") as _f:
    GRAMMAR_BY_LEVEL: Dict[str, List[str]] = json_module.load(_f)

load_dotenv()

logger = logging.getLogger(__name__)


class TranslationService:
    def __init__(self):
        self.use_vertex_ai = os.getenv("USE_VERTEX_AI", "false").lower() == "true"
        self.client = None  # OpenAI client (lazy init)
        self.vertex_ai = None  # Vertex AI service (lazy init)
        self.model = "gpt-4o-mini"  # OpenAI model (for fallback)

    def _ensure_client(self):
        """Lazy initialization of AI client (OpenAI or Vertex AI)"""
        if self.use_vertex_ai:
            if self.vertex_ai is None:
                from services.vertex_ai import get_vertex_ai_service

                self.vertex_ai = get_vertex_ai_service()
                logger.info("Using Vertex AI (Gemini) for translation")
        else:
            if self.client is None:
                api_key = os.getenv("OPENAI_API_KEY")
                if not api_key:
                    raise ValueError(
                        "OPENAI_API_KEY not found in environment variables"
                    )
                # Use shared http_client for connection pooling
                self.client = AsyncOpenAI(
                    api_key=api_key, http_client=get_http_client()
                )
                logger.info("Using OpenAI for translation")

    async def translate_text(self, text: str, target_lang: str = "zh-TW") -> str:
        """
        翻譯單一文本

        Args:
            text: 要翻譯的文本
            target_lang: 目標語言（預設為繁體中文）

        Returns:
            翻譯後的文本
        """
        self._ensure_client()

        try:
            # 根據目標語言設定 prompt
            if target_lang == "zh-TW":
                prompt = (
                    f"請將以下英文單字翻譯成繁體中文：{text}\n\n"
                    f"規則：\n"
                    f"1. 只有當該字有多個明確不同的常見字義時，才提供多個翻譯（最多3個），以編號列出。\n"
                    f"2. 簡單的字只需要1個翻譯即可。\n"
                    f"3. 每個翻譯前必須加上詞性縮寫，格式：(詞性.) 翻譯\n"
                    f"4. 只回覆翻譯結果，不要加任何說明。\n"
                    f"詞性縮寫：n. v. adj. adv. prep. conj. interj. pron. det. aux.\n"
                    f"範例（多字義）：\n"
                    f"1. (v.) 識別\n"
                    f"2. (v.) 認同\n"
                    f"範例（單字義）：\n"
                    f"(n.) 蘋果"
                )
            elif target_lang == "en":
                # 英英釋義
                prompt = (
                    f"Provide English definitions for the word: {text}\n\n"
                    f"RULES:\n"
                    f'1. NEVER use the word "{text}" (or any of its forms) in the definition.\n'
                    f"2. Each definition MUST be 15 words or fewer.\n"
                    f"3. Only provide multiple definitions if the word has truly "
                    f"distinct meanings. Simple words need only 1. Max 3.\n"
                    f"4. Include POS abbreviation and follow this starter by part of speech:\n"
                    f'   - Noun: "(n.) a/an ..."\n'
                    f'   - Verb: "(v.) to ..."\n'
                    f'   - Adjective: "(adj.) describing ..."\n'
                    f'   - Adverb: "(adv.) in a way that ..."\n'
                    f'   - Preposition: "(prep.) indicating ..."\n'
                    f'   - Conjunction: "(conj.) connecting ..."\n'
                    f'   - Interjection: "(interj.) expressing ..."\n'
                    f"5. Start with lowercase after POS abbreviation. Do NOT end with a period.\n"
                    f"Example for 'apple': 1. (n.) a round fruit with red or green skin\n"
                    f"Only return the numbered definitions, no other text."
                )
            elif target_lang in ("ja", "ko"):
                lang_label = "日文" if target_lang == "ja" else "韓文"
                example_single = "りんご" if target_lang == "ja" else "사과"
                example_multi_1 = "識別する" if target_lang == "ja" else "식별하다"
                example_multi_2 = "同一視する" if target_lang == "ja" else "동일시하다"
                prompt = (
                    f"請將以下英文單字翻譯成{lang_label}：{text}\n\n"
                    f"規則：\n"
                    f"1. 只有當該字有多個明確不同的常見字義時，才提供多個翻譯（最多3個），以編號列出。\n"
                    f"2. 簡單的字只需要1個翻譯即可。\n"
                    f"3. 每個翻譯前必須加上詞性縮寫，格式：(詞性.) 翻譯\n"
                    f"4. 只回覆翻譯結果，不要加任何說明。\n"
                    f"詞性縮寫：n. v. adj. adv. prep. conj. interj. pron. det. aux.\n"
                    f"範例（多字義）：\n"
                    f"1. (v.) {example_multi_1}\n"
                    f"2. (v.) {example_multi_2}\n"
                    f"範例（單字義）：\n"
                    f"(n.) {example_single}"
                )
            else:
                prompt = (
                    f"Please translate the following text to {target_lang}, "
                    f"only return the translation without any explanation:\n{text}"
                )

            system_instruction = (
                "You are a professional translator. Only provide the "
                "translation without any explanation. "
                "CRITICAL: When translating to Chinese, you MUST use Traditional Chinese (繁體中文), "
                "NOT Simplified Chinese."
            )

            # 英英釋義需要更多 tokens（最多 3 個定義 + 詞性標記）
            token_limit = 200 if target_lang == "en" else 100

            # Use Vertex AI or OpenAI based on configuration
            if self.use_vertex_ai:
                result = await self.vertex_ai.generate_text(
                    prompt=prompt,
                    model_type="flash",
                    max_tokens=token_limit,
                    temperature=0.3,
                    system_instruction=system_instruction,
                )
                return result.strip()
            else:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,  # 降低隨機性以獲得更一致的翻譯
                    max_tokens=token_limit,
                )
                return response.choices[0].message.content.strip()

        except Exception as e:
            logger.error("Translation error: %s", e)
            # 如果翻譯失敗，返回原文
            return text

    async def translate_with_pos(
        self, text: str, target_lang: str = "zh-TW"
    ) -> Dict[str, any]:
        """
        翻譯單字並辨識詞性（委託給 batch 版本以獲得更穩定的結果）

        Args:
            text: 要翻譯的單字
            target_lang: 目標語言（預設為繁體中文）

        Returns:
            包含 translation 和 parts_of_speech 的字典
        """
        results = await self.batch_translate_with_pos([text], target_lang)
        if results and len(results) > 0:
            return results[0]
        # Fallback
        translation = await self.translate_text(text, target_lang)
        return {"translation": translation, "parts_of_speech": []}

    async def batch_translate(
        self, texts: List[str], target_lang: str = "zh-TW"
    ) -> List[str]:
        """
        批次翻譯多個文本（使用 JSON 格式確保穩定快速）

        Args:
            texts: 要翻譯的文本列表
            target_lang: 目標語言（預設為繁體中文）

        Returns:
            翻譯後的文本列表
        """
        self._ensure_client()

        try:
            # 使用 JSON 格式以確保解析穩定性
            import json

            texts_json = json.dumps(texts, ensure_ascii=False)

            if target_lang == "zh-TW":
                prompt = f"""請將以下 JSON 陣列中的英文翻譯成繁體中文。
直接返回 JSON 陣列格式，每個翻譯對應一個項目。
只返回 JSON 陣列，不要任何其他文字或說明。
為兼容舊版測試，可使用 '---' 分隔多個翻譯（同樣需保持項目數量一致）。

輸入: {texts_json}

要求: 返回格式必須是 ["翻譯1", "翻譯2", ...]"""
            elif target_lang == "en":
                prompt = f"""Provide English definitions for the following words.
Return as a JSON array with each definition as one item.

RULES:
1. NEVER use the target word (or any of its forms) in its own definition.
2. Each definition MUST be 15 words or fewer.
3. For each word, only provide multiple definitions if it has truly distinct \
meanings (max 3), in a single string, numbered.
4. Include POS abbreviation and follow the starter by part of speech:
   - Noun: "(n.) a/an ..."
   - Verb: "(v.) to ..."
   - Adjective: "(adj.) describing ..."
   - Adverb: "(adv.) in a way that ..."
   - Preposition: "(prep.) indicating ..."
   - Conjunction: "(conj.) connecting ..."
   - Interjection: "(interj.) expressing ..."
5. Start with lowercase after POS abbreviation. Do NOT end with a period.
6. Example for 'apple': "1. (n.) a round fruit with red or green skin"

Input: {texts_json}

Required: Return format must be ["1. (n.) definition...", "1. (v.) definition...", ...]
Only return the JSON array, no other text."""
            else:
                prompt = f"""Please translate the following JSON array to {target_lang}.
Return as a JSON array with each translation as one item.
Only return the JSON array, no other text.

Input: {texts_json}

Required: Return format must be ["translation1", "translation2", ...]"""

            system_instruction = (
                "You are a professional translator. Always return results "
                "as a valid JSON array with the exact same number of items as input. "
                "Return ONLY the JSON array, no markdown, no explanation. "
                "CRITICAL: When translating to Chinese, you MUST use Traditional Chinese (繁體中文), "
                "NOT Simplified Chinese."
            )

            # Use Vertex AI or OpenAI based on configuration
            if self.use_vertex_ai:
                translations = await self.vertex_ai.generate_json(
                    prompt=prompt,
                    model_type="flash",
                    max_tokens=3500,
                    temperature=0.3,
                    system_instruction=system_instruction,
                )
                # Ensure it's a list
                if isinstance(translations, str):
                    translations = translations.split("---")
            else:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,
                    max_tokens=3500,  # 提高上限以支持更多句子的批次翻译
                )

                # 解析 JSON 回應
                import re

                content = response.choices[0].message.content.strip()

                # 移除可能的 markdown 代碼塊標記
                content = re.sub(r"^```json\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
                content = content.strip()

                # Try JSON parse; handle legacy separator when JSON decode fails
                try:
                    translations = json.loads(content)
                except Exception:
                    # If not JSON, fall back to separator or raw string
                    if "---" in content:
                        translations = [
                            seg.strip() for seg in content.split("---") if seg.strip()
                        ]
                    else:
                        translations = [content.strip()] if content else []
                if isinstance(translations, str):
                    translations = translations.split("---")

            # 確保返回的翻譯數量與輸入相同
            if len(translations) != len(texts):
                # Try manual split on separator if present
                if isinstance(content, str) and "---" in content:
                    manual = [
                        seg.strip() for seg in content.split("---") if seg.strip()
                    ]
                    if len(manual) == len(texts):
                        translations = manual
                    else:
                        logger.warning(
                            "Batch translation count mismatch "
                            "(expected %d, got %d), "
                            "falling back to individual translation.",
                            len(texts),
                            len(translations),
                        )
                        return texts
                else:
                    logger.warning(
                        "Batch translation count mismatch "
                        "(expected %d, got %d), "
                        "falling back to individual translation.",
                        len(texts),
                        len(translations),
                    )
                    return texts

            return translations
        except Exception as e:
            logger.error(
                "Batch translation error: %s. Falling back to individual translation.",
                e,
            )
            return texts

    async def batch_translate_with_pos(
        self, texts: List[str], target_lang: str = "zh-TW"
    ) -> List[Dict[str, any]]:
        """
        批次翻譯多個單字並辨識詞性

        Args:
            texts: 要翻譯的單字列表
            target_lang: 目標語言（預設為繁體中文）

        Returns:
            包含 translation 和 parts_of_speech 的字典列表
        """
        self._ensure_client()
        import json

        try:
            texts_json = json.dumps(texts, ensure_ascii=False)

            if target_lang == "zh-TW":
                prompt = f"""請分析以下英文單字列表，為每個單字提供：
1. 繁體中文翻譯
2. 詞性（必須列出所有常見用法的詞性）

單字列表: {texts_json}

重要提示：
- 許多英文單字有多種詞性，請列出所有常見的用法
- 例如：顏色詞（red, blue, green）通常既是形容詞也是名詞
- 例如：動作詞（run, walk, dance）通常既是動詞也是名詞
- 例如：材料詞（gold, silver, plastic）通常既是名詞也是形容詞
- 請勿遺漏任何常見詞性

請以 JSON 陣列格式回覆，格式如下：
[{{"translation": "翻譯1", "parts_of_speech": ["n.", "adj."]}}, {{"translation": "翻譯2", "parts_of_speech": ["v.", "n."]}}]

詞性縮寫：n. (名詞), v. (動詞), adj. (形容詞), adv. (副詞),
pron. (代名詞), prep. (介系詞), conj. (連接詞), interj. (感嘆詞),
det. (限定詞), aux. (助動詞)

只回覆 JSON 陣列，不要其他文字。"""
            else:
                prompt = f"""Analyze the following English words and provide for each:
1. English definition(s) — only provide multiple if the word has truly distinct \
meanings (max 3), numbered in a single string
2. Parts of speech (MUST list ALL common usages)

Words: {texts_json}

DEFINITION RULES:
- NEVER use the target word (or any of its forms) in its own definition.
- Each definition MUST be 15 words or fewer.
- Start with lowercase after POS abbreviation. Do NOT end with a period.
- Follow this starter by part of speech:
  Noun: "(n.) a/an ..."  |  Verb: "(v.) to ..."  |  Adjective: "(adj.) describing ..."
  Adverb: "(adv.) in a way that ..."  |  Preposition: "(prep.) indicating ..."
- Example for 'apple': "1. (n.) a round fruit with red or green skin"

IMPORTANT:
- Many English words have multiple parts of speech - list ALL common usages
- Colors (red, blue, green) are typically both adjectives AND nouns
- Action words (run, walk, dance) are typically both verbs AND nouns
- Material words (gold, silver, plastic) are typically both nouns AND adjectives
- Do NOT omit any common part of speech

Reply as JSON array:
[{{"translation": "1. (n.) definition here", "parts_of_speech": ["n.", "adj."]}}, \
{{"translation": "1. (v.) definition here", "parts_of_speech": ["v.", "n."]}}]

POS abbreviations: n. (noun), v. (verb), adj. (adjective), adv. (adverb),
pron. (pronoun), prep. (preposition), conj. (conjunction), interj. (interjection),
det. (determiner), aux. (auxiliary)

Only reply with JSON array, no other text."""

            system_instruction = (
                "You are a professional linguist specializing in English grammar. "
                "When identifying parts of speech, you MUST list ALL common usages - "
                "many English words function as multiple parts of speech. "
                "CRITICAL: When translating to Chinese, you MUST use Traditional Chinese (繁體中文), "
                "NOT Simplified Chinese. Always respond with valid JSON array only."
            )

            # Use Vertex AI or OpenAI based on configuration
            if self.use_vertex_ai:
                results = await self.vertex_ai.generate_json(
                    prompt=prompt,
                    model_type="flash",
                    max_tokens=2000,
                    temperature=0.2,
                    system_instruction=system_instruction,
                )
            else:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,  # Lower temperature for more consistent POS detection
                    max_tokens=2000,
                )

                # 解析 JSON 回應
                import re

                content = response.choices[0].message.content.strip()
                content = re.sub(r"^```json\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
                content = content.strip()

                results = json.loads(content)

            # 確保返回數量正確
            if len(results) != len(texts):
                logger.warning(
                    "Expected %d results, got %d. Falling back.",
                    len(texts),
                    len(results),
                )
                # Fallback: 逐個處理
                tasks = [self.translate_with_pos(text, target_lang) for text in texts]
                results = await asyncio.gather(*tasks)

            return results
        except Exception as e:
            logger.error("Batch translate with POS error: %s. Falling back.", e)
            # Fallback: 逐個處理
            tasks = [self.translate_with_pos(text, target_lang) for text in texts]
            results = await asyncio.gather(*tasks)
            return results

    async def generate_sentences(
        self,
        words: List[str],
        definitions: Optional[List[str]] = None,
        unit_context: Optional[str] = None,
        lesson_name: Optional[str] = None,
        program_name: Optional[str] = None,
        program_description: Optional[str] = None,
        program_tags: Optional[List[str]] = None,
        level: str = "A1",
        prompt: Optional[str] = None,
        translate_to: Optional[str] = None,
        parts_of_speech: Optional[List[List[str]]] = None,
    ) -> List[Dict[str, str]]:
        """
        使用 AI 為單字生成例句

        Args:
            words: 單字列表
            definitions: 單字的中文翻譯列表（用於消歧義，如 "put" → "放置"）
            unit_context: 單元描述（教學目標或主題，來自 Lesson.description）
            lesson_name: 單元名稱
            program_name: 課程名稱
            program_description: 課程描述（教學意圖）
            program_tags: 課程標籤
            level: CEFR 等級 (A1, A2, B1, B2, C1, C2)
            prompt: 使用者自訂 prompt
            translate_to: 翻譯目標語言 (zh-TW, ja, ko)
            parts_of_speech: 每個單字的詞性列表

        Returns:
            包含 sentence 和 translation 的字典列表
        """
        self._ensure_client()
        import json

        try:
            # 構建單字資訊
            words_info = []
            for i, word in enumerate(words):
                info = {"word": word}
                if definitions and i < len(definitions) and definitions[i]:
                    info["definition"] = definitions[i]  # 翻譯/解釋（用於消歧義，可能是任何語言）
                if parts_of_speech and i < len(parts_of_speech) and parts_of_speech[i]:
                    info["pos"] = ", ".join(parts_of_speech[i])
                words_info.append(info)

            words_json = json.dumps(words_info, ensure_ascii=False)

            # 計算翻譯語言名稱（用於 system prompt）
            translation_lang_name = (
                {
                    "zh-TW": "Traditional Chinese (繁體中文)",
                    "ja": "Japanese",
                    "ko": "Korean",
                }.get(translate_to, translate_to)
                if translate_to
                else None
            )

            # 動態構建第 2 條 CRITICAL REQUIREMENT
            if not translate_to or translate_to == "zh-TW":
                critical_2 = (
                    "2. If translating to Chinese, you MUST use "
                    "Traditional Chinese (繁體中文), NOT Simplified Chinese."
                )
            else:
                critical_2 = (
                    f"2. When translating, you MUST translate to "
                    f"{translation_lang_name} only. Do NOT translate "
                    f"to Chinese or any other language."
                )

            # 構建 system prompt
            system_prompt = f"""You are an English teacher creating example sentences for language learners.
Generate ONE example sentence for each word at CEFR level {level}.
The sentences should be natural, educational, and appropriate for the difficulty level.

CRITICAL REQUIREMENTS:
1. Each sentence MUST contain the exact target word (the word being learned). Do NOT use synonyms or derivatives.
{critical_2}
3. **IF A WORD HAS A "definition" FIELD, YOU MUST USE THAT SPECIFIC MEANING.**
   - The "definition" field contains the teacher's chosen translation/meaning (may be in any language)
   - Many English words have multiple meanings (e.g., "like" = 喜歡 or 像是, "change" = 改變 or 零錢)
   - Example: {{"word": "put", "definition": "放置"}} → generate sentence about placing/putting, NOT other meanings
   - This is the HIGHEST PRIORITY requirement
4. **IF A WORD HAS A SINGLE "pos" FIELD (e.g., "n." or "v."), THE SENTENCE MUST USE THE WORD AS THAT PART OF SPEECH.**
   - Example: {{"word": "run", "pos": "n."}} → "The morning run felt refreshing." (noun usage, NOT verb)
   - Example: {{"word": "like", "pos": "prep."}} → "She looks like her mother." (preposition, NOT verb)
   - If "pos" contains multiple values (e.g., "n., v."), use the meaning indicated by the "definition" field instead
5. **IF USER PROVIDES CUSTOM INSTRUCTIONS, YOU MUST FOLLOW THEM EXACTLY.**
   - Custom instructions override the default interpretation

Level guidelines:
- A1: Simple present/past, basic vocabulary, short sentences (5-8 words)
- A2: Simple sentences with common phrases, everyday topics (8-12 words)
- B1: Compound sentences, wider vocabulary, various tenses (12-20 words)
- B2: Complex sentences, idiomatic expressions, abstract topics (15-25 words).
  FORBIDDEN: Do NOT use simple present or simple past for more than 30%.
- C1: Sophisticated vocabulary, nuanced meaning, formal/informal register (18-30 words).
  FORBIDDEN: Do NOT use simple present or simple past for more than 20%.
- C2: Near-native fluency, literary style, rare vocabulary acceptable.
  FORBIDDEN: Do NOT use simple present or simple past for more than 10%.

6. **GRAMMAR VARIETY (MANDATORY)**:
   You MUST distribute grammar patterns across ALL sentences.
   Even for a single sentence, pick a grammar point that is NOT simple present
   or simple past (for B1 and above).
   For batch generation, each sentence MUST use a DIFFERENT grammar pattern.
   Do NOT default to simple present/past — actively choose from this list for {level}:
{chr(10).join(f'   - {g}' for g in GRAMMAR_BY_LEVEL.get(level, GRAMMAR_BY_LEVEL.get("B1", [])))}

7. **SUBJECT VARIETY**: Do NOT start every sentence with pronouns \
(He, She, They, I). Vary sentence subjects: use proper names (Tom, Maria), \
job titles (The teacher, A scientist), concrete nouns (The old building, \
This recipe), abstract nouns (Happiness, His decision), gerund phrases \
(Running every day...), or "There/It" structures."""

            # 構建 user prompt
            user_prompt = ""

            # 高優先級：教學指引（課程描述、單元描述、程度）
            guidelines = []
            if level:
                guidelines.append(f"- Course level: {level}")
            if program_description:
                guidelines.append(f"- Course description: {program_description}")
            if unit_context:
                guidelines.append(f"- Unit description: {unit_context}")

            if guidelines:
                user_prompt += f"""**TEACHING GUIDELINES (SHOULD FOLLOW)**:
{chr(10).join(guidelines)}

These are the teacher's pedagogical intentions. You SHOULD follow these \
guidelines when generating sentences, especially grammar patterns and \
topics mentioned. Only override if it conflicts with word definition or \
part of speech requirements above.

"""

            # 低優先級：背景參考（課程名稱、單元名稱、標籤）
            background = []
            if program_name:
                background.append(f"- Course: {program_name}")
            if lesson_name:
                background.append(f"- Unit: {lesson_name}")
            if program_tags:
                background.append(f"- Tags: {', '.join(program_tags)}")

            if background:
                user_prompt += f"""**TEACHING BACKGROUND** (for reference):
{chr(10).join(background)}

"""

            # 如果有自訂 prompt，要在最前面強調
            if prompt:
                user_prompt += f"""**CRITICAL USER REQUIREMENT (MUST FOLLOW)**:
{prompt}

This instruction OVERRIDES the default interpretation. For example:
- If the word is "like" and user says "use 像是 meaning", you MUST generate sentences
  where "like" means "similar to/such as", NOT "to enjoy".
- If the word is "change" and user says "use 零錢 meaning", you MUST generate sentences
  about coins/change (money), NOT about modification.

"""

            user_prompt += f"""Generate example sentences for the following words:
{words_json}

IMPORTANT: If a word has a "definition" field, you MUST use that specific meaning in the sentence.

"""

            if translate_to:
                user_prompt += f"""Return as JSON array with this format:
[{{"sentence": "...", "translation": "..."}}]
Where translation MUST be in {translation_lang_name}.
IMPORTANT: Each English sentence MUST contain the exact target word."""
                if translate_to == "zh-TW":
                    user_prompt += (
                        "\nTranslation to Chinese MUST use Traditional "
                        "Chinese (繁體中文), NOT Simplified Chinese."
                    )
            else:
                user_prompt += """Return as JSON array with this format:
[{"sentence": "..."}]"""

            user_prompt += "\n\nOnly return the JSON array, no other text."

            # Use Vertex AI or OpenAI based on configuration
            if self.use_vertex_ai:
                sentences = await self.vertex_ai.generate_json(
                    prompt=user_prompt,
                    model_type="flash",
                    max_tokens=2000,
                    temperature=0.8,
                    system_instruction=system_prompt,
                )
            else:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.7,  # 稍高一點讓例句更有變化
                    max_tokens=2000,
                )

                # 解析回應
                import re

                content = response.choices[0].message.content.strip()

                # 移除可能的 markdown 代碼塊標記
                content = re.sub(r"^```json\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
                content = content.strip()

                sentences = json.loads(content)

            # 確保返回數量正確並添加 word 欄位以防止陣列錯位
            if len(sentences) != len(words):
                logger.warning(
                    "Expected %d sentences, got %d.", len(words), len(sentences)
                )
                # 補齊或截斷
                while len(sentences) < len(words):
                    word = words[len(sentences)]
                    sentences.append({"sentence": f"Example with {word}", "word": word})
                sentences = sentences[: len(words)]

            # 為每個句子添加 word 欄位，確保 1:1 對應關係
            for i, sentence in enumerate(sentences):
                if "word" not in sentence:
                    sentence["word"] = words[i]

            return sentences

        except Exception as e:
            logger.error("Generate sentences error: %s", e)
            # Fallback: 返回簡單的預設例句，包含 word 欄位確保對應
            fallback_sentences = []
            for word in words:
                sentence_obj = {
                    "sentence": f"This is an example with {word}.",
                    "word": word,
                }
                # 如果需要翻譯，添加翻譯欄位
                if translate_to:
                    sentence_obj["translation"] = ""
                fallback_sentences.append(sentence_obj)
            return fallback_sentences

    async def generate_distractors(
        self,
        word: str,
        translation: str,
        count: int = 2,
        part_of_speech: Optional[str] = None,
    ) -> List[str]:
        """
        Generate distractor options for vocabulary selection quiz.

        Uses AI to generate semantically similar but different Chinese translations
        that can be used as wrong answer choices.

        Args:
            word: The English word (e.g., "apple")
            translation: The correct Chinese translation (e.g., "蘋果")
            count: Number of distractors to generate (default: 2, 另外1個由同作業其他單字提供)
            part_of_speech: Optional part of speech to help generate better distractors

        Returns:
            List of distractor translations (e.g., ["香蕉", "橘子"])
        """
        self._ensure_client()
        import json

        try:
            pos_hint = f"詞性: {part_of_speech}" if part_of_speech else ""

            prompt = f"""為單字 "{word}"（正確翻譯: {translation}）生成 {count} 個干擾項（錯誤選項）。
{pos_hint}

## 核心原則

生成「同領域但意思不同」的干擾項。

## 規則

1. **絕對禁止近義詞**：意思相近的詞不能當干擾項
   - change/改變 → ❌ 變化、轉變、調整
   - cost/成本 → ❌ 費用、價格、開支
   - config/配置 → ❌ 設定、設置

2. **允許使用反義詞，但要有多樣性**：反義詞可以出現，但不要全部都是反義詞
   - 如果生成 2 個干擾項，最多 1 個可以是反義詞

3. **優先使用「同領域但不相關」的詞**：
   - change/改變 → ✅ 移動、旋轉、執行（都是動作動詞）
   - cost/成本 → ✅ 利潤、營收、淨值（都是財務術語）
   - associated/相關 → ✅ 公開、預設、必要（都是描述性質）

## 範例

| 單字 | 正確翻譯 | ✅ 好的干擾項 | 為什麼好 |
|------|----------|---------------|----------|
| change | 改變 | 移動、執行 | 同領域不相關 |
| increase | 增加 | 計算、減少 | 1個不相關 + 1個反義 ✅ |
| happy | 快樂 | 驚訝、悲傷 | 1個不相關 + 1個反義 ✅ |
| apple | 蘋果 | 香蕉、橘子 | 都是水果但不是蘋果 |

## 輸出格式
JSON 陣列，只包含 {count} 個干擾項：
["干擾項1", "干擾項2"]

只回覆 JSON 陣列，不要其他文字。"""

            system_instruction = (
                "You are a vocabulary quiz generator. Generate WRONG answers (distractors) that are: "
                "1) NEVER synonyms - if it could be a correct translation, don't use it "
                "2) Antonyms are OK but not ALL of them - mix antonyms with unrelated words "
                "3) Prefer same domain but UNRELATED meaning (同領域但不相關) "
                "4) All in Traditional Chinese. JSON array only."
            )

            # Use Vertex AI or OpenAI based on configuration
            if self.use_vertex_ai:
                distractors = await self.vertex_ai.generate_json(
                    prompt=prompt,
                    model_type="flash",
                    max_tokens=200,
                    temperature=0.2,  # Very low temperature to strictly follow prompt rules
                    system_instruction=system_instruction,
                )
            else:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,  # Very low temperature to strictly follow prompt rules
                    max_tokens=200,
                )

                # Parse JSON response
                import re

                content = response.choices[0].message.content.strip()
                # Remove markdown code block markers if present
                content = re.sub(r"^```json\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
                content = content.strip()

                distractors = json.loads(content)

            # Filter: remove duplicates (case-insensitive) and correct answer
            seen = {translation.lower().strip()}
            unique_distractors = []
            for d in distractors:
                d_normalized = d.lower().strip()
                if d_normalized not in seen and d.strip():
                    seen.add(d_normalized)
                    unique_distractors.append(d)
            distractors = unique_distractors[:count]

            # Ensure we have enough distractors
            if len(distractors) < count:
                logger.warning(
                    f"Only generated {len(distractors)} distractors for '{word}', "
                    f"expected {count}"
                )

            return distractors

        except Exception as e:
            logger.error(f"Generate distractors error for '{word}': {e}")
            # Fallback: return generic distractors
            fallback = ["選項A", "選項B", "選項C"]
            return fallback[:count]

    async def batch_generate_distractors(
        self,
        words: List[Dict[str, str]],
        count: int = 2,
    ) -> List[List[str]]:
        """
        Batch generate distractors for multiple words.

        Args:
            words: List of dicts with 'word', 'translation', and optionally 'part_of_speech'
            count: Number of distractors per word (default: 2, 另外1個由同作業其他單字提供)

        Returns:
            List of distractor lists, one per input word
        """
        self._ensure_client()
        import json

        try:
            words_json = json.dumps(
                [{"word": w["word"], "translation": w["translation"]} for w in words],
                ensure_ascii=False,
            )

            prompt = f"""為以下單字列表生成干擾項（錯誤選項）。每個單字需要 {count} 個干擾項。

⚠️ 重要：輸出順序必須與輸入順序完全一致！

單字列表（請按此順序輸出）:
{words_json}

## 核心原則

生成「同領域但意思不同」的干擾項。

## 規則

1. **絕對禁止近義詞**：意思相近的詞不能當干擾項
   - change/改變 → ❌ 變化、轉變、調整
   - cost/成本 → ❌ 費用、價格、開支
   - config/配置 → ❌ 設定、設置

2. **允許使用反義詞，但要有多樣性**：反義詞可以出現，但不要全部都是反義詞
   - 如果生成 2 個干擾項，最多 1 個可以是反義詞

3. **優先使用「同領域但不相關」的詞**：
   - change/改變 → ✅ 移動、旋轉、執行（都是動作動詞）
   - cost/成本 → ✅ 利潤、營收、淨值（都是財務術語）
   - associated/相關 → ✅ 公開、預設、必要（都是描述性質）

## 範例

| 單字 | 正確翻譯 | ✅ 好的干擾項 | 為什麼好 |
|------|----------|---------------|----------|
| change | 改變 | 移動、執行 | 同領域不相關 |
| increase | 增加 | 計算、減少 | 1個不相關 + 1個反義 ✅ |
| happy | 快樂 | 驚訝、悲傷 | 1個不相關 + 1個反義 ✅ |
| apple | 蘋果 | 香蕉、橘子 | 都是水果但不是蘋果 |

## 輸出格式
JSON 陣列，每個元素是一個包含 {count} 個干擾項的陣列。
⚠️ 順序必須與輸入單字列表完全對應！
[["干擾項1", "干擾項2"], ...]

只回覆 JSON 陣列，不要其他文字。"""

            system_instruction = (
                "You are a vocabulary quiz generator. Generate WRONG answers (distractors) that are: "
                "1) NEVER synonyms - if it could be a correct translation, don't use it "
                "2) Antonyms are OK but not ALL of them - mix antonyms with unrelated words "
                "3) Prefer same domain but UNRELATED meaning (同領域但不相關) "
                "4) MAINTAIN INPUT ORDER - output array must match input word order exactly "
                "5) All in Traditional Chinese. JSON array only."
            )

            # Use Vertex AI or OpenAI based on configuration
            if self.use_vertex_ai:
                all_distractors = await self.vertex_ai.generate_json(
                    prompt=prompt,
                    model_type="flash",
                    max_tokens=1000,
                    temperature=0.2,  # Very low temperature to strictly follow prompt rules
                    system_instruction=system_instruction,
                )
            else:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,  # Very low temperature to strictly follow prompt rules
                    max_tokens=1000,
                )

                # Parse JSON response
                import re

                content = response.choices[0].message.content.strip()
                content = re.sub(r"^```json\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
                content = content.strip()

                all_distractors = json.loads(content)

            # Verify count matches
            if len(all_distractors) != len(words):
                logger.warning(
                    f"Batch distractors count mismatch: expected {len(words)}, "
                    f"got {len(all_distractors)}. Falling back to individual generation."
                )
                # Fallback to individual generation
                tasks = [
                    self.generate_distractors(
                        w["word"],
                        w["translation"],
                        count,
                        w.get("part_of_speech"),
                    )
                    for w in words
                ]
                return await asyncio.gather(*tasks)

            # Filter out correct answers and duplicates from each distractor list
            result = []
            for i, distractors in enumerate(all_distractors):
                correct = words[i]["translation"]
                # Case-insensitive dedup and correct answer removal
                seen = {correct.lower().strip()}
                unique = []
                for d in distractors:
                    d_normalized = d.lower().strip()
                    if d_normalized not in seen and d.strip():
                        seen.add(d_normalized)
                        unique.append(d)
                result.append(unique[:count])

            return result

        except Exception as e:
            logger.error(f"Batch generate distractors error: {e}")
            # Fallback to individual generation
            tasks = [
                self.generate_distractors(
                    w["word"],
                    w["translation"],
                    count,
                    w.get("part_of_speech"),
                )
                for w in words
            ]
            return await asyncio.gather(*tasks)


# 創建全局實例
translation_service = TranslationService()
