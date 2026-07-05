/**
 * Centralized TypeScript type definitions for Duotopia frontend
 */

// ============ Base User Types ============
export interface User {
  id: number;
  email: string;
  name: string;
  is_demo: boolean;
}

export interface Student {
  id: number;
  name: string;
  email?: string;
  student_number?: string; // Student ID number (optional)
  birthdate: string;
  phone?: string;
  status: string;
  classroom_id?: number;
  password?: string;
  created_at?: string;
  updated_at?: string;
}

// ============ Classroom Types ============
export interface ClassroomInfo {
  id: number;
  name: string;
  description?: string;
  level?: string;
  student_count: number;
  students: Student[];
  program_count?: number;
  school_id?: string;
  school_name?: string;
  organization_id?: string;
}

export interface Classroom {
  id: number;
  name: string;
  description?: string;
  level?: string;
  student_count: number;
  program_count?: number;
  created_at?: string;
  updated_at?: string;
  school_id?: string;
  school_name?: string;
  organization_id?: string;
}

// ============ Content Types ============
export interface ContentItem {
  id?: number | string;
  text: string;
  translation?: string;
  definition?: string;
  audio_url?: string;
  image_url?: string;
  question?: string;
  answer?: string;
  options?: string[];
  // Example sentence fields
  example_sentence?: string;
  example_sentence_translation?: string;
}

export interface Content {
  id: number;
  type?: string;
  title: string;
  items_count: number;
  estimated_time?: string;
  items?: ContentItem[];
  // Issue #587: lesson_id may be null when content lives directly under a program
  lesson_id?: number | null;
  program_id?: number | null;
  target_wpm?: number;
  target_accuracy?: number;
  time_limit_seconds?: number;
  // Additional properties used in ClassroomDetail
  programName?: string;
  lessonName?: string;
}

export interface ContentRow {
  id?: number;
  text?: string;
  translation?: string;
}

// ============ Program and Lesson Types ============
export interface Lesson {
  id: number;
  name: string;
  description?: string;
  order_index: number;
  estimated_minutes?: number;
  program_id: number;
  contents?: Content[];
}

export interface Program {
  id: number;
  name: string;
  description?: string;
  level?: string;
  estimated_hours?: number;
  created_at?: string;
  order_index?: number;
  classroom_id?: number;
  teacher_id?: number;
  organization_id?: string; // UUID
  school_id?: string; // UUID
  lessons?: Lesson[];
  contents?: Content[];
  classroom_name?: string;
  is_duplicate?: boolean;
  tags?: string[];
  is_template?: boolean;
  visibility?: "private" | "public" | "organization_only" | "individual_only";
}

// ============ Assignment Status Types ============
export type AssignmentStatusEnum =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "GRADED"
  | "RETURNED"
  | "RESUBMITTED";

// ============ Teacher Assignment Types ============
export interface AssignmentSubmission {
  id: number;
  student_number: number;
  assignment_id: number;
  status: string;
  score?: number;
  feedback?: string;
}

export interface Assignment {
  id: number;
  title: string;
  description?: string;
  status?: string;
  classroom_id?: number;
  content_id?: number;
  due_date?: string;
  start_date?: string;
  created_at?: string;
  submissions?: AssignmentSubmission[];
  // Additional properties used in ClassroomDetail
  completion_rate?: number;
  content_type?: string;
  instructions?: string;
  student_count?: number;
  assigned_at?: string;
  // Content property for student dashboard
  content?: {
    type: string;
    title: string;
  };
  // Score property for graded assignments
  score?: number;
  // 練習模式
  practice_mode?:
    | "reading"
    | "rearrangement"
    | "word_reading"
    | "word_selection"
    | "word_selection_quiz"
    | "word_spelling"
    | "word_spelling_quiz"
    | "word_cloze"
    | "word_cloze_quiz"
    | "tug_of_war";
  // Issue #835: Live quiz mode（老師主控開始/收卷，全班同步）
  is_live_quiz?: boolean;
  quiz_opened_at?: string | null;
  quiz_closed_at?: string | null;
  // 封存狀態
  is_archived?: boolean;
  archived_at?: string;
}

// ============ Student Assignment Types ============
export interface StudentAssignment {
  id: number;
  assignment_id?: number;
  student_number: number;
  classroom_id: number;
  title: string;
  status: AssignmentStatusEnum;
  score?: number;
  feedback?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  started_at?: string;
  submitted_at?: string;
  due_date?: string;
  // Extended properties for UI
  content_progress?: StudentContentProgress[];
  contents?: Content[];
  estimated_time?: string;
  progress_percentage?: number;
  content_count?: number;
  completed_count?: number;
}

// Student Content Progress for individual activities within assignment
export interface StudentContentProgress {
  id: number;
  student_assignment_id: number;
  content_id: number;
  status: AssignmentStatusEnum;
  score?: number;
  checked?: boolean;
  feedback?: string;
  response_data?: Record<string, unknown>;
  ai_scores?: Record<string, unknown>;
  order_index: number;
  // Extended properties for UI
  content?: Content;
  estimated_time?: string;
  completed_at?: string;
}

