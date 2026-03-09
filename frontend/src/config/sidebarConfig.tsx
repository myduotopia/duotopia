/**
 * Sidebar 配置 - 定義所有選單分組和項目
 */

import {
  Home,
  Building2,
  GraduationCap,
  Users,
  BookOpen,
  Package,
} from "lucide-react";
import { SidebarGroup } from "@/types/sidebar";

export const getSidebarGroups = (
  t: (key: string) => string,
): SidebarGroup[] => [
  // 🏢 組織管理 (org_owner, org_admin, school_admin) - Notion Style
  {
    id: "organization-hub",
    label: t("teacherLayout.nav.orgManagement"),
    icon: Building2,
    requiredRoles: ["org_owner", "org_admin", "school_admin"],
    items: [
      {
        id: "organizations-hub",
        label: t("teacherLayout.nav.orgStructure"),
        icon: Building2,
        path: "/teacher/organizations-hub",
      },
    ],
  },
  // 👥 教學管理 (所有教師) - 包含儀表板
  {
    id: "class-management",
    label: t("teacherLayout.nav.teachingManagement"),
    icon: GraduationCap,
    items: [
      {
        id: "dashboard",
        label: t("teacherLayout.nav.dashboard"),
        icon: Home,
        path: "/teacher/dashboard",
      },
      {
        id: "classrooms",
        label: t("teacherLayout.nav.myClassrooms"),
        icon: GraduationCap,
        path: "/teacher/classrooms",
      },
      {
        id: "students",
        label: t("teacherLayout.nav.allStudents"),
        icon: Users,
        path: "/teacher/students",
      },
      {
        id: "programs",
        label: t("teacherLayout.nav.publicPrograms"),
        icon: BookOpen,
        path: "/teacher/programs",
      },
      {
        id: "org-materials",
        label: t("teacherLayout.nav.orgMaterials"),
        icon: Building2,
        path: "/teacher/org-materials",
      },
    ],
  },
  // 📦 共享資源 (所有教師)
  {
    id: "shared-resources",
    label: t("teacherLayout.nav.sharedResources"),
    icon: Package,
    items: [
      {
        id: "resource-materials",
        label: t("resourceMaterials.title"),
        icon: Package,
        path: "/teacher/resource-materials",
      },
    ],
  },
];
