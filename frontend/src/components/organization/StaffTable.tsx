import { useState } from "react";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Mail,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";

export interface StaffMember {
  id: number;
  email: string;
  name: string;
  role: string; // org_owner, org_admin, teacher, school_admin
  is_active: boolean;
  created_at: string;
}

export type StaffSortField = "name" | "email" | "role" | "created_at";
export type SortDirection = "asc" | "desc" | null;

interface StaffTableProps {
  staff: StaffMember[];
  organizationId: string;
  onRoleUpdated?: () => void;
  onToggleStatus?: (teacher: StaffMember, isActive: boolean) => void;
  sortField?: StaffSortField | null;
  sortDirection?: SortDirection;
  onSort?: (field: StaffSortField) => void;
  showEmail?: boolean;
}

export function StaffTable({
  staff,
  organizationId,
  onRoleUpdated,
  onToggleStatus,
  sortField,
  sortDirection,
  onSort,
  showEmail = true,
}: StaffTableProps) {
  const token = useTeacherAuthStore((state) => state.token);
  const user = useTeacherAuthStore((state) => state.user);
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);

  // Check if current user can edit roles
  const canEditRoles = user?.role === "org_owner" || user?.role === "org_admin";

  const RolePermissionsDialog = () => {
    const permissions = [
      {
        role: "org_owner",
        label: "組織擁有者",
        canEditMaterials: true,
        canAccessBackend: true,
        canAssignGrade: true,
      },
      {
        role: "org_admin",
        label: "組織管理員",
        canEditMaterials: true,
        canAccessBackend: true,
        canAssignGrade: true,
      },
      {
        role: "teacher",
        label: "教師",
        canEditMaterials: false,
        canAccessBackend: false,
        canAssignGrade: true,
      },
    ];

    return (
      <Dialog>
        <DialogTrigger asChild>
          <button
            className="ml-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="查看角色權限說明"
          >
            <Info className="h-4 w-4" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0">
          <DialogHeader>
            <DialogTitle>角色權限說明</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">角色</TableHead>
                  <TableHead className="text-center">編輯組織教材</TableHead>
                  <TableHead className="text-center">管理班級與學生</TableHead>
                  <TableHead className="text-center">派發/批改作業</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((perm) => (
                  <TableRow key={perm.role}>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(
                          perm.role,
                        )}`}
                      >
                        {perm.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {perm.canEditMaterials ? (
                        <Check className="h-5 w-5 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-5 w-5 text-gray-300 mx-auto" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {perm.canAccessBackend ? (
                        <Check className="h-5 w-5 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-5 w-5 text-gray-300 mx-auto" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {perm.canAssignGrade ? (
                        <Check className="h-5 w-5 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-5 w-5 text-gray-300 mx-auto" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 text-sm text-gray-600">
              <p className="mb-2">
                <strong>編輯組織教材：</strong>
                可以新增、編輯或刪除組織層級的教材內容
              </p>
              <p className="mb-2">
                <strong>管理班級與學生：</strong>
                可以進入組織管理後台，新增或管理班級與學生資料
              </p>
              <p>
                <strong>派發/批改作業：</strong>
                可以指派作業給學生並批改作業內容
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const StatusInfoDialog = () => {
    const statuses = [
      {
        status: "active",
        label: "啟用",
        description: "可存取組織教材、班級與學生資料",
        countsTowardLicense: true,
      },
      {
        status: "inactive",
        label: "停用",
        description: "無法存取該組織的教材、班級與學生資料",
        countsTowardLicense: false,
      },
    ];

    return (
      <Dialog>
        <DialogTrigger asChild>
          <button
            className="ml-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="查看狀態說明"
          >
            <Info className="h-4 w-4" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0">
          <DialogHeader>
            <DialogTitle>教師狀態說明</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">狀態</TableHead>
                  <TableHead>說明</TableHead>
                  <TableHead className="text-center w-[140px]">
                    授權狀況
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status) => (
                  <TableRow key={status.status}>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          status.status === "active"
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {status.description}
                    </TableCell>
                    <TableCell className="text-center">
                      {status.countsTowardLicense ? (
                        <span className="text-sm font-medium text-orange-600">
                          佔授權數
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-green-600">
                          不佔授權數
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 text-sm text-gray-600">
              <p className="mb-2">
                <strong>授權狀況：</strong>
                只有「啟用」狀態的教師會計入組織的教師授權數量
              </p>
              <p>
                <strong>提示：</strong>
                如果組織授權數即將用完，可以暫時停用不常使用的教師帳號來釋放授權額度
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const SortableHeader = ({
    field,
    children,
  }: {
    field: StaffSortField;
    children: React.ReactNode;
  }) => {
    if (!onSort) {
      return <TableHead>{children}</TableHead>;
    }

    const isActive = sortField === field;
    const icon = isActive ? (
      sortDirection === "asc" ? (
        <ArrowUp className="h-4 w-4" />
      ) : (
        <ArrowDown className="h-4 w-4" />
      )
    ) : (
      <ArrowUpDown className="h-4 w-4 opacity-50" />
    );

    return (
      <TableHead>
        <button
          onClick={() => onSort(field)}
          className="flex items-center gap-2 hover:text-gray-900 transition-colors"
        >
          {children}
          {icon}
        </button>
      </TableHead>
    );
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "org_owner":
        return "bg-purple-100 text-purple-800";
      case "org_admin":
        return "bg-blue-100 text-blue-800";
      case "school_admin":
        return "bg-green-100 text-green-800";
      case "teacher":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "org_owner":
        return "組織擁有者";
      case "org_admin":
        return "組織管理員";
      case "school_admin":
        return "學校管理員";
      case "teacher":
        return "教師";
      default:
        return role;
    }
  };

  const handleRoleChange = async (teacherId: number, newRole: string) => {
    setUpdatingRoleId(teacherId);
    try {
      const response = await fetch(
        `${API_URL}/api/organizations/${organizationId}/teachers/${teacherId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: newRole }),
        },
      );

      if (response.ok) {
        toast.success("角色更新成功");
        if (onRoleUpdated) {
          onRoleUpdated();
        }
      } else {
        const data = await response.json();
        const errorMessage =
          typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail) || "角色更新失敗";
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error("Failed to update teacher role:", error);
      toast.error("網路連線錯誤");
    } finally {
      setUpdatingRoleId(null);
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader field="name">姓名</SortableHeader>
          {showEmail && <SortableHeader field="email">Email</SortableHeader>}
          <TableHead>
            <div className="flex items-center">
              {onSort ? (
                <button
                  onClick={() => onSort("role")}
                  className="flex items-center gap-2 hover:text-gray-900 transition-colors"
                >
                  角色
                  {sortField === "role" ? (
                    sortDirection === "asc" ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  ) : (
                    <ArrowUpDown className="h-4 w-4 opacity-50" />
                  )}
                </button>
              ) : (
                <span>角色</span>
              )}
              <RolePermissionsDialog />
            </div>
          </TableHead>
          <TableHead>
            <div className="flex items-center">
              <span>狀態</span>
              <StatusInfoDialog />
            </div>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {staff.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={showEmail ? 4 : 3}
              className="text-center py-8 text-gray-500"
            >
              沒有符合條件的教師
            </TableCell>
          </TableRow>
        ) : (
          staff.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium">{member.name}</TableCell>
              {showEmail && (
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-gray-400" />
                    {member.email}
                  </div>
                </TableCell>
              )}
              <TableCell>
                {canEditRoles && member.id !== user?.id ? (
                  <Select
                    value={member.role}
                    onValueChange={(newRole) =>
                      handleRoleChange(member.id, newRole)
                    }
                    disabled={updatingRoleId === member.id}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="teacher">教師</SelectItem>
                      <SelectItem value="org_admin">組織管理員</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(
                      member.role,
                    )}`}
                  >
                    {getRoleLabel(member.role)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {canEditRoles ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={member.is_active}
                      onCheckedChange={(checked: boolean) =>
                        onToggleStatus?.(member, checked)
                      }
                      disabled={member.id === user?.id}
                    />
                    <span className="text-sm text-gray-600">
                      {member.is_active ? "啟用" : "停用"}
                    </span>
                  </div>
                ) : (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      member.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {member.is_active ? "啟用" : "停用"}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
