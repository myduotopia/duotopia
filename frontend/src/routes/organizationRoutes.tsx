import { Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import OrganizationLayout from "@/layouts/OrganizationLayout";
import OrganizationDashboard from "@/pages/organization/OrganizationDashboard";
import { OrganizationIndexRedirect } from "@/components/organization/OrganizationIndexRedirect";
import SchoolsPage from "@/pages/organization/SchoolsPage";
import TeachersPage from "@/pages/organization/TeachersPage";
import MaterialsPage from "@/pages/organization/MaterialsPage";
import OrganizationEditPage from "@/pages/organization/OrganizationEditPage";
import SchoolDetailPage from "@/pages/organization/SchoolDetailPage";

import SchoolClassroomsPage from "@/pages/organization/SchoolClassroomsPage";
import SchoolTeachersPage from "@/pages/organization/SchoolTeachersPage";
import SchoolStudentsPage from "@/pages/organization/SchoolStudentsPage";
import OrganizationsListPage from "@/pages/organization/OrganizationsListPage";
import OrgResourceMaterialsPage from "@/pages/organization/OrgResourceMaterialsPage";

/**
 * Organization Routes - Accessible only to users with organization roles
 * Required roles: org_owner, org_admin, school_admin
 */
export const organizationRoutes = (
  <Route
    path="/organization"
    element={
      <ProtectedRoute
        requiredRoles={["org_owner", "org_admin", "school_admin"]}
      >
        <OrganizationLayout />
      </ProtectedRoute>
    }
  >
    {/* Dashboard - Organization structure overview */}
    <Route path="dashboard" element={<OrganizationDashboard />} />

    {/* All organizations list page - Admin only */}
    <Route
      path="all"
      element={
        <ProtectedRoute requireAdmin={true}>
          <OrganizationsListPage />
        </ProtectedRoute>
      }
    />

    {/* Organization detail page */}
    <Route path=":orgId" element={<OrganizationEditPage />} />

    {/* Schools management under specific organization */}
    <Route path=":orgId/schools" element={<SchoolsPage />} />

    {/* Teachers management under specific organization */}
    <Route path=":orgId/teachers" element={<TeachersPage />} />

    {/* Materials management under specific organization */}
    <Route path=":orgId/materials" element={<MaterialsPage />} />

    {/* Resource materials pack under specific organization */}
    <Route
      path=":orgId/resource-materials"
      element={<OrgResourceMaterialsPage />}
    />

    {/* School detail page */}
    <Route path="schools/:schoolId" element={<SchoolDetailPage />} />

    {/* School classrooms page */}
    <Route
      path="schools/:schoolId/classrooms"
      element={<SchoolClassroomsPage />}
    />

    {/* School teachers page */}
    <Route path="schools/:schoolId/teachers" element={<SchoolTeachersPage />} />

    {/* School students page */}
    <Route path="schools/:schoolId/students" element={<SchoolStudentsPage />} />

    {/* Default schools/teachers/materials pages (use selected org from context) */}
    <Route path="schools" element={<SchoolsPage />} />
    <Route path="teachers" element={<TeachersPage />} />
    <Route path="materials" element={<MaterialsPage />} />

    {/* Default: redirect to first organization */}
    <Route index element={<OrganizationIndexRedirect />} />
  </Route>
);
