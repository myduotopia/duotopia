"""Extend word familiarity classification to 5 tiers (Issue #711 follow-up)

Revision ID: 20260509_1200
Revises: 20260509_1100
Create Date: 2026-05-09 12:00:00.000000

The 3-tier scheme (high/medium/low) made students stuck — for assignments
with many words it took 5 corrects per word to register any progress, and
4 corrects landed in the same bucket as 3 corrects. This revision splits
the spectrum into 5 tiers so each correct answer beyond 3 is visible:

  T5 精熟       : correct >= 5 AND rate >= 0.9   (weight 1.0)
  T4 熟悉       : correct >= 4 AND rate >= 0.75  (weight 0.75)
  T3 普通       : correct >= 3 AND rate >= 0.5   (weight 0.5)
  T2 不熟悉    : correct >= 1 (other practiced)  (weight 0.25)
  T1 非常不熟 : correct == 0 (and unpracticed)   (weight 0.0)

  current_mastery = (T5 + 0.75*T4 + 0.5*T3 + 0.25*T2) / total_words

current_mastery == 1.0 still requires every word at T5 (T4-T1 sum <= 0.75 * total).

Function signature changes (RETURN TABLE columns), so we DROP IF EXISTS +
CREATE rather than CREATE OR REPLACE. The columns words_high / words_low
shipped on the same branch in 20260509_1000 are removed; we only keep the
``words_mastered`` legacy alias so existing 16+ Python callers that still
read ``result.words_mastered`` continue to work (it now equals T5).
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260509_1200"
down_revision = "20260509_1100"
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
            v_practiced INTEGER;
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

            -- Cascade: each tier filter excludes higher ones via NOT clause,
            -- so every practiced row falls into exactly one bucket.
            SELECT
                COUNT(*) FILTER (
                    WHERE correct_count >= 5
                      AND (correct_count + incorrect_count) > 0
                      AND correct_count::DECIMAL
                          / (correct_count + incorrect_count) >= 0.9
                ),
                COUNT(*) FILTER (
                    WHERE correct_count >= 4
                      AND (correct_count + incorrect_count) > 0
                      AND correct_count::DECIMAL
                          / (correct_count + incorrect_count) >= 0.75
                      AND NOT (
                          correct_count >= 5
                          AND correct_count::DECIMAL
                              / (correct_count + incorrect_count) >= 0.9
                      )
                ),
                COUNT(*) FILTER (
                    WHERE correct_count >= 3
                      AND (correct_count + incorrect_count) > 0
                      AND correct_count::DECIMAL
                          / (correct_count + incorrect_count) >= 0.5
                      AND NOT (
                          correct_count >= 4
                          AND correct_count::DECIMAL
                              / (correct_count + incorrect_count) >= 0.75
                      )
                ),
                COUNT(*) FILTER (
                    WHERE correct_count >= 1
                      AND NOT (
                          correct_count >= 3
                          AND (correct_count + incorrect_count) > 0
                          AND correct_count::DECIMAL
                              / (correct_count + incorrect_count) >= 0.5
                      )
                ),
                COUNT(*) FILTER (WHERE correct_count = 0)
            INTO v_t5, v_t4, v_t3, v_t2, v_practiced
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id;

            v_t5 := COALESCE(v_t5, 0);
            v_t4 := COALESCE(v_t4, 0);
            v_t3 := COALESCE(v_t3, 0);
            v_t2 := COALESCE(v_t2, 0);
            -- T1 includes both "row exists with correct=0" and "no row at all"
            -- (i.e., never practiced). Compute as total - sum(T2..T5).
            v_t1 := v_total_words - v_t5 - v_t4 - v_t3 - v_t2;
            IF v_t1 < 0 THEN
                v_t1 := 0;
            END IF;

            v_current_mastery := (
                v_t5::DECIMAL
                + 0.75 * v_t4::DECIMAL
                + 0.5  * v_t3::DECIMAL
                + 0.25 * v_t2::DECIMAL
            ) / GREATEST(v_total_words, 1);

            RETURN QUERY SELECT
                v_current_mastery,
                v_target,
                v_current_mastery >= v_target,
                v_t5,        -- words_mastered (legacy, == T5)
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


def downgrade() -> None:
    # Restore the 3-tier function from 20260509_1100.
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
                    0, 0, 0, 0, 0;
                RETURN;
            END IF;

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
            v_words_low := v_total_words - v_words_high - v_words_medium;
            IF v_words_low < 0 THEN
                v_words_low := 0;
            END IF;

            v_current_mastery :=
                (v_words_high::DECIMAL + 0.5 * v_words_medium::DECIMAL)
                / GREATEST(v_total_words, 1);

            RETURN QUERY SELECT
                v_current_mastery,
                v_target,
                v_current_mastery >= v_target,
                v_words_high,
                v_words_high,
                v_words_medium,
                v_words_low,
                v_total_words;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
