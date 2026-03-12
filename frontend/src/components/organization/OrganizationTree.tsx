import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useOrganization } from "@/contexts/OrganizationContext";
import { API_URL } from "@/config/api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Building2,
  School as SchoolIcon,
  GraduationCap,
  UserCheck,
  Users,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Organization {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  is_active: boolean;
  created_at: string;
}

interface SchoolData {
  id: string;
  organization_id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  is_active: boolean;
  created_at: string;
}

interface OrganizationTreeProps {
  onNodeSelect?: (
    type: "organization" | "school",
    data: Organization | SchoolData,
  ) => void;
  className?: string;
}

/**
 * OrganizationTree - Hierarchical tree view of organizations and schools
 * Used in the organization portal dashboard
 */
export function OrganizationTree({
  onNodeSelect,
  className,
}: OrganizationTreeProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useTeacherAuthStore((state) => state.token);
  const user = useTeacherAuthStore((state) => state.user);
  const [expandedSchools, setExpandedSchools] = useState<Set<string>>(
    new Set(),
  );
  const {
    selectedNode,
    setSelectedNode,
    organizations,
    schools,
    setSchools,
    expandedOrgs,
    setExpandedOrgs,
    isFetchingOrgs,
  } = useOrganization();

  // Check if user is school-level only (cannot click organization nodes)
  const isSchoolLevelUser =
    user?.role === "school_admin" || user?.role === "school_director";

  const fetchSchools = useCallback(
    async (orgId: string) => {
      try {
        const response = await fetch(
          `${API_URL}/api/schools?organization_id=${orgId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (response.ok) {
          const data = await response.json();
          setSchools((prev) => ({ ...prev, [orgId]: data }));
        }
      } catch (error) {
        console.error("Failed to fetch schools:", error);
      }
    },
    [token, setSchools],
  );

  // Auto-expand first organization on initial load only
  const hasAutoExpanded = useRef(false);
  useEffect(() => {
    if (!hasAutoExpanded.current && organizations.length > 0 && expandedOrgs.length === 0) {
      hasAutoExpanded.current = true;
      setExpandedOrgs([organizations[0].id]);
    }
  }, [organizations, expandedOrgs.length, setExpandedOrgs]);

  // Auto-fetch schools when organization is expanded
  useEffect(() => {
    expandedOrgs.forEach((orgId) => {
      if (!schools[orgId]) {
        fetchSchools(orgId);
      }
    });
  }, [expandedOrgs, schools, fetchSchools]);

  // Auto-expand all schools when they are loaded
  useEffect(() => {
    expandedOrgs.forEach((orgId) => {
      const orgSchools = schools[orgId];
      if (orgSchools) {
        setExpandedSchools((prev) => {
          const next = new Set(prev);
          orgSchools.forEach((s) => next.add(s.id));
          return next;
        });
      }
    });
  }, [schools, expandedOrgs]);

  const handleNodeClick = (
    type: "organization" | "school",
    data: Organization | SchoolData,
  ) => {
    // School-level users cannot click organization nodes
    if (type === "organization" && isSchoolLevelUser) {
      return;
    }

    setSelectedNode({ type, id: data.id, data });
    onNodeSelect?.(type, data);
  };

  const toggleSchool = (schoolId: string) => {
    setExpandedSchools((prev) => {
      const next = new Set(prev);
      if (next.has(schoolId)) {
        next.delete(schoolId);
      } else {
        next.add(schoolId);
      }
      return next;
    });
  };

  if (isFetchingOrgs) {
    return (
      <div className={cn("p-8 text-center", className)}>
        <div className="text-gray-500">載入組織架構中...</div>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className={cn("p-8 text-center", className)}>
        <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p className="text-gray-500 mb-2">尚無組織資料</p>
        <p className="text-sm text-gray-400">請聯繫系統管理員建立組織</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <Accordion
        type="single"
        collapsible
        value={expandedOrgs[0] || ""}
        onValueChange={(val) => setExpandedOrgs(val ? [val] : [])}
        className="space-y-0"
      >
        {organizations.map((org) => (
          <AccordionItem
            key={org.id}
            value={org.id}
            className="border-none"
          >
            <AccordionTrigger
              className={cn(
                "hover:no-underline px-2 py-2 rounded-md transition-colors",
                isSchoolLevelUser
                  ? "cursor-default opacity-60"
                  : "hover:bg-gray-100 cursor-pointer",
                !isSchoolLevelUser &&
                  selectedNode?.type === "organization" &&
                  selectedNode.id === org.id &&
                  "bg-blue-50 text-blue-700",
              )}
              onClick={() => handleNodeClick("organization", org)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-medium text-sm text-left break-words whitespace-normal line-clamp-2">
                  {org.display_name || org.name}
                </span>
              </div>
            </AccordionTrigger>

            <AccordionContent className="pb-1">
              <div className="ml-3 border-l border-gray-200 space-y-0.5">
                {schools[org.id]?.map((school) => (
                  <div key={school.id}>
                    {/* School row */}
                    <div className="flex items-center">
                      <button
                        onClick={() => {
                          handleNodeClick("school", school);
                          if (!expandedSchools.has(school.id)) {
                            toggleSchool(school.id);
                          }
                        }}
                        className={cn(
                          "flex-1 flex items-center gap-2 ml-3 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-gray-100 min-w-0",
                          selectedNode?.type === "school" &&
                            selectedNode.id === school.id &&
                            "bg-green-50 text-green-700",
                        )}
                      >
                        <SchoolIcon className="w-3.5 h-3.5 text-green-600 shrink-0" />
                        <span className="text-sm break-words whitespace-normal line-clamp-2">
                          {school.display_name || school.name}
                        </span>
                      </button>
                      <button
                        onClick={() => toggleSchool(school.id)}
                        className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 mr-1"
                      >
                        {expandedSchools.has(school.id) ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* School sub-items */}
                    {expandedSchools.has(school.id) && (
                      <div className="ml-6 border-l border-gray-200 space-y-0.5 mt-0.5">
                        {[
                          {
                            label: "班級管理",
                            path: `/organization/schools/${school.id}/classrooms`,
                            icon: GraduationCap,
                            color: "text-amber-600",
                          },
                          {
                            label: "學生管理",
                            path: `/organization/schools/${school.id}/students`,
                            icon: UserCheck,
                            color: "text-green-600",
                          },
                          {
                            label: "教師管理",
                            path: `/organization/schools/${school.id}/teachers`,
                            icon: Users,
                            color: "text-purple-600",
                          },
                        ].map(({ label, path, icon: Icon, color }) => (
                          <button
                            key={path}
                            onClick={() =>
                              navigate(path, {
                                state: {
                                  school: {
                                    id: school.id,
                                    name: school.display_name || school.name,
                                    organization_id: school.organization_id,
                                  },
                                  organization: {
                                    id: org.id,
                                    name: org.display_name || org.name,
                                  },
                                },
                              })
                            }
                            className={cn(
                              "w-full flex items-center gap-2 ml-3 px-2 py-1.5 rounded-md text-xs text-left transition-colors hover:bg-gray-100",
                              location.pathname === path &&
                                "bg-gray-100 font-medium text-gray-900",
                            )}
                          >
                            <Icon className={cn("w-3 h-3", color)} />
                            <span className="text-gray-600">{label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {schools[org.id]?.length === 0 && (
                  <div className="text-xs text-gray-400 ml-3 px-2 py-2">
                    尚無學校
                  </div>
                )}

                {!schools[org.id] && (
                  <div className="text-xs text-gray-400 ml-3 px-2 py-2">
                    載入中...
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
