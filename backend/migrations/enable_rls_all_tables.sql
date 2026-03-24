-- Enable Row Level Security (RLS) on all Duotopia tables
-- Date: 2025-10-29
-- Purpose: Fix Supabase Security Advisor warnings

-- Enable RLS on all tables
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_content_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_item_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_subscription_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_status_history ENABLE ROW LEVEL SECURITY;

-- ======================================
-- RLS Policies for Teachers
-- ======================================

-- Teachers can view their own profile
CREATE POLICY "teachers_select_own" ON teachers
  FOR SELECT USING (auth.uid()::text = id::text);

-- Teachers can update their own profile
CREATE POLICY "teachers_update_own" ON teachers
  FOR UPDATE USING (auth.uid()::text = id::text);

-- ======================================
-- RLS Policies for Students
-- ======================================

-- Students can view their own profile
CREATE POLICY "students_select_own" ON students
  FOR SELECT USING (auth.uid()::text = id::text);

-- Students can update their own profile
CREATE POLICY "students_update_own" ON students
  FOR UPDATE USING (auth.uid()::text = id::text);

-- Teachers can view students in their classrooms
CREATE POLICY "teachers_select_classroom_students" ON students
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM classroom_students cs
      JOIN classrooms c ON c.id = cs.classroom_id
      WHERE cs.student_id = students.id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Classrooms
-- ======================================

-- Teachers can view their own classrooms
CREATE POLICY "classrooms_select_own" ON classrooms
  FOR SELECT USING (teacher_id::text = auth.uid()::text);

-- Teachers can insert their own classrooms
CREATE POLICY "classrooms_insert_own" ON classrooms
  FOR INSERT WITH CHECK (teacher_id::text = auth.uid()::text);

-- Teachers can update their own classrooms
CREATE POLICY "classrooms_update_own" ON classrooms
  FOR UPDATE USING (teacher_id::text = auth.uid()::text);

-- Teachers can delete their own classrooms
CREATE POLICY "classrooms_delete_own" ON classrooms
  FOR DELETE USING (teacher_id::text = auth.uid()::text);

-- ======================================
-- RLS Policies for Classroom Students
-- ======================================

-- Teachers can view students in their classrooms
CREATE POLICY "classroom_students_select_teacher" ON classroom_students
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = classroom_students.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- Students can view their own classroom memberships
CREATE POLICY "classroom_students_select_student" ON classroom_students
  FOR SELECT USING (student_id::text = auth.uid()::text);

-- Teachers can manage classroom_students
CREATE POLICY "classroom_students_insert_teacher" ON classroom_students
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = classroom_students.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "classroom_students_delete_teacher" ON classroom_students
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = classroom_students.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Programs
-- ======================================

-- Teachers can view all programs (課程計畫是公開的)
CREATE POLICY "programs_select_all" ON programs
  FOR SELECT USING (true);

-- Teachers can manage their own programs
CREATE POLICY "programs_insert_own" ON programs
  FOR INSERT WITH CHECK (teacher_id::text = auth.uid()::text);

CREATE POLICY "programs_update_own" ON programs
  FOR UPDATE USING (teacher_id::text = auth.uid()::text);

CREATE POLICY "programs_delete_own" ON programs
  FOR DELETE USING (teacher_id::text = auth.uid()::text);

-- ======================================
-- RLS Policies for Lessons
-- ======================================

-- Anyone can view lessons (屬於公開課程)
CREATE POLICY "lessons_select_all" ON lessons
  FOR SELECT USING (true);

-- Teachers can manage lessons in their programs
CREATE POLICY "lessons_insert_teacher" ON lessons
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM programs p
      WHERE p.id = lessons.program_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "lessons_update_teacher" ON lessons
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM programs p
      WHERE p.id = lessons.program_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "lessons_delete_teacher" ON lessons
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM programs p
      WHERE p.id = lessons.program_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Contents
-- ======================================

-- Anyone can view contents
CREATE POLICY "contents_select_all" ON contents
  FOR SELECT USING (true);

-- Teachers can manage contents in their lessons
CREATE POLICY "contents_insert_teacher" ON contents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM lessons l
      JOIN programs p ON p.id = l.program_id
      WHERE l.id = contents.lesson_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "contents_update_teacher" ON contents
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM lessons l
      JOIN programs p ON p.id = l.program_id
      WHERE l.id = contents.lesson_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "contents_delete_teacher" ON contents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM lessons l
      JOIN programs p ON p.id = l.program_id
      WHERE l.id = contents.lesson_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Assignments
-- ======================================

-- Teachers can view their own assignments
CREATE POLICY "assignments_select_teacher" ON assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = assignments.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- Students can view assignments assigned to them
CREATE POLICY "assignments_select_student" ON assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM student_assignments sa
      WHERE sa.assignment_id = assignments.id
      AND sa.student_id::text = auth.uid()::text
    )
  );

-- Teachers can manage assignments
CREATE POLICY "assignments_insert_teacher" ON assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = assignments.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "assignments_update_teacher" ON assignments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = assignments.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "assignments_delete_teacher" ON assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM classrooms c
      WHERE c.id = assignments.classroom_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Assignment Contents
-- ======================================

-- Teachers can view assignment contents
CREATE POLICY "assignment_contents_select_teacher" ON assignment_contents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM assignments a
      JOIN classrooms c ON c.id = a.classroom_id
      WHERE a.id = assignment_contents.assignment_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- Students can view their assignment contents
