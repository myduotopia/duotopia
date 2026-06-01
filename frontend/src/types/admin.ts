/**
 * Admin-related types
 */

export interface AdminOrganizationCreateRequest {
  name: string;
  display_name?: string;
  description?: string;
  tax_id?: string;
  teacher_limit?: number;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  owner_email: string;
  project_staff_emails?: string[]; // NEW
  total_points?: number;
  subscription_start_date?: string;
  subscription_end_date?: string;
}

export interface AdminOrganizationCreateResponse {
  organization_id: string;
  organization_name: string;
  owner_email: string;
  owner_id: number;
  project_staff_assigned?: string[]; // NEW
  message: string;
}

// NEW: Teacher lookup response
export interface TeacherLookupResponse {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  email_verified: boolean;
}

// NEW: Organization statistics response
export interface OrganizationStatisticsResponse {
  teacher_count: number;
  teacher_limit: number | null;
  usage_percentage: number;
}

// Organization list item (for admin list view)
export interface OrganizationListItem {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  owner_email: string;
  owner_name: string | null;
  teacher_count: number;
  teacher_limit: number | null;
  total_points: number;
  used_points: number;
  remaining_points: number;
  is_active: boolean;
  created_at: string;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
}

// Organization list response with pagination
export interface OrganizationListResponse {
  items: OrganizationListItem[];
  total: number;
  limit: number;
  offset: number;
}

// Admin organization update request
export interface AdminOrganizationUpdateRequest {
  display_name?: string;
  description?: string;
  tax_id?: string;
  teacher_limit?: number;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  total_points?: number;
  subscription_start_date?: string;
  subscription_end_date?: string;
  // Phase 5-2 (issue #768): institution monthly per-student price (NT$).
  // Only meaningful for org_type='institution'. Must be > 0.
  per_student_price?: number;
}

// Admin organization update response
export interface AdminOrganizationUpdateResponse {
  organization_id: string;
  message: string;
  points_adjusted: boolean;
  points_change: number | null;
}
