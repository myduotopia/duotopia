"""Relax mastery threshold + tier-quota word selection (issue #800)

Revision ID: 20260522_1000
Revises: 20260522_0900
Create Date: 2026-05-22 10:00:00.000000

Changes (issue #800):

1. calculate_assignment_mastery — new tier rules + new weights
   - T5 master:           diff >= 3 OR repetition_count >= 3
   - T4 familiar:         diff >= 2 OR repetition_count >= 2 (not T5)
   - T3 medium:           diff >= 1 (not T4/T5)
   - T2 unfamiliar:       practiced but diff <= 0 (not T3+)
   - T1 very_unfamiliar:  never practiced
   - diff = correct_count - 0.5 * incorrect_count (answers-wrong only -0.5)
   - weights: T5=1.0 / T4=0.8 / T3=0.6 / T2=0.4 / T1=0
     (全 T4 練度 = 80%，剛好達預設達標線)

2. get_words_for_practice — discard phase/interval, use tier quotas
   - Quotas (limit=10): T4=2 / T3=2 / T2=3 / T1=3
   - Quotas scale proportionally for other limits (cloze passes 30)
   - Cascade forward when a tier short of supply: T4→T3→T2→T1
   - Reverse cascade if T1 still unfilled: T1→T2→T3→T4
   - T5 (mastered) EXCLUDED from candidate pool — never appears
   - Final output randomized (each round different order)
   - When fully mastered (all words T5), returns 0 rows; callers detect
     empty result and surface "全部精熟" UI.

Pure CREATE OR REPLACE; no schema changes; no row mutations. Idempotent.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260522_1000"
down_revision = "20260522_0900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. calculate_assignment_mastery — new tier ladder + B1 weights
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE OR REPLACE FUNCTION calculate_assignment_mastery(
            p_student_assignment_id INTEGER
        ) RETURNS TABLE (
            current_mastery DECIMAL,
            target_mastery DECIMAL,
            achieved BOOLEAN,
            words_mastered INTEGER,
            words_master INTEGER,
            words_familiar INTEGER,
            words_medium INTEGER,
            words_unfamiliar INTEGER,
            words_very_unfamiliar INTEGER,
            total_words INTEGER
        ) AS $$
        DECLARE
            v_total_words INTEGER;
            v_t5 INTEGER;
            v_t4 INTEGER;
            v_t3 INTEGER;
            v_t2 INTEGER;
            v_t1 INTEGER;
            v_current_mastery DECIMAL;
            v_target DECIMAL;
            v_target_proficiency INTEGER;
        BEGIN
            SELECT COALESCE(a.target_proficiency, 80) INTO v_target_proficiency
            FROM student_assignments sa
            JOIN assignments a ON a.id = sa.assignment_id
            WHERE sa.id = p_student_assignment_id;

            IF v_target_proficiency IS NULL THEN
                v_target_proficiency := 80;
            END IF;
            v_target := v_target_proficiency / 100.0;

            SELECT COUNT(DISTINCT ci.id) INTO v_total_words
            FROM student_assignments sa
            JOIN student_content_progress scp ON scp.student_assignment_id = sa.id
            JOIN content_items ci ON ci.content_id = scp.content_id
            WHERE sa.id = p_student_assignment_id;

            IF v_total_words IS NULL OR v_total_words = 0 THEN
                RETURN QUERY SELECT
                    0::DECIMAL, v_target, FALSE,
                    0, 0, 0, 0, 0, 0, 0;
                RETURN;
            END IF;

            -- Tier judgement (high tier wins; T5/T4 use OR rule with repetition_count)
            --   diff = correct_count - 0.5 * incorrect_count
            SELECT
                COUNT(*) FILTER (
                    WHERE (correct_count - 0.5 * incorrect_count) >= 3
                       OR repetition_count >= 3
                ),
                COUNT(*) FILTER (
                    WHERE NOT (
                        (correct_count - 0.5 * incorrect_count) >= 3
                        OR repetition_count >= 3
                    )
                    AND (
                        (correct_count - 0.5 * incorrect_count) >= 2
                        OR repetition_count >= 2
                    )
                ),
                COUNT(*) FILTER (
                    WHERE NOT (
                        (correct_count - 0.5 * incorrect_count) >= 2
                        OR repetition_count >= 2
                    )
                    AND (correct_count - 0.5 * incorrect_count) >= 1
                ),
                COUNT(*) FILTER (
                    -- T2 = practiced but didn't qualify for T3/T4/T5.
                    -- repetition_count >= 2 is excluded here because it
                    -- already lifts a word to T4 via the OR rule above —
                    -- without this exclusion a rep=2/diff=0 word would
                    -- be double-counted in both T4 and T2.
                    WHERE NOT (
                        (correct_count - 0.5 * incorrect_count) >= 1
                        OR repetition_count >= 2
                    )
                    AND total_attempts > 0
                )
            INTO v_t5, v_t4, v_t3, v_t2
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id;

            v_t5 := COALESCE(v_t5, 0);
            v_t4 := COALESCE(v_t4, 0);
            v_t3 := COALESCE(v_t3, 0);
            v_t2 := COALESCE(v_t2, 0);
            -- T1 = never practiced; compute by subtraction so totals always match
            v_t1 := v_total_words - v_t5 - v_t4 - v_t3 - v_t2;
            IF v_t1 < 0 THEN
                v_t1 := 0;
            END IF;

            -- B1 weights: T5=1.0 / T4=0.8 / T3=0.6 / T2=0.4 / T1=0
            -- (全 T4 = 80%，剛好過預設達標)
            v_current_mastery := (
                v_t5::DECIMAL
                + 0.8 * v_t4::DECIMAL
                + 0.6 * v_t3::DECIMAL
                + 0.4 * v_t2::DECIMAL
            ) / GREATEST(v_total_words, 1);

            RETURN QUERY SELECT
                v_current_mastery,
                v_target,
                v_current_mastery >= v_target,
                v_t5,        -- words_mastered (legacy alias)
                v_t5,        -- words_master
                v_t4,        -- words_familiar
                v_t3,        -- words_medium
                v_t2,        -- words_unfamiliar
                v_t1,        -- words_very_unfamiliar
                v_total_words;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    # ------------------------------------------------------------------
    # 2. get_words_for_practice — tier-quota selection + cascade + exclude T5
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE OR REPLACE FUNCTION get_words_for_practice(
            p_student_assignment_id INTEGER,
            p_limit_count INTEGER DEFAULT 10
        ) RETURNS TABLE (
            content_item_id INTEGER,
            text TEXT,
            translation TEXT,
            example_sentence TEXT,
            example_sentence_translation TEXT,
            audio_url TEXT,
            image_url TEXT,
            memory_strength DECIMAL,
            priority_score DECIMAL
        ) AS $$
        -- Tell PL/pgSQL to prefer table columns over OUT-parameter names
        -- (RETURNS TABLE declares content_item_id etc. as ambient variables,
        -- which would otherwise shadow column references in subqueries.)
        #variable_conflict use_column
        DECLARE
            -- Quotas scale to p_limit_count; defaults (limit=10): 2/2/3/3
            v_q4 INTEGER;
            v_q3 INTEGER;
            v_q2 INTEGER;
            v_q1 INTEGER;
            v_taken INTEGER;
            v_unfilled INTEGER;
        BEGIN
            -- Compute quotas (ratios 0.2 / 0.2 / 0.3 / 0.3)
            v_q4 := GREATEST(1, ROUND(p_limit_count::numeric * 0.2)::INTEGER);
            v_q3 := GREATEST(1, ROUND(p_limit_count::numeric * 0.2)::INTEGER);
            v_q2 := GREATEST(1, ROUND(p_limit_count::numeric * 0.3)::INTEGER);
            v_q1 := p_limit_count - v_q4 - v_q3 - v_q2;
            IF v_q1 < 1 THEN
                v_q1 := 1;
                v_q2 := p_limit_count - v_q4 - v_q3 - v_q1;
                IF v_q2 < 0 THEN v_q2 := 0; END IF;
            END IF;

            -- Drop temp tables if already exist (re-entrance safety)
            DROP TABLE IF EXISTS _gwfp_pool;
            DROP TABLE IF EXISTS _gwfp_picked;

            -- Build candidate pool tagged with tier; EXCLUDE T5 (mastered)
            CREATE TEMP TABLE _gwfp_pool ON COMMIT DROP AS
            SELECT
                ci.id AS content_item_id,
                ci.text,
                ci.translation,
                ci.example_sentence,
                ci.example_sentence_translation,
                ci.audio_url,
                ci.image_url,
                COALESCE(uwp.memory_strength, 0)::DECIMAL AS memory_strength,
                CASE
                    WHEN (COALESCE(uwp.correct_count, 0)
                          - 0.5 * COALESCE(uwp.incorrect_count, 0)) >= 2
                      OR COALESCE(uwp.repetition_count, 0) >= 2 THEN 4
                    WHEN (COALESCE(uwp.correct_count, 0)
                          - 0.5 * COALESCE(uwp.incorrect_count, 0)) >= 1 THEN 3
                    WHEN uwp.id IS NOT NULL
                         AND COALESCE(uwp.total_attempts, 0) > 0 THEN 2
                    ELSE 1
                END AS tier
            FROM student_assignments sa
            JOIN student_content_progress scp
                ON scp.student_assignment_id = sa.id
            JOIN content_items ci
                ON ci.content_id = scp.content_id
            LEFT JOIN user_word_progress uwp
                ON uwp.student_assignment_id = p_student_assignment_id
                AND uwp.content_item_id = ci.id
            WHERE sa.id = p_student_assignment_id
              -- Exclude T5 (mastered): never appears
              AND NOT (
                  (COALESCE(uwp.correct_count, 0)
                   - 0.5 * COALESCE(uwp.incorrect_count, 0)) >= 3
                  OR COALESCE(uwp.repetition_count, 0) >= 3
              );

            CREATE TEMP TABLE _gwfp_picked (
                content_item_id INTEGER PRIMARY KEY
            ) ON COMMIT DROP;

            -- ===== Forward cascade T4 → T3 → T2 → T1 =====
            INSERT INTO _gwfp_picked
            SELECT p.content_item_id FROM _gwfp_pool p
            WHERE p.tier = 4
            ORDER BY RANDOM()
            LIMIT v_q4;
            GET DIAGNOSTICS v_taken = ROW_COUNT;
            v_q3 := v_q3 + (v_q4 - v_taken);

            INSERT INTO _gwfp_picked
            SELECT p.content_item_id FROM _gwfp_pool p
            WHERE p.tier = 3
              AND p.content_item_id NOT IN (SELECT content_item_id FROM _gwfp_picked)
            ORDER BY RANDOM()
            LIMIT v_q3;
            GET DIAGNOSTICS v_taken = ROW_COUNT;
            v_q2 := v_q2 + (v_q3 - v_taken);

            INSERT INTO _gwfp_picked
            SELECT p.content_item_id FROM _gwfp_pool p
            WHERE p.tier = 2
              AND p.content_item_id NOT IN (SELECT content_item_id FROM _gwfp_picked)
            ORDER BY RANDOM()
            LIMIT v_q2;
            GET DIAGNOSTICS v_taken = ROW_COUNT;
            v_q1 := v_q1 + (v_q2 - v_taken);

            INSERT INTO _gwfp_picked
            SELECT p.content_item_id FROM _gwfp_pool p
            WHERE p.tier = 1
              AND p.content_item_id NOT IN (SELECT content_item_id FROM _gwfp_picked)
            ORDER BY RANDOM()
            LIMIT v_q1;
            GET DIAGNOSTICS v_taken = ROW_COUNT;
            v_unfilled := v_q1 - v_taken;

            -- ===== Reverse cascade T1 → T2 → T3 → T4 (only if still unfilled) =====
            IF v_unfilled > 0 THEN
                INSERT INTO _gwfp_picked
                SELECT p.content_item_id FROM _gwfp_pool p
                WHERE p.tier = 2
                  AND p.content_item_id NOT IN (SELECT content_item_id FROM _gwfp_picked)
                ORDER BY RANDOM()
                LIMIT v_unfilled;
                GET DIAGNOSTICS v_taken = ROW_COUNT;
                v_unfilled := v_unfilled - v_taken;
            END IF;
            IF v_unfilled > 0 THEN
                INSERT INTO _gwfp_picked
                SELECT p.content_item_id FROM _gwfp_pool p
                WHERE p.tier = 3
                  AND p.content_item_id NOT IN (SELECT content_item_id FROM _gwfp_picked)
                ORDER BY RANDOM()
                LIMIT v_unfilled;
                GET DIAGNOSTICS v_taken = ROW_COUNT;
                v_unfilled := v_unfilled - v_taken;
            END IF;
            IF v_unfilled > 0 THEN
                INSERT INTO _gwfp_picked
                SELECT p.content_item_id FROM _gwfp_pool p
                WHERE p.tier = 4
                  AND p.content_item_id NOT IN (SELECT content_item_id FROM _gwfp_picked)
                ORDER BY RANDOM()
                LIMIT v_unfilled;
            END IF;

            -- ===== Return picked words in randomized order =====
            RETURN QUERY
            SELECT
                p.content_item_id,
                p.text,
                p.translation,
                p.example_sentence,
                p.example_sentence_translation,
                p.audio_url,
                p.image_url,
                p.memory_strength,
                -- priority_score: kept for API back-compat (lower tier = higher score)
                CASE p.tier
                    WHEN 4 THEN 30::DECIMAL
                    WHEN 3 THEN 50::DECIMAL
                    WHEN 2 THEN 70::DECIMAL
                    ELSE 100::DECIMAL
                END AS priority_score
            FROM _gwfp_pool p
            JOIN _gwfp_picked pk ON pk.content_item_id = p.content_item_id
            ORDER BY RANDOM()
            -- Safety cap: GREATEST(1, ...) floor on per-tier quotas can in
            -- theory sum to slightly more than p_limit_count for tiny
            -- limits (e.g. p_limit_count = 2). Known callers pass 10 / 30
            -- so this never fires in practice, but the explicit LIMIT
            -- keeps the contract honest for future callers.
            LIMIT p_limit_count;

            DROP TABLE IF EXISTS _gwfp_picked;
            DROP TABLE IF EXISTS _gwfp_pool;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    # Restore diff-based ladder (20260509_1300) for calculate_assignment_mastery
    op.execute(
        """
        CREATE OR REPLACE FUNCTION calculate_assignment_mastery(
            p_student_assignment_id INTEGER
        ) RETURNS TABLE (
            current_mastery DECIMAL,
            target_mastery DECIMAL,
            achieved BOOLEAN,
            words_mastered INTEGER,
            words_master INTEGER,
            words_familiar INTEGER,
            words_medium INTEGER,
            words_unfamiliar INTEGER,
            words_very_unfamiliar INTEGER,
            total_words INTEGER
        ) AS $$
        DECLARE
            v_total_words INTEGER;
            v_t5 INTEGER;
            v_t4 INTEGER;
            v_t3 INTEGER;
            v_t2 INTEGER;
            v_t1 INTEGER;
            v_current_mastery DECIMAL;
            v_target DECIMAL;
            v_target_proficiency INTEGER;
        BEGIN
            SELECT COALESCE(a.target_proficiency, 80) INTO v_target_proficiency
            FROM student_assignments sa
            JOIN assignments a ON a.id = sa.assignment_id
            WHERE sa.id = p_student_assignment_id;
            IF v_target_proficiency IS NULL THEN
                v_target_proficiency := 80;
            END IF;
            v_target := v_target_proficiency / 100.0;
            SELECT COUNT(DISTINCT ci.id) INTO v_total_words
            FROM student_assignments sa
            JOIN student_content_progress scp ON scp.student_assignment_id = sa.id
            JOIN content_items ci ON ci.content_id = scp.content_id
            WHERE sa.id = p_student_assignment_id;
            IF v_total_words IS NULL OR v_total_words = 0 THEN
                RETURN QUERY SELECT 0::DECIMAL, v_target, FALSE, 0, 0, 0, 0, 0, 0, 0;
                RETURN;
            END IF;
            SELECT
                COUNT(*) FILTER (WHERE (correct_count - incorrect_count) >= 4),
                COUNT(*) FILTER (WHERE (correct_count - incorrect_count) = 3),
                COUNT(*) FILTER (WHERE (correct_count - incorrect_count) = 2),
                COUNT(*) FILTER (WHERE (correct_count - incorrect_count) = 1)
            INTO v_t5, v_t4, v_t3, v_t2
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id;
            v_t5 := COALESCE(v_t5, 0);
            v_t4 := COALESCE(v_t4, 0);
            v_t3 := COALESCE(v_t3, 0);
            v_t2 := COALESCE(v_t2, 0);
            v_t1 := v_total_words - v_t5 - v_t4 - v_t3 - v_t2;
            IF v_t1 < 0 THEN v_t1 := 0; END IF;
            v_current_mastery := (
                v_t5::DECIMAL
                + 0.75 * v_t4::DECIMAL
                + 0.5  * v_t3::DECIMAL
                + 0.25 * v_t2::DECIMAL
            ) / GREATEST(v_total_words, 1);
            RETURN QUERY SELECT
                v_current_mastery, v_target, v_current_mastery >= v_target,
                v_t5, v_t5, v_t4, v_t3, v_t2, v_t1, v_total_words;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    # Restore phase-based get_words_for_practice (20260303_1000)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION get_words_for_practice(
            p_student_assignment_id INTEGER,
            p_limit_count INTEGER DEFAULT 10
        ) RETURNS TABLE (
            content_item_id INTEGER,
            text TEXT,
            translation TEXT,
            example_sentence TEXT,
            example_sentence_translation TEXT,
            audio_url TEXT,
            image_url TEXT,
            memory_strength DECIMAL,
            priority_score DECIMAL
        ) AS $$
        BEGIN
            RETURN QUERY
            WITH assignment_words AS (
                SELECT DISTINCT ci.id as content_item_id
                FROM student_assignments sa
                JOIN student_content_progress scp
                    ON scp.student_assignment_id = sa.id
                JOIN content_items ci
                    ON ci.content_id = scp.content_id
                WHERE sa.id = p_student_assignment_id
            ),
            categorized AS (
                SELECT
                    ci.id,
                    ci.text,
                    ci.translation,
                    ci.example_sentence,
                    ci.example_sentence_translation,
                    ci.audio_url,
                    ci.image_url,
                    COALESCE(uwp.memory_strength, 0) as memory_strength,
                    CASE
                        WHEN uwp.id IS NULL THEN 1
                        WHEN uwp.next_review_at IS NULL THEN 1
                        WHEN uwp.next_review_at <= NOW() THEN 2
                        ELSE 3
                    END as phase
                FROM assignment_words aw
                JOIN content_items ci ON ci.id = aw.content_item_id
                LEFT JOIN user_word_progress uwp ON
                    uwp.student_assignment_id = p_student_assignment_id
                    AND uwp.content_item_id = ci.id
            )
            SELECT
                c.id,
                c.text,
                c.translation,
                c.example_sentence,
                c.example_sentence_translation,
                c.audio_url,
                c.image_url,
                c.memory_strength,
                CASE c.phase
                    WHEN 1 THEN 100::DECIMAL
                    WHEN 2 THEN (50 + (1 - c.memory_strength) * 50)::DECIMAL
                    ELSE ((1 - c.memory_strength) * 30)::DECIMAL
                END as priority_score
            FROM categorized c
            ORDER BY c.phase ASC, c.memory_strength ASC, RANDOM()
            LIMIT p_limit_count;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
