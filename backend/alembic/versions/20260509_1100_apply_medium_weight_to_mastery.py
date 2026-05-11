"""Apply 0.5 weight for medium tier in calculate_assignment_mastery

Revision ID: 20260509_1100
Revises: 20260509_1000
Create Date: 2026-05-09 11:00:00.000000

Issue #711 follow-up:
The previous revision used current_mastery = words_high / total_words, which
showed 0% even when many words sat at 普通熟悉 (medium tier) — visually
confusing. We weight medium at 0.5 so partial progress is reflected:

    current_mastery = (words_high + 0.5 * words_medium) / total_words

Boundary semantics still hold:
    current_mastery == 1.0  ⇒  every word at 已熟悉
                              (medium contributes ≤ 0.5 each, total ≤ 0.5*total
                               cannot reach 1.0 unless medium=0 and high=total)

The function signature is unchanged from 20260509_1000, so we use
CREATE OR REPLACE rather than DROP+CREATE.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260509_1100"
down_revision = "20260509_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION calculate_assignment_mastery(
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

            -- Weighted mastery: medium tier counts as half a "high" word.
            v_current_mastery :=
                (v_words_high::DECIMAL + 0.5 * v_words_medium::DECIMAL)
                / GREATEST(v_total_words, 1);

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
    # Restore the unweighted form from 20260509_1000.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION calculate_assignment_mastery(
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
                v_words_high::DECIMAL / GREATEST(v_total_words, 1);

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
