import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api";
import { logError } from "@/utils/errorLogger";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

interface Student {
  id: number;
  name: string;
  email?: string | null;
  student_number?: string | null;
}

interface ClassroomStudentsSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: number;
  classroomName: string;
  schoolId: string;
  onSuccess?: () => void;
}

export function ClassroomStudentsSidebar({
  open,
  onOpenChange,
  classroomId,
  classroomName,
  schoolId,
  onSuccess,
}: ClassroomStudentsSidebarProps) {
  const [classroomStudents, setClassroomStudents] = useState<Student[]>([]);
  const [availableStudents, setAvailableStudents] = useState<Student[]>([]);
  const [_loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<number>>(
    new Set(),
  );

  useEffect(() => {
    if (open && classroomId && schoolId) {
      setSearchTerm("");
      setSelectedStudentIds(new Set());
      fetchClassroomStudents();
    }
  }, [open, classroomId, schoolId]);

  const fetchClassroomStudents = async () => {
    try {
      setLoading(true);
      // Parallel fetch: classroom students + school students at the same time
      const [classroomData, schoolData] = await Promise.all([
        apiClient.getClassroomStudents(schoolId, classroomId) as Promise<
          Student[]
        >,
        apiClient.getSchoolStudents(schoolId) as Promise<Student[]>,
      ]);

      const classroomStudentsData = classroomData || [];
      setClassroomStudents(classroomStudentsData);

      // Filter out students already in the classroom
      const classroomStudentIds = new Set(
        classroomStudentsData.map((s) => s.id),
      );
      setAvailableStudents(
        (schoolData || []).filter(
          (s: Student) => !classroomStudentIds.has(s.id),
        ),
      );
    } catch (error) {
      logError("Failed to fetch classroom students", error, {
        schoolId,
        classroomId,
      });
      toast.error("載入班級學生失敗");
    } finally {
      setLoading(false);
    }
  };

  const handleAddStudents = async () => {
    if (selectedStudentIds.size === 0) {
      toast.error("請選擇至少一個學生");
      return;
    }

    try {
      await apiClient.batchAddStudentsToClassroom(
        schoolId,
        classroomId,
        Array.from(selectedStudentIds),
      );
      toast.success("學生已成功加入班級");
      setSelectedStudentIds(new Set());
      await fetchClassroomStudents();
      onSuccess?.();
    } catch (error) {
      logError("Failed to add students to classroom", error, {
        schoolId,
        classroomId,
        studentIds: Array.from(selectedStudentIds),
      });
      toast.error("加入學生失敗");
    }
  };

  const handleRemoveStudent = async (studentId: number) => {
    try {
      await apiClient.removeStudentFromClassroom(
        schoolId,
        studentId,
        classroomId,
      );
      toast.success("學生已從班級移除");
      await fetchClassroomStudents();
      onSuccess?.();
    } catch (error) {
      logError("Failed to remove student from classroom", error, {
        schoolId,
        studentId,
        classroomId,
      });
      toast.error("移除學生失敗");
    }
  };

  const toggleStudentSelection = (studentId: number) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const filteredAvailableStudents = availableStudents.filter((student) =>
    searchTerm
      ? student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.student_number?.toLowerCase().includes(searchTerm.toLowerCase())
      : true,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{classroomName} - 學生管理</SheetTitle>
          <SheetDescription>
            管理此班級的學生，可以從學校學生名單中添加或移除學生
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* 班級學生列表 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">
                班級學生 ({classroomStudents.length})
              </h3>
            </div>
            <ScrollArea className="h-[200px] border rounded-md p-3">
              {classroomStudents.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">尚無學生</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {classroomStudents.map((student) => (
                    <div
                      key={student.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100"
                    >
                      <div>
                        <div className="font-medium text-sm">
                          {student.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {student.student_number &&
                            `${student.student_number} • `}
                          {student.email || "無 Email"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveStudent(student.id)}
                        className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* 添加學生區塊 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">
                從學校添加學生 ({selectedStudentIds.size} 已選擇)
              </h3>
              {selectedStudentIds.size > 0 && (
                <Button size="sm" onClick={handleAddStudents}>
                  <Plus className="h-4 w-4 mr-1" />
                  加入班級
                </Button>
              )}
            </div>

            {/* 搜尋框 */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋學生（姓名、學號、Email）"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* 可用學生列表 */}
            <ScrollArea className="h-[250px] border rounded-md p-3">
              {filteredAvailableStudents.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">
                    {searchTerm ? "找不到符合條件的學生" : "沒有可用的學生"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAvailableStudents.map((student) => {
                    const isSelected = selectedStudentIds.has(student.id);
                    return (
                      <div
                        key={student.id}
                        onClick={() => toggleStudentSelection(student.id)}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-blue-50 border border-blue-200"
                            : "bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <div>
                          <div className="font-medium text-sm">
                            {student.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {student.student_number &&
                              `${student.student_number} • `}
                            {student.email || "無 Email"}
                          </div>
                        </div>
                        {isSelected && (
                          <Badge variant="default" className="bg-blue-600">
                            已選
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
