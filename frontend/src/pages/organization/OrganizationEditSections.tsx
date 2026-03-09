import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SchoolListTable } from "@/components/organization/SchoolListTable";
import { StaffTable, StaffMember } from "@/components/organization/StaffTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Edit2,
  Plus,
  Building2,
  School as SchoolIcon,
  UserPlus,
  Users,
  BookOpen,
  ArrowRight,
  Package,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface Organization {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  owner_name?: string;
  owner_email?: string;
}

export interface School {
  id: string;
  organization_id: string;
  name: string;
  display_name?: string;
  description?: string;
  contact_email?: string;
  is_active: boolean;
  created_at: string;
  principal_name?: string;
  principal_email?: string;
  admin_name?: string;
  admin_email?: string;
}

interface OrganizationInfoCardProps {
  organization: Organization;
  onEdit: () => void;
}

export function OrganizationInfoCard({
  organization,
  onEdit,
}: OrganizationInfoCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <CardTitle className="text-xl">{organization.name}</CardTitle>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    organization.is_active
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {organization.is_active ? "啟用" : "停用"}
                </span>
                <span className="text-sm text-gray-500">
                  建立時間：
                  {new Date(organization.created_at).toLocaleDateString(
                    "zh-TW",
                  )}
                </span>
              </div>
              {organization.description && (
                <p className="text-sm text-gray-600">
                  {organization.description}
                </p>
              )}
            </div>
          </div>
          <Button onClick={onEdit} size="sm" className="gap-2 ml-4">
            <Edit2 className="h-4 w-4" />
            編輯機構
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {organization.owner_name && (
            <div className="col-span-2 p-3 bg-blue-50 rounded-lg">
              <h4 className="text-sm font-medium text-blue-900 mb-2">
                機構 Owner
              </h4>
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-semibold text-blue-900">
                    {organization.owner_name}
                  </p>
                  {organization.owner_email && (
                    <p className="text-sm text-blue-700">
                      {organization.owner_email}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {organization.contact_email && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-1">
                聯絡信箱
              </h4>
              <p className="text-gray-900">{organization.contact_email}</p>
            </div>
          )}

          {organization.contact_phone && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-1">
                聯絡電話
              </h4>
              <p className="text-gray-900">{organization.contact_phone}</p>
            </div>
          )}

          {organization.address && (
            <div className="col-span-2">
              <h4 className="text-sm font-medium text-gray-500 mb-1">地址</h4>
              <p className="text-gray-900">{organization.address}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface QuickActionsProps {
  orgId: string;
  schoolsCount: number;
  teachersCount: number;
}

export function QuickActionsCards({
  orgId,
  schoolsCount,
  teachersCount,
}: QuickActionsProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-4">
      <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
        <CardContent
          className="h-full p-4 flex flex-col justify-center"
          onClick={() => navigate(`/organization/${orgId}/schools`)}
        >
          <div className="flex flex-col items-center text-center gap-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <SchoolIcon className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">學校管理</h3>
              <p className="text-sm text-gray-500">{schoolsCount} 所學校</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
        <CardContent
          className="h-full p-4 flex flex-col justify-center"
          onClick={() => navigate(`/organization/${orgId}/teachers`)}
        >
          <div className="flex flex-col items-center text-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">人員管理</h3>
              <p className="text-sm text-gray-500">{teachersCount} 位教師</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
        <CardContent
          className="h-full p-4 flex flex-col justify-center"
          onClick={() => navigate(`/organization/${orgId}/materials`)}
        >
          <div className="flex flex-col items-center text-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <BookOpen className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">組織教材</h3>
              <p className="text-sm text-gray-500">教材與課程</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer">
        <CardContent
          className="h-full p-4 flex flex-col justify-center"
          onClick={() => navigate(`/organization/${orgId}/resource-materials`)}
        >
          <div className="flex flex-col items-center text-center gap-3">
            <div className="p-3 bg-orange-100 rounded-lg">
              <Package className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">
                {t("resourceMaterials.title")}
              </h3>
              <p className="text-sm text-gray-500">
                {t("resourceMaterials.browseAndCopy")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface SchoolsSectionProps {
  orgId: string;
  schools: School[];
  onCreate: () => void;
  onEdit: (school: School) => void;
  onAssignPrincipal: (school: School) => void;
}

export function SchoolsSection({
  orgId,
  schools,
  onCreate,
  onEdit,
  onAssignPrincipal,
}: SchoolsSectionProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-green-100 rounded-lg">
            <SchoolIcon className="h-4 w-4 text-green-600" />
          </div>
          <CardTitle className="text-base">學校列表</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => navigate(`/organization/${orgId}/schools`)}
          >
            查看全部
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" />
            新增學校
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {schools.length === 0 ? (
          <div className="text-center py-12">
            <SchoolIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500 mb-2">尚無學校</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              新增第一個學校
            </Button>
          </div>
        ) : (
          <SchoolListTable
            schools={schools}
            onEdit={onEdit}
            onAssignPrincipal={onAssignPrincipal}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface StaffSectionProps {
  orgId: string;
  teachers: StaffMember[];
  onInvite: () => void;
  onRoleUpdated: () => void;
}

export function StaffSection({
  orgId,
  teachers,
  onInvite,
  onRoleUpdated,
}: StaffSectionProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-purple-100 rounded-lg">
            <Users className="h-4 w-4 text-purple-600" />
          </div>
          <CardTitle className="text-base">工作人員</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => navigate(`/organization/${orgId}/teachers`)}
          >
            查看全部
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onInvite}
          >
            <UserPlus className="h-4 w-4" />
            新增工作人員
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {teachers.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500 mb-2">尚無工作人員</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={onInvite}>
              <UserPlus className="h-4 w-4" />
              新增第一位工作人員
            </Button>
          </div>
        ) : (
          <StaffTable
            staff={teachers}
            organizationId={orgId}
            onRoleUpdated={onRoleUpdated}
            showEmail={true}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface SchoolGridSectionProps {
  schools: School[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function SchoolGridSection({
  schools,
  currentPage,
  totalPages,
  onPageChange,
}: SchoolGridSectionProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-green-100 rounded-lg">
            <SchoolIcon className="h-4 w-4 text-green-600" />
          </div>
          <CardTitle className="text-base">學校列表</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {schools.length === 0 ? (
          <div className="text-center py-12">
            <SchoolIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">尚無學校</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-4">
              {schools.map((school) => (
                <Card
                  key={school.id}
                  className="w-[200px] h-[200px] hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/organization/schools/${school.id}`)}
                >
                  <CardContent className="h-full p-4 flex flex-col justify-center">
                    <div className="flex flex-col items-center text-center gap-3">
                      <div className="p-3 bg-green-100 rounded-lg">
                        <SchoolIcon className="h-6 w-6 text-green-600" />
                      </div>
                      <div className="w-full">
                        <h3 className="font-semibold text-gray-900 mb-1 truncate">
                          {school.name}
                        </h3>
                        {school.principal_name && (
                          <p className="text-xs text-gray-600 mb-1 truncate">
                            校長：{school.principal_name}
                          </p>
                        )}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            school.is_active
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {school.is_active ? "啟用" : "停用"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex items-center justify-center gap-4 pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-gray-600">
                第 {currentPage} 頁 / 共 {totalPages} 頁
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