// Student Assignment Card Data for list view
export interface StudentAssignmentCard {
  id: number;
  title: string;
  status: AssignmentStatusEnum;
  due_date?: string;
  progress_percentage: number;
  content_count: number;
  completed_count: number;
  estimated_time?: string;
  content_type?: string;
  practice_mode?: string; // 'reading' | 'rearrangement' | 'word_selection' | 'word_reading'
  score_category?: string; // 'speaking' | 'listening' | 'writing' | 'reading' — auto-resolved from practice_mode + play_audio; see docs/design/score-category-mapping.md
  classroom_name?: string;
  teacher_name?: string;
  score?: number;
  is_overdue?: boolean;
  // Issue #835: Live quiz mode — 學生作業卡依此切「等待老師開始/進入考卷/已收卷」
  is_live_quiz?: boolean;
  quiz_opened_at?: string | null;
  quiz_closed_at?: string | null;
}

// Raw assignment row as returned by the student assignments API.
// Shared by StudentAssignmentList and StudentAssignmentDetail (Issue #331).
// Superset of both call sites — fields that only one page uses are optional.
export interface AssignmentData {
  id: number;
  assignment_id?: number;
  title: string;
  status?: string;
  score?: number;
  feedback?: string;
  classroom_id: number;
  student_number?: number;
  is_active?: boolean;
  assigned_at?: string;
  created_at?: string;
  due_date?: string;
  submitted_at?: string;
  content_type?: string;
  practice_mode?: string;
  score_category?: string;
  content_count?: number;
  is_live_quiz?: boolean;
  quiz_opened_at?: string | null;
  quiz_closed_at?: string | null;
}

// Student Dashboard specific data
export interface StudentDashboard {
  active_assignments: StudentAssignmentCard[];
  completed_assignments: StudentAssignmentCard[];
  stats: {
    total_assignments: number;
    completed_assignments: number;
    average_score?: number;
    total_study_time?: string;
  };
  recent_activity: {
    assignment_title: string;
    activity_type: string;
    completed_at: string;
    score?: number;
  }[];
}

export interface AssignmentDetail {
  id: number;
  title: string;
  description?: string;
  instructions?: string;
  status: string;
  content: Content;
  submissions: AssignmentSubmission[];
  due_date?: string;
  created_at: string;
  score?: number;
  feedback?: string;
  students?: number[]; // Array of assigned student IDs
}

// ============ Activity Types ============
export interface ActivityResult {
  id: number;
  student_assignment_id: number;
  activity_type: string;
  content_id: number;
  score?: number;
  feedback?: string;
  completed_at?: string;
}

export interface ActivityProgress {
  total: number;
  completed: number;
  percentage: number;
}

// ============ API Response Types ============
export interface ApiResponse<T> {
  data: T;
  message?: string;
  status: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

// ============ Auth Types ============
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  promo_code?: string;
}

// ============ Form Types ============
export interface StudentFormData {
  name: string;
  email?: string;
  student_number?: string;
  birthdate: string;
  phone?: string;
  classroom_id?: number;
}

export interface ClassroomFormData {
  name: string;
  description?: string;
  level: string;
}

export interface ProgramFormData {
  name: string;
  description?: string;
  level?: string;
  classroom_id: number;
  estimated_hours?: number;
}

export interface LessonFormData {
  name: string;
  description?: string;
  order_index?: number;
  estimated_minutes?: number;
}

export interface ContentFormData {
  type: string;
  title: string;
  items: ContentItem[];
  target_wpm?: number;
  target_accuracy?: number;
  time_limit_seconds?: number;
}

// ============ Dialog Types ============
export type DialogType = "view" | "create" | "edit" | "delete" | null;

// ============ Dashboard Types ============
export interface DashboardStats {
  total_students: number;
  total_classrooms: number;
  total_assignments: number;
  active_students: number;
}

export interface TeacherDashboard {
  stats: DashboardStats;
  recent_assignments: Assignment[];
  recent_students: Student[];
}

// ============ Audio Types ============
export interface AudioUploadResponse {
  audio_url: string;
  duration?: number;
  file_size?: number;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  rate?: string;
  volume?: string;
}

export interface TTSResponse {
  audio_url: string;
}

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
}

// ============ Translation Types ============
export interface TranslationRequest {
  text: string;
  target_lang: string;
}

export interface TranslationResponse {
  translated_text: string;
  source_lang: string;
  target_lang: string;
}

// ============ Error Types ============
export interface ApiError {
  detail: string;
  status_code?: number;
}

// ============ Utility Types ============
export type SortOrder = "asc" | "desc";

export interface SortConfig {
  key: string;
  direction: SortOrder;
}

export type LoadingState = "idle" | "loading" | "succeeded" | "failed";

// ============ Component Props Types ============
export interface TableColumn<T> {
  key: keyof T;
  title: string;
  sortable?: boolean;
  render?: (value: T[keyof T], record: T) => React.ReactNode;
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// ============ Event Types ============
export interface DragEvent {
  programId?: number;
  lessonIndex?: number;
}

// ============ Generic Utility Types ============
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
