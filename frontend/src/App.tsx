// Test workflow trigger: 2025-11-10
import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RoleBasedRedirect } from "./components/RoleBasedRedirect";
import { organizationRoutes } from "./routes/organizationRoutes";
import Home from "./pages/Home";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherRegister from "./pages/TeacherRegister";
import { TeacherVerifyEmail } from "./pages/TeacherVerifyEmail";
import { TeacherEmailVerification } from "./pages/TeacherEmailVerification";
import TeacherForgotPassword from "./pages/TeacherForgotPassword";
import TeacherResetPassword from "./pages/TeacherResetPassword";
import TeacherSetupPassword from "./pages/TeacherSetupPassword";
import TeacherDashboard from "./pages/teacher/TeacherDashboard";
import TeacherClassrooms from "./pages/teacher/TeacherClassrooms";
import TeacherStudents from "./pages/teacher/TeacherStudents";
import ClassroomDetail from "./pages/teacher/ClassroomDetail";
import TeacherAssignmentDetailPage from "./pages/teacher/TeacherAssignmentDetailPage";
import TeacherAssignmentPreviewPage from "./pages/teacher/TeacherAssignmentPreviewPage";
import GradingPage from "./pages/teacher/GradingPage";
import TeacherTemplatePrograms from "./pages/teacher/TeacherTemplatePrograms";
import OrgMaterialsPage from "./pages/teacher/OrgMaterialsPage";
import ResourceMaterialsPage from "./pages/teacher/ResourceMaterialsPage";
import TeacherSubscription from "./pages/teacher/TeacherSubscription";
import TeacherProfile from "./pages/teacher/TeacherProfile";
import StudentLogin from "./pages/StudentLogin";
import StudentForgotPassword from "./pages/StudentForgotPassword";
import StudentResetPassword from "./pages/StudentResetPassword";
import StudentDashboard from "./pages/StudentDashboard";
import StudentAssignmentList from "./pages/student/StudentAssignmentList";
import StudentAssignmentDetail from "./pages/student/StudentAssignmentDetail";
import StudentActivityPage from "./pages/student/StudentActivityPage";
import StudentLayout from "./components/StudentLayout";
import TeacherLayout from "./components/TeacherLayout";
import EmailVerification from "./pages/EmailVerification";
import StudentProfile from "./pages/student/StudentProfile";
import DatabaseAdminPage from "./pages/admin/DatabaseAdminPage";
import AdminMonitoringPage from "./pages/admin/AdminMonitoringPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import CreateOrganization from "./pages/admin/CreateOrganization";
import DebugPage from "./pages/DebugPage";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import PricingPage from "./pages/PricingPage";
import TestSubscription from "./pages/TestSubscription";
import DemoAssignmentPage from "./pages/DemoAssignmentPage";
import { Toaster } from "sonner";
import { useCrossTabAuthSync } from "./hooks/useCrossTabAuthSync";

