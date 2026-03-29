"""Fix word familiarity increasing on incorrect answers

Revision ID: 20260317_1000
Revises: 20260311_1000
Create Date: 2026-03-17 10:00:00.000000

Bug: When a student answers incorrectly, overall proficiency (熟悉度) still goes up.
Root cause: First incorrect answer creates user_word_progress with memory_strength=0.2,
but the word previously had no record (treated as 0 in mastery calculation).
So 0.2 > 0 inflates the average. Also, subsequent incorrect answers floor at 0.1.

Fix:
- First incorrect answer: memory_strength = 0 (not 0.2)
- Subsequent incorrect: GREATEST(0.0, ...) instead of GREATEST(0.1, ...)

Related: #452
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260317_1000"
down_revision = "20260311_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION update_memory_strength(
            p_student_assignment_id INTEGER,
            p_content_item_id INTEGER,
            p_is_correct BOOLEAN
        ) RETURNS TABLE (
            memory_strength DECIMAL,
            next_review_at TIMESTAMPTZ,
            easiness_factor DECIMAL,
            repetition_count INTEGER
        ) AS $$
        DECLARE
            v_progress user_word_progress%ROWTYPE;
            v_time_since_last_review INTERVAL;
            v_new_strength DECIMAL;
            v_new_easiness DECIMAL;
            v_new_interval DECIMAL;
            v_student_id INTEGER;
        BEGIN
            -- Get or create progress record
            SELECT * INTO v_progress
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id
                AND content_item_id = p_content_item_id;

            -- If not found, create new record
            IF NOT FOUND THEN
                -- Get student_id from student_assignment
                SELECT sa.student_id INTO v_student_id
                FROM student_assignments sa
                WHERE sa.id = p_student_assignment_id;

                INSERT INTO user_word_progress (
                    student_id,
                    student_assignment_id,
                    content_item_id,
                    memory_strength,
                    last_review_at,
                    next_review_at,
                    total_attempts,
                    correct_count,
                    incorrect_count,
                    repetition_count
                ) VALUES (
                    v_student_id,
                    p_student_assignment_id,
                    p_content_item_id,
                    CASE WHEN p_is_correct THEN 0.5 ELSE 0.0 END,
                    NOW(),
                    NOW() + INTERVAL '1 day',
                    1,
                    CASE WHEN p_is_correct THEN 1 ELSE 0 END,
                    CASE WHEN p_is_correct THEN 0 ELSE 1 END,
                    CASE WHEN p_is_correct THEN 1 ELSE 0 END
                )
                RETURNING * INTO v_progress;

                RETURN QUERY SELECT
                    v_progress.memory_strength,
                    v_progress.next_review_at,
                    v_progress.easiness_factor,
                    v_progress.repetition_count;
                RETURN;
            END IF;

            -- Calculate time since last review
            v_time_since_last_review := NOW() - COALESCE(v_progress.last_review_at, NOW());

            -- Ebbinghaus forgetting curve: R = e^(-t/S)
            v_new_strength := v_progress.memory_strength *
                EXP(
                    -EXTRACT(EPOCH FROM v_time_since_last_review) /
                    (86400.0 * v_progress.easiness_factor)
                );

            IF p_is_correct THEN
                -- ===== Correct Answer Processing =====

                -- Increase memory strength (max 1.0)
                v_new_strength := LEAST(1.0, v_new_strength + 0.3);

                -- Update easiness factor (SM-2 algorithm)
                v_new_easiness := v_progress.easiness_factor +
                    (0.1 - (5 - 4) * (0.08 + (5 - 4) * 0.02));
                v_new_easiness := GREATEST(1.3, v_new_easiness);

                -- Calculate next review interval (SM-2 algorithm)
                IF v_progress.repetition_count = 0 THEN
                    v_new_interval := 1;  -- First correct: review in 1 day
                ELSIF v_progress.repetition_count = 1 THEN
                    v_new_interval := 6;  -- Second correct: review in 6 days
                ELSE
                    v_new_interval := v_progress.interval_days * v_new_easiness;
                END IF;

                -- Update record with table-qualified column names
                UPDATE user_word_progress SET
                    memory_strength = v_new_strength,
                    repetition_count = user_word_progress.repetition_count + 1,
                    correct_count = user_word_progress.correct_count + 1,
                    total_attempts = user_word_progress.total_attempts + 1,
                    easiness_factor = v_new_easiness,
                    interval_days = v_new_interval,
                    last_review_at = NOW(),
                    next_review_at = NOW() + (v_new_interval || ' days')::INTERVAL,
                    accuracy_rate = (user_word_progress.correct_count + 1)::DECIMAL / (user_word_progress.total_attempts + 1),
                    updated_at = NOW()
                WHERE id = v_progress.id
                RETURNING * INTO v_progress;

            ELSE
                -- ===== Incorrect Answer Processing =====

                -- Decrease memory strength (allow to reach 0)
                v_new_strength := GREATEST(0.0, v_new_strength * 0.5);

                -- Decrease easiness factor (harder to remember)
                v_new_easiness := GREATEST(1.3, v_progress.easiness_factor - 0.2);

                -- Reset interval to 1 day
                v_new_interval := 1;

                UPDATE user_word_progress SET
                    memory_strength = v_new_strength,
                    repetition_count = 0,  -- Reset consecutive correct count
                    incorrect_count = user_word_progress.incorrect_count + 1,
                    total_attempts = user_word_progress.total_attempts + 1,
                    easiness_factor = v_new_easiness,
                    interval_days = v_new_interval,
                    last_review_at = NOW(),
                    next_review_at = NOW() + INTERVAL '1 day',
                    accuracy_rate = user_word_progress.correct_count::DECIMAL / (user_word_progress.total_attempts + 1),
                    updated_at = NOW()
                WHERE id = v_progress.id
                RETURNING * INTO v_progress;
            END IF;

            RETURN QUERY SELECT
                v_progress.memory_strength,
                v_progress.next_review_at,
                v_progress.easiness_factor,
                v_progress.repetition_count;
        END;
        $$ LANGUAGE plpgsql;
    """
    )


