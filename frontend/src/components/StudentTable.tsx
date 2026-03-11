import React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Edit,
  Users,
  Plus,
  Eye,
  RotateCcw,
  Trash2,
  Copy,
  CheckSquare,
  Square,
} from "lucide-react";

export interface Student {
  id: number;
  name: string;
  email?: string; // Make email optional to match global Student type
  student_number?: string;
  birthdate?: string;
  password_changed?: boolean;
  last_login?: string | null;
  status?: string;
  classroom_id?: number;
  classroom_name?: string;
  phone?: string;
  enrollment_date?: string;
  school_id?: string;
  school_name?: string;
  organization_id?: string;
  created_at?: string;
}

interface StudentTableProps {
  students: Student[];
  showClassroom?: boolean; // Show classroom column in all students view
  onAddStudent?: () => void;
  onEditStudent?: (student: Student) => void;
  onViewStudent?: (student: Student) => void;
  onResetPassword?: (student: Student) => void;
  onDeleteStudent?: (student: Student) => void;
  onBulkAction?: (action: string, studentIds: number[]) => void;
  emptyMessage?: string;
  emptyDescription?: string;
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
  disableActions?: boolean;
  disableReason?: string;
}

export default function StudentTable({
  students,
  showClassroom = false,
  onAddStudent,
  onEditStudent,
  onViewStudent,
  onResetPassword,
  onDeleteStudent,
  onBulkAction,
  emptyMessage,
  emptyDescription,
  selectedIds: externalSelectedIds,
  onSelectionChange,
  disableActions = false,
  disableReason = "",
}: StudentTableProps) {
  const { t } = useTranslation();
  const [internalSelectedIds, setInternalSelectedIds] = React.useState<
    Set<number>
  >(new Set());
  const selectedIds = externalSelectedIds || internalSelectedIds;
  const setSelectedIds = onSelectionChange || setInternalSelectedIds;

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    if (onBulkAction) {
      // Notify parent about selection
      onBulkAction("selection", Array.from(newSelected));
    }
  };

  const toggleSelectAll = () => {
    let newSelected: Set<number>;
    if (selectedIds.size === students.length) {
      newSelected = new Set();
    } else {
      newSelected = new Set(students.map((s) => s.id));
    }
    setSelectedIds(newSelected);
    if (onBulkAction) {
      // Notify parent about selection
      onBulkAction("selection", Array.from(newSelected));
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  if (students.length === 0) {
    return (
      <div className="text-center py-12">
        <Users className="h-12 w-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{emptyMessage}</p>
        {emptyDescription && (
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
            {emptyDescription}
          </p>
        )}
        {onAddStudent && (
          <Button
            className="mt-4"
            size="sm"
            onClick={onAddStudent}
            disabled={disableActions}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("studentTable.emptyState.addFirst")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden">
        <div className="p-4 space-y-4">
          {students.map((student) => (
            <div
              key={student.id}
              className="border dark:border-gray-700 rounded-lg p-4 space-y-3 bg-white dark:bg-gray-800"
            >
              {/* Header with selection */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1">
                  {onBulkAction && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSelect(student.id)}
                      className="p-0 h-8 w-8"
                    >
                      {selectedIds.has(student.id) ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      {student.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium dark:text-gray-100">
                      {student.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("studentTable.info.studentNumber")}{" "}
                      {student.student_number || "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Info Grid */}
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Email:{" "}
                  </span>
                  <span className="dark:text-gray-200">
                    {student.email || "-"}
                  </span>
                </div>
                {student.phone && (
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("studentTable.info.phone")}{" "}
                    </span>
                    <span className="dark:text-gray-200">{student.phone}</span>
                  </div>
                )}
                {showClassroom && (
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("studentTable.info.classroom")}{" "}
                    </span>
                    {student.classroom_name ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        {student.classroom_name}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {t("studentTable.classroom.unassigned")}
                      </span>
                    )}
                  </div>
                )}
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("studentTable.info.password")}{" "}
                  </span>
                  {student.password_changed ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                      {t("studentTable.passwordStatus.changed")}
                    </span>
                  ) : student.birthdate ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 font-mono">
                      {student.birthdate?.replace(/-/g, "")}
                    </span>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-400">
                      {t("studentTable.passwordStatus.notSet")}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("studentTable.info.lastLogin")}{" "}
                  </span>
                  <span className="dark:text-gray-200">
                    {student.last_login
                      ? formatDate(student.last_login)
                      : t("studentTable.lastLogin.never")}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t dark:border-gray-700">
                {onViewStudent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewStudent(student)}
                    className="flex-1"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {t("studentTable.actions.view")}
                  </Button>
                )}
                {onEditStudent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEditStudent(student)}
                    className="flex-1"
                    disabled={disableActions}
                    title={disableActions ? disableReason : ""}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    {t("studentTable.actions.edit")}
                  </Button>
                )}
                {onDeleteStudent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          t("studentTable.actions.deleteConfirm", {
                            name: student.name,
                          }),
                        )
                      ) {
                        onDeleteStudent(student);
                      }
                    }}
                    className="hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400"
                    disabled={disableActions}
                    title={disableActions ? disableReason : ""}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {onBulkAction && (
                <TableHead className="w-[40px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="p-0 h-8 w-8"
                  >
                    {selectedIds.size === students.length &&
                    students.length > 0 ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </Button>
                </TableHead>
              )}
              <TableHead className="text-left w-[100px]">
                {t("studentTable.columns.studentNumber")}
              </TableHead>
              <TableHead className="text-left min-w-[120px]">
                {t("studentTable.columns.studentName")}
              </TableHead>
              <TableHead className="text-left min-w-[250px]">
                {t("studentTable.columns.contactInfo")}
              </TableHead>
              <TableHead className="text-left min-w-[100px] whitespace-nowrap">
                {t("studentTable.columns.passwordStatus")}
              </TableHead>
              <TableHead className="text-left min-w-[100px] whitespace-nowrap">
                {t("studentTable.columns.lastLogin")}
              </TableHead>
              <TableHead className="text-left w-[120px]">
                {t("studentTable.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.id}>
                {onBulkAction && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSelect(student.id)}
                      className="p-0 h-8 w-8"
                    >
                      {selectedIds.has(student.id) ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                )}
                <TableCell>
                  <span className="text-sm">
                    {student.student_number || "-"}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-sm font-medium text-blue-600">
                        {student.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">{student.name}</p>
                      {student.phone && (
                        <p className="text-xs text-gray-500">{student.phone}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <div className="text-sm">{student.email || "-"}</div>
                    {showClassroom && (
                      <div className="flex items-center gap-2 mt-1">
                        {student.classroom_name ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                            {student.classroom_name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            {t("studentTable.unassigned")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="inline-flex items-center space-x-1">
                    {(() => {
                      // Convert UTC created_at to Taiwan date (UTC+8)
                      const getDefaultPwd = () => {
                        if (student.created_at) {
                          const d = new Date(student.created_at);
                          const tw = new Date(
                            d.getTime() + 8 * 60 * 60 * 1000,
                          );
                          return tw.toISOString().split("T")[0].replace(/-/g, "");
                        }
                        if (student.birthdate) {
                          return student.birthdate.replace(/-/g, "");
                        }
                        return null;
                      };
                      const defaultPwd = getDefaultPwd();

                      if (student.password_changed) {
                        return (
                          <>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 whitespace-nowrap">
                              {t("studentTable.passwordStatus.changed")}
                            </span>
                            {onResetPassword && (
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
                        );
                      }

                      if (defaultPwd) {
                        return (
                          <>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700 font-mono whitespace-nowrap">
                              {defaultPwd}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t(
                                "studentTable.passwordStatus.copyPassword",
                                { password: defaultPwd },
                              )}
                              onClick={() => {
                                navigator.clipboard.writeText(defaultPwd);
                                toast.success(
                                  t(
                                    "studentTable.passwordStatus.passwordCopied",
                                    { password: defaultPwd },
                                  ),
                                );
                              }}
                              className="h-6 w-6 p-0"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </>
                        );
                      }

                      return (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-700 whitespace-nowrap">
                          {t("studentTable.passwordStatus.notSet")}
                        </span>
                      );
                    })()}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {student.last_login ? (
                    <div>
                      <div className="text-sm">
                        {formatDate(student.last_login)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("studentTable.lastLogin.daysAgo", {
                          count: Math.floor(
                            (Date.now() -
                              new Date(student.last_login).getTime()) /
                              (1000 * 60 * 60 * 24),
                          ),
                        })}
                      </div>
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center space-x-2">
                    {onViewStudent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t("studentTable.view")}
                        onClick={() => onViewStudent(student)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {onEditStudent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={
                          disableActions
                            ? disableReason
                            : t("studentTable.edit")
                        }
                        onClick={() => onEditStudent(student)}
                        disabled={disableActions}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {onDeleteStudent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={
                          disableActions
                            ? disableReason
                            : t("studentTable.delete")
                        }
                        onClick={() => {
                          if (
                            confirm(
                              t("studentTable.confirmDelete", {
                                name: student.name,
                              }),
                            )
                          ) {
                            onDeleteStudent(student);
                          }
                        }}
                        className="hover:bg-red-50 hover:text-red-600"
                        disabled={disableActions}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