/**
 * Custom hook to detect mobile screen size
 * Uses Tailwind's sm breakpoint (640px) as the threshold
 * Issue #142: Toast notifications block question numbers on mobile
 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 640;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isMobile;
}

function App() {
  // Issue #142: Use bottom-center on mobile to avoid blocking question numbers
  const isMobile = useIsMobile();
  // Issue #472: Cross-tab auth sync
  useCrossTabAuthSync();

  return (
    <>
      <Toaster
        position={isMobile ? "bottom-center" : "top-center"}
        richColors
        closeButton
        duration={3000}
      />
      <Routes>
        {/* Root route - automatically redirect based on user role */}
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<RoleBasedRedirect />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/pricing" element={<PricingPage />} />

        {/* Demo Route - Public, no authentication required */}
        <Route path="/demo/:assignmentId" element={<DemoAssignmentPage />} />

        {/* Organization Routes - Must come before teacher routes */}
        {organizationRoutes}

        {/* Teacher Routes */}
        <Route path="/teacher/login" element={<TeacherLogin />} />
        <Route path="/teacher/register" element={<TeacherRegister />} />
        <Route
          path="/teacher/forgot-password"
          element={<TeacherForgotPassword />}
        />
        <Route
          path="/teacher/reset-password"
          element={<TeacherResetPassword />}
        />
        <Route
          path="/teacher/setup-password"
          element={<TeacherSetupPassword />}
        />
        <Route
          path="/teacher/verify-email"
          element={<TeacherEmailVerification />}
        />
        <Route
          path="/teacher/verify-email-prompt"
          element={<TeacherVerifyEmail />}
        />
        <Route
          path="/teacher/dashboard"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherDashboard />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/classrooms"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherClassrooms />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/classroom/:id"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <ClassroomDetail />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/classroom/:classroomId/assignment/:assignmentId"
          element={
            <ProtectedRoute>
              <TeacherAssignmentDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/classroom/:classroomId/assignment/:assignmentId/preview"
          element={
            <ProtectedRoute>
              <TeacherAssignmentPreviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/assignment/:assignmentId/preview"
          element={
            <ProtectedRoute>
              <TeacherAssignmentPreviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/classroom/:classroomId/assignment/:assignmentId/grading"
          element={
            <ProtectedRoute>
              <GradingPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/students"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherStudents />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/programs"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherTemplatePrograms />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/template-programs"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherTemplatePrograms />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/template-programs/:id"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <ClassroomDetail isTemplateMode={true} />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/org-materials"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <OrgMaterialsPage />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/resource-materials"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <ResourceMaterialsPage />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/subscription"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherSubscription />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher/profile"
          element={
            <ProtectedRoute>
              <TeacherLayout>
                <TeacherProfile />
              </TeacherLayout>
            </ProtectedRoute>
          }
        />
        {/* ✅ Phase 4: 組織管理路由已移至 /organization/* */}
        {/* Teacher Profile is now integrated in TeacherLayout sidebar */}

        {/* Student Routes */}
        <Route path="/student/login" element={<StudentLogin />} />
        <Route
          path="/student/forgot-password"
          element={<StudentForgotPassword />}
        />
        <Route
          path="/student/reset-password"
          element={<StudentResetPassword />}
        />

        {/* Email Verification */}
        <Route path="/verify-email" element={<EmailVerification />} />

        {/* Admin Routes */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/admin/database" element={<DatabaseAdminPage />} />
        <Route
          path="/admin/organizations/create"
          element={
            <ProtectedRoute requireAdmin>
              <CreateOrganization />
            </ProtectedRoute>
          }
        />

        {/* Student Routes with Layout */}
        <Route path="/student" element={<StudentLayout />}>
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="assignments" element={<StudentAssignmentList />} />
          <Route
            path="assignment/:id/detail"
            element={<StudentAssignmentDetail />}
          />
          <Route
            path="assignment/:assignmentId/activity"
            element={<StudentActivityPage />}
          />
          <Route
            path="progress"
            element={
              <div className="p-8 text-center">學習進度頁面開發中...</div>
            }
          />
          <Route
            path="achievements"
            element={<div className="p-8 text-center">成就頁面開發中...</div>}
          />
          <Route
            path="calendar"
            element={<div className="p-8 text-center">行事曆頁面開發中...</div>}
          />
          <Route
            path="messages"
            element={<div className="p-8 text-center">訊息頁面開發中...</div>}
          />
          <Route path="profile" element={<StudentProfile />} />
          <Route
            path="settings"
            element={<div className="p-8 text-center">設定頁面開發中...</div>}
          />
        </Route>

        {/* Admin Pages - No Auth Required */}
        <Route path="/admin/monitoring" element={<AdminMonitoringPage />} />

        {/* Debug 頁面 */}
        <Route path="/debug" element={<DebugPage />} />

        {/* Test Pages */}
        <Route
          path="/teacher/test-sub"
          element={
            <ProtectedRoute>
              <TestSubscription />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