CREATE POLICY "assignment_contents_select_student" ON assignment_contents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM student_assignments sa
      WHERE sa.assignment_id = assignment_contents.assignment_id
      AND sa.student_id::text = auth.uid()::text
    )
  );

-- Teachers can manage assignment contents
CREATE POLICY "assignment_contents_insert_teacher" ON assignment_contents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM assignments a
      JOIN classrooms c ON c.id = a.classroom_id
      WHERE a.id = assignment_contents.assignment_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "assignment_contents_delete_teacher" ON assignment_contents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM assignments a
      JOIN classrooms c ON c.id = a.classroom_id
      WHERE a.id = assignment_contents.assignment_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Student Assignments
-- ======================================

-- Teachers can view student assignments
CREATE POLICY "student_assignments_select_teacher" ON student_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM assignments a
      JOIN classrooms c ON c.id = a.classroom_id
      WHERE a.id = student_assignments.assignment_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- Students can view their own assignments
CREATE POLICY "student_assignments_select_student" ON student_assignments
  FOR SELECT USING (student_id::text = auth.uid()::text);

-- Students can update their own assignments
CREATE POLICY "student_assignments_update_student" ON student_assignments
  FOR UPDATE USING (student_id::text = auth.uid()::text);

-- ======================================
-- RLS Policies for Student Content Progress
-- ======================================

-- Teachers can view progress
CREATE POLICY "student_content_progress_select_teacher" ON student_content_progress
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM students s
      JOIN classroom_students cs ON cs.student_id = s.id
      JOIN classrooms c ON c.id = cs.classroom_id
      WHERE s.id = student_content_progress.student_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- Students can view their own progress
CREATE POLICY "student_content_progress_select_student" ON student_content_progress
  FOR SELECT USING (student_id::text = auth.uid()::text);

-- Students can insert/update their own progress
CREATE POLICY "student_content_progress_insert_student" ON student_content_progress
  FOR INSERT WITH CHECK (student_id::text = auth.uid()::text);

CREATE POLICY "student_content_progress_update_student" ON student_content_progress
  FOR UPDATE USING (student_id::text = auth.uid()::text);

-- ======================================
-- RLS Policies for Content Items
-- ======================================

-- Anyone can view content items
CREATE POLICY "content_items_select_all" ON content_items
  FOR SELECT USING (true);

-- Teachers can manage content items
CREATE POLICY "content_items_insert_teacher" ON content_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM contents cnt
      JOIN lessons l ON l.id = cnt.lesson_id
      JOIN programs p ON p.id = l.program_id
      WHERE cnt.id = content_items.content_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "content_items_update_teacher" ON content_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM contents cnt
      JOIN lessons l ON l.id = cnt.lesson_id
      JOIN programs p ON p.id = l.program_id
      WHERE cnt.id = content_items.content_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

CREATE POLICY "content_items_delete_teacher" ON content_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM contents cnt
      JOIN lessons l ON l.id = cnt.lesson_id
      JOIN programs p ON p.id = l.program_id
      WHERE cnt.id = content_items.content_id
      AND p.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- RLS Policies for Student Item Progress
-- ======================================

-- Teachers can view student progress
CREATE POLICY "student_item_progress_select_teacher" ON student_item_progress
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM students s
      JOIN classroom_students cs ON cs.student_id = s.id
      JOIN classrooms c ON c.id = cs.classroom_id
      WHERE s.id = student_item_progress.student_id
      AND c.teacher_id::text = auth.uid()::text
    )
  );

-- Students can view their own progress
CREATE POLICY "student_item_progress_select_student" ON student_item_progress
  FOR SELECT USING (student_id::text = auth.uid()::text);

-- Students can insert/update their own progress
CREATE POLICY "student_item_progress_insert_student" ON student_item_progress
  FOR INSERT WITH CHECK (student_id::text = auth.uid()::text);

CREATE POLICY "student_item_progress_update_student" ON student_item_progress
  FOR UPDATE USING (student_id::text = auth.uid()::text);

-- ======================================
-- RLS Policies for Subscriptions
-- ======================================

-- Teachers can view their own subscription transactions
CREATE POLICY "subscriptions_select_own" ON teacher_subscription_transactions
  FOR SELECT USING (teacher_id::text = auth.uid()::text);

-- Teachers can insert their own subscriptions
CREATE POLICY "subscriptions_insert_own" ON teacher_subscription_transactions
  FOR INSERT WITH CHECK (teacher_id::text = auth.uid()::text);

-- ======================================
-- RLS Policies for Invoice Status History
-- ======================================

-- Teachers can view their own invoice history
CREATE POLICY "invoice_history_select_own" ON invoice_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM teacher_subscription_transactions t
      WHERE t.id = invoice_status_history.transaction_id
      AND t.teacher_id::text = auth.uid()::text
    )
  );

-- Teachers can insert their own invoice history
CREATE POLICY "invoice_history_insert_own" ON invoice_status_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM teacher_subscription_transactions t
      WHERE t.id = invoice_status_history.transaction_id
      AND t.teacher_id::text = auth.uid()::text
    )
  );

-- ======================================
-- 完成！
-- ======================================
-- 執行此 SQL 後，Supabase Security Advisor 應該不會再顯示警告
