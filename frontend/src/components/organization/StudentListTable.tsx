import { Edit2, UserPlus, Trash2, X, Copy, RotateCcw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export interface Student {
  id: number;
  name: string;
  email?: string | null;
  student_number?: string | null;
  birthdate?: string | null;
  is_active: boolean;
  password_changed?: boolean;
  email_verified?: boolean;
  schools?: Array<{ id: string; name: string }>;
  classrooms?: Array<{ id: number; name: string; school_id: string }>;
  created_at: string;
  updated_at?: string | null;
}

interface StudentListTableProps {
  students: Student[];
  onEdit?: (student: Student) => void;
  onAssignClassroom?: (student: Student) => void;
  onRemove?: (studentId: number) => void;
  onRemoveFromClassroom?: (studentId: number, classroomId: number) => void;
  onResetPassword?: (student: Student) => void;
}

function getDefaultPassword(student: Student): string | null {
  if (student.created_at) {
    const d = new Date(student.created_at);
    const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return tw.toISOString().split("T")[0].replace(/-/g, "");
  }
  if (student.birthdate) {
    return student.birthdate.replace(/-/g, "");
  }
  return null;
}

export function StudentListTable({
  students,
  onEdit,
  onAssignClassroom,
  onRemove,
  onRemoveFromClassroom,
  onResetPassword,
}: StudentListTableProps) {
  const { t } = useTranslation();

  const handleCopyPassword = (password: string) => {
    navigator.clipboard.writeText(password);
    toast.success(
      t("studentTable.passwordStatus.passwordCopied", { password }),
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>姓名</TableHead>
          <TableHead>學號</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>生日</TableHead>
          <TableHead>班級</TableHead>
          <TableHead>密碼狀態</TableHead>
          <TableHead>狀態</TableHead>
          {(onEdit || onRemove) && (
            <TableHead className="text-right">操作</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {students.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-gray-500 py-8">
              尚無學生資料
            </TableCell>
          </TableRow>
        ) : (
          students.map((student) => {
            const defaultPwd = getDefaultPassword(student);

            return (
              <TableRow key={student.id}>
                <TableCell className="font-medium">{student.name}</TableCell>
                <TableCell>{student.student_number || "-"}</TableCell>
                <TableCell>{student.email || "-"}</TableCell>
                <TableCell>{student.birthdate || "-"}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-2">
                    {student.classrooms && student.classrooms.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {student.classrooms.map((classroom) => (
                          <span
                            key={classroom.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800"
                          >
                            {classroom.name}
                            {onRemoveFromClassroom && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveFromClassroom(
                                    student.id,
                                    classroom.id,
                                  );
                                }}
                                className="hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                                aria-label={`從 ${classroom.name} 移除`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400">未分配</span>
                    )}
                    {onAssignClassroom && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onAssignClassroom(student)}
                        className="w-fit h-7 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      >
                        <UserPlus className="h-3 w-3" />
                        加入班級
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="inline-flex items-center gap-1">
                    {student.password_changed ? (
                      <>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 whitespace-nowrap">
                          {t("studentTable.passwordStatus.changed")}
                        </span>
                        {onResetPassword && !student.email_verified && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t(
                              "studentTable.passwordStatus.resetToDefault",
                            )}
                            onClick={() => onResetPassword(student)}
                            className="h-7 px-2"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </>
                    ) : defaultPwd ? (
                      <>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700 font-mono whitespace-nowrap">
                          {defaultPwd}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t("studentTable.passwordStatus.copyPassword", {
                            password: defaultPwd,
                          })}
                          onClick={() => handleCopyPassword(defaultPwd)}
                          className="h-7 px-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-gray-400">
                        {t("studentTable.passwordStatus.notSet")}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      student.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {student.is_active ? "啟用" : "停用"}
                  </span>
                </TableCell>
                {(onEdit || onRemove) && (
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {onEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(student)}
                          className="gap-1"
                        >
                          <Edit2 className="h-4 w-4" />
                          編輯
                        </Button>
                      )}
                      {onRemove && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemove(student.id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1"
                        >
                          <Trash2 className="h-4 w-4" />
                          移除
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
