"""Switch familiarity ladder to (correct - incorrect) diff-based + linear 0.25 weights

Revision ID: 20260509_1300
Revises: 20260509_1200
Create Date: 2026-05-09 13:00:00.000000

Issue #711 follow-up:
The rate-based 5-tier scheme was still slow on large word sets and required
many corrects to register movement. Switching to a pure "net corrects"
ladder (correct_count - incorrect_count) gives a one-step ladder where
4 net corrects already reaches master:

    diff = correct_count - incorrect_count

    master           T5  diff >= 4   weight 1.00
    familiar         T4  diff == 3   weight 0.75
    medium           T3  diff == 2   weight 0.50
    unfamiliar       T2  diff == 1   weight 0.25
    very_unfamiliar  T1  diff <= 0   weight 0.00 (incl. unpracticed)

    current_mastery =
        (T5 + 0.75*T4 + 0.5*T3 + 0.25*T2) / total_words

So one T5 word raises mastery by 1/total, one T4 by 0.75/total, etc.

Side effects of moving from rate-based to diff-based:
- A word the student has practiced a lot but with several mistakes
  (e.g., 10 correct / 6 wrong, rate=62.5%, diff=4) now reaches master.
- A word with equal hits and misses (diff=0) drops to very_unfamiliar
  regardless of how much it's been practiced — a single past mistake
  no longer permanently freezes a word at medium.

Function signature is unchanged from 20260509_1200, so we use
CREATE OR REPLACE rather than DROP+CREATE.
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260509_1300"
down_revision = "20260509_1200"
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

            -- Diff-based ladder: each tier covers exactly one diff value
            -- (T5 saturates at >=4, T1 catches everything <=0).
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
            -- T1 catches: rows with diff <= 0 AND words without a row
            -- (never practiced). Computed by subtraction so the math is
            -- consistent regardless of how many user_word_progress rows exist.
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
                v_t5,        -- words_mastered (legacy alias of T5)
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
    # Restore the rate-based 5-tier function from 20260509_1200.
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
                )
            INTO v_t5, v_t4, v_t3, v_t2
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id;

            v_t5 := COALESCE(v_t5, 0);
            v_t4 := COALESCE(v_t4, 0);
            v_t3 := COALESCE(v_t3, 0);
            v_t2 := COALESCE(v_t2, 0);
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
                v_t5,
                v_t5,
                v_t4,
                v_t3,
                v_t2,
                v_t1,
                v_total_words;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
