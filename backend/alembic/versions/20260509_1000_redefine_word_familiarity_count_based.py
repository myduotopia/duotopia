"""Redefine word familiarity using count-based 3-tier classification

Revision ID: 20260509_1000
Revises: 20260508_1200
Create Date: 2026-05-09 10:00:00.000000

Issue #711: 「單字集熟悉度上升、已熟悉單字數=0」反直覺現象。
原本 calculate_assignment_mastery 用 memory_strength 平均做整體熟悉度、
用 memory_strength >= target*0.8 計「已熟悉」單字數，門檻過高、
與整體百分比脫鉤，使用者體感上不合理。

新邏輯改用 user_word_progress.correct_count / incorrect_count 的計次三檔分類：
  total = correct + incorrect
  high   (已熟悉)   : correct/total >= 0.9 AND correct >= 5
  medium (普通熟悉) : correct/total >= 0.5 AND correct >= 3 (且非 high)
  low    (不熟)     : 其餘 (含尚未練習過的單字)

單字集熟悉度 = words_high / total_words (0~1)
achieved   = current_mastery * 100 >= target_proficiency

實作備註：
- 因 RETURN TABLE 欄位數有變動，PostgreSQL 不允許 CREATE OR REPLACE 改 signature，
  必須先 DROP FUNCTION，再 CREATE。仍可重複執行 (idempotent)。
- update_memory_strength 不動 (仍負責 SR 排程，但其 memory_strength 不再被聚合)。
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260509_1000"
down_revision = "20260508_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS calculate_assignment_mastery(INTEGER)")
    op.execute(
        """
        CREATE FUNCTION calculate_assignment_mastery(
            p_student_assignment_id INTEGER
        ) RETURNS TABLE (
            current_mastery DECIMAL,
            target_mastery DECIMAL,
            achieved BOOLEAN,
            words_mastered INTEGER,
            words_high INTEGER,
            words_medium INTEGER,
            words_low INTEGER,
            total_words INTEGER
        ) AS $$
        DECLARE
            v_total_words INTEGER;
            v_words_high INTEGER;
            v_words_medium INTEGER;
            v_words_low INTEGER;
            v_current_mastery DECIMAL;
            v_target DECIMAL;
            v_target_proficiency INTEGER;
        BEGIN
            -- Get target_proficiency from assignment (default 80)
            SELECT COALESCE(a.target_proficiency, 80) INTO v_target_proficiency
            FROM student_assignments sa
            JOIN assignments a ON a.id = sa.assignment_id
            WHERE sa.id = p_student_assignment_id;

            IF v_target_proficiency IS NULL THEN
                v_target_proficiency := 80;
            END IF;

            v_target := v_target_proficiency / 100.0;

            -- Total word count: all content_items linked to this assignment
            SELECT COUNT(DISTINCT ci.id) INTO v_total_words
            FROM student_assignments sa
            JOIN student_content_progress scp ON scp.student_assignment_id = sa.id
            JOIN content_items ci ON ci.content_id = scp.content_id
            WHERE sa.id = p_student_assignment_id;

            IF v_total_words IS NULL OR v_total_words = 0 THEN
                RETURN QUERY SELECT
                    0::DECIMAL, v_target, FALSE,
                    0, 0, 0, 0, 0;
                RETURN;
            END IF;

            -- Count words in each tier from user_word_progress.
            -- A row exists only after the student has answered at least once,
            -- so (correct_count + incorrect_count) is always >= 1 here, but
            -- we still guard division to be safe.
            SELECT
                COUNT(*) FILTER (
                    WHERE correct_count >= 5
                      AND (correct_count + incorrect_count) > 0
                      AND correct_count::DECIMAL
                          / (correct_count + incorrect_count) >= 0.9
                ),
                COUNT(*) FILTER (
                    WHERE correct_count >= 3
                      AND (correct_count + incorrect_count) > 0
                      AND correct_count::DECIMAL
                          / (correct_count + incorrect_count) >= 0.5
                      AND NOT (
                          correct_count >= 5
                          AND correct_count::DECIMAL
                              / (correct_count + incorrect_count) >= 0.9
                      )
                )
            INTO v_words_high, v_words_medium
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id;

            v_words_high := COALESCE(v_words_high, 0);
            v_words_medium := COALESCE(v_words_medium, 0);
            -- low includes unpracticed words (no row) and practiced rows that
            -- did not reach medium/high tiers.
            v_words_low := v_total_words - v_words_high - v_words_medium;
            IF v_words_low < 0 THEN
                v_words_low := 0;
            END IF;

            v_current_mastery :=
                v_words_high::DECIMAL / GREATEST(v_total_words, 1);

            RETURN QUERY SELECT
                v_current_mastery,
                v_target,
                v_current_mastery >= v_target,
                v_words_high,        -- words_mastered (legacy alias of words_high)
                v_words_high,
                v_words_medium,
                v_words_low,
                v_total_words;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    # Restore the previous (memory_strength average) version, matching the
    # function as it stood after migration 20260120_0844_hotfix and before
    # this revision was applied.
    op.execute("DROP FUNCTION IF EXISTS calculate_assignment_mastery(INTEGER)")
    op.execute(
        """
        CREATE FUNCTION calculate_assignment_mastery(
            p_student_assignment_id INTEGER
        ) RETURNS TABLE (
            current_mastery DECIMAL,
            target_mastery DECIMAL,
            achieved BOOLEAN,
            words_mastered INTEGER,
            total_words INTEGER
        ) AS $$
        DECLARE
            v_total_words INTEGER;
            v_practiced_words INTEGER;
            v_avg_strength DECIMAL;
            v_words_mastered INTEGER;
            v_target DECIMAL;
            v_target_proficiency INTEGER;
        BEGIN
            SELECT COALESCE(a.target_proficiency, 80) INTO v_target_proficiency
            FROM student_assignments sa
            JOIN assignments a ON a.id = sa.assignment_id
            WHERE sa.id = p_student_assignment_id;

            v_target := v_target_proficiency / 100.0;

            SELECT COUNT(DISTINCT ci.id) INTO v_total_words
            FROM student_assignments sa
            JOIN student_content_progress scp ON scp.student_assignment_id = sa.id
            JOIN content_items ci ON ci.content_id = scp.content_id
            WHERE sa.id = p_student_assignment_id;

            IF v_total_words = 0 THEN
                RETURN QUERY SELECT 0::DECIMAL, v_target, FALSE, 0, 0;
                RETURN;
            END IF;

            SELECT
                COALESCE(AVG(uwp.memory_strength), 0),
                COUNT(*)
            INTO v_avg_strength, v_practiced_words
            FROM user_word_progress uwp
            WHERE uwp.student_assignment_id = p_student_assignment_id;

            IF v_practiced_words < v_total_words THEN
                v_avg_strength := (v_avg_strength * v_practiced_words) / v_total_words;
            END IF;

            SELECT COUNT(*) INTO v_words_mastered
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id
                AND memory_strength >= (v_target * 0.8);

            RETURN QUERY SELECT
                v_avg_strength,
                v_target,
                v_avg_strength >= v_target,
                v_words_mastered,
                v_total_words;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
