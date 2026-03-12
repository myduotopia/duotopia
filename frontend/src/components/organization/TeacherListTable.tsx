import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface Teacher {
  id: number;
  email: string;
  name: string;
  roles: string[];
  is_active: boolean;
  created_at: string;
}

export interface ClassroomInfo {
  id: string;
  name: string;
}

interface TeacherListTableProps {
  teachers: Teacher[];
  schoolId: string;
  onRoleUpdated?: () => void;
  teacherClassrooms?: Record<number, ClassroomInfo[]>;
}

export function TeacherListTable({
  teachers,
  teacherClassrooms,
}: TeacherListTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>姓名</TableHead>
          <TableHead>Email</TableHead>
          {teacherClassrooms && <TableHead>班級</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {teachers.map((teacher) => {
          const classrooms = teacherClassrooms?.[teacher.id] || [];
          return (
            <TableRow key={teacher.id}>
              <TableCell className="font-medium">{teacher.name}</TableCell>
              <TableCell>{teacher.email}</TableCell>
              {teacherClassrooms && (
                <TableCell>
                  {classrooms.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {classrooms.map((c) => (
                        <span
                          key={c.id}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">未指派</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