def downgrade() -> None:
    # Restore the previous version of the function (from migration 8a67d41aff56)
    # This reverts the bug fix: first incorrect answer sets memory_strength=0.2 (was 0.0),
    # and subsequent incorrect answers floor at 0.1 (was 0.0).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION update_memory_strength(
            p_student_assignment_id INTEGER,
            p_content_item_id INTEGER,
            p_is_correct BOOLEAN
        ) RETURNS TABLE (
            memory_strength DECIMAL,
            next_review_at TIMESTAMPTZ,
            easiness_factor DECIMAL,
            repetition_count INTEGER
        ) AS $$
        DECLARE
            v_progress user_word_progress%ROWTYPE;
            v_time_since_last_review INTERVAL;
            v_new_strength DECIMAL;
            v_new_easiness DECIMAL;
            v_new_interval DECIMAL;
            v_practiced_words INTEGER;
            v_student_id INTEGER;
        BEGIN
            -- Get or create progress record
            SELECT * INTO v_progress
            FROM user_word_progress
            WHERE student_assignment_id = p_student_assignment_id
                AND content_item_id = p_content_item_id;

            -- If not found, create new record
            IF NOT FOUND THEN
                -- Get student_id from student_assignment
                SELECT sa.student_id INTO v_student_id
                FROM student_assignments sa
                WHERE sa.id = p_student_assignment_id;

                INSERT INTO user_word_progress (
                    student_id,
                    student_assignment_id,
                    content_item_id,
                    memory_strength,
                    last_review_at,
                    next_review_at,
                    total_attempts,
                    correct_count,
                    incorrect_count,
                    repetition_count
                ) VALUES (
                    v_student_id,
                    p_student_assignment_id,
                    p_content_item_id,
                    CASE WHEN p_is_correct THEN 0.5 ELSE 0.2 END,
                    NOW(),
                    NOW() + INTERVAL '1 day',
                    1,
                    CASE WHEN p_is_correct THEN 1 ELSE 0 END,
                    CASE WHEN p_is_correct THEN 0 ELSE 1 END,
                    CASE WHEN p_is_correct THEN 1 ELSE 0 END
                )
                RETURNING * INTO v_progress;

                RETURN QUERY SELECT
                    v_progress.memory_strength,
                    v_progress.next_review_at,
                    v_progress.easiness_factor,
                    v_progress.repetition_count;
                RETURN;
            END IF;

            -- Calculate time since last review
            v_time_since_last_review := NOW() - COALESCE(v_progress.last_review_at, NOW());

            -- Ebbinghaus forgetting curve: R = e^(-t/S)
            v_new_strength := v_progress.memory_strength *
                EXP(
                    -EXTRACT(EPOCH FROM v_time_since_last_review) /
                    (86400.0 * v_progress.easiness_factor)
                );

            IF p_is_correct THEN
                -- ===== Correct Answer Processing =====

                -- Increase memory strength (max 1.0)
                v_new_strength := LEAST(1.0, v_new_strength + 0.3);

                -- Update easiness factor (SM-2 algorithm)
                v_new_easiness := v_progress.easiness_factor +
                    (0.1 - (5 - 4) * (0.08 + (5 - 4) * 0.02));
                v_new_easiness := GREATEST(1.3, v_new_easiness);

                -- Calculate next review interval (SM-2 algorithm)
                IF v_progress.repetition_count = 0 THEN
                    v_new_interval := 1;  -- First correct: review in 1 day
                ELSIF v_progress.repetition_count = 1 THEN
                    v_new_interval := 6;  -- Second correct: review in 6 days
                ELSE
                    v_new_interval := v_progress.interval_days * v_new_easiness;
                END IF;

                -- Update record with table-qualified column names
                UPDATE user_word_progress SET
                    memory_strength = v_new_strength,
                    repetition_count = user_word_progress.repetition_count + 1,
                    correct_count = user_word_progress.correct_count + 1,
                    total_attempts = user_word_progress.total_attempts + 1,
                    easiness_factor = v_new_easiness,
                    interval_days = v_new_interval,
                    last_review_at = NOW(),
                    next_review_at = NOW() + (v_new_interval || ' days')::INTERVAL,
                    accuracy_rate = (user_word_progress.correct_count + 1)::DECIMAL / (user_word_progress.total_attempts + 1),
                    updated_at = NOW()
                WHERE id = v_progress.id
                RETURNING * INTO v_progress;

            ELSE
                -- ===== Incorrect Answer Processing =====

                -- Decrease memory strength (floor at 0.1 - pre-fix behaviour)
                v_new_strength := GREATEST(0.1, v_new_strength * 0.5);

                -- Decrease easiness factor (harder to remember)
                v_new_easiness := GREATEST(1.3, v_progress.easiness_factor - 0.2);

                -- Reset interval to 1 day
                v_new_interval := 1;

                UPDATE user_word_progress SET
                    memory_strength = v_new_strength,
                    repetition_count = 0,  -- Reset consecutive correct count
                    incorrect_count = user_word_progress.incorrect_count + 1,
                    total_attempts = user_word_progress.total_attempts + 1,
                    easiness_factor = v_new_easiness,
                    interval_days = v_new_interval,
                    last_review_at = NOW(),
                    next_review_at = NOW() + INTERVAL '1 day',
                    accuracy_rate = user_word_progress.correct_count::DECIMAL / (user_word_progress.total_attempts + 1),
                    updated_at = NOW()
                WHERE id = v_progress.id
                RETURNING * INTO v_progress;
            END IF;

            RETURN QUERY SELECT
                v_progress.memory_strength,
                v_progress.next_review_at,
                v_progress.easiness_factor,
                v_progress.repetition_count;
        END;
        $$ LANGUAGE plpgsql;
    """
    )
