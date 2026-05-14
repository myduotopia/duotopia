/**
 * Grade-report download client (issue #708).
 *
 * Two endpoints:
 *  - POST /api/teachers/classrooms/:id/grade-report          → class report
 *  - POST /api/teachers/classrooms/:id/student-grade-report  → student report
 *
 * Both return an xlsx blob with an RFC-5987 Content-Disposition header
 * carrying the unicode filename; we honour that and fall through to a
 * sensible default if the header is missing or malformed.
 */
import { API_URL } from "../config/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

export class GradeReportError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "GradeReportError";
  }
}

function authHeader(): Record<string, string> {
  const token = useTeacherAuthStore.getState().token;
  if (!token) {
    throw new GradeReportError(401, "Not signed in");
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * Parse the unicode filename from a Content-Disposition header.
 * Prefers `filename*=UTF-8''<urlencoded>` over the ASCII `filename="..."`.
 */
function parseFilename(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  if (plain) return plain[1];
  return fallback;
}

async function downloadXlsx(
  endpoint: string,
  body: unknown,
  fallbackFilename: string,
): Promise<void> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      if (json && typeof json === "object" && "detail" in json) {
        detail = String((json as { detail: unknown }).detail);
      }
    } catch {
      // server didn't return JSON; keep the HTTP-status detail
    }
    throw new GradeReportError(res.status, detail);
  }

  const filename = parseFilename(
    res.headers.get("Content-Disposition"),
    fallbackFilename,
  );

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation slightly so Safari/Firefox have time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayYYYYMMDD(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export async function downloadClassGradeReport(
  classroomId: number,
  assignmentIds: number[],
): Promise<void> {
  await downloadXlsx(
    `/api/teachers/classrooms/${classroomId}/grade-report`,
    { assignment_ids: assignmentIds },
    `成績總覽_${todayYYYYMMDD()}.xlsx`,
  );
}

export interface StudentGradeReportParams {
  classroomId: number;
  studentIds: number[];
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export async function downloadStudentGradeReport(
  params: StudentGradeReportParams,
): Promise<void> {
  const body: Record<string, unknown> = { student_ids: params.studentIds };
  if (params.startDate) body.start_date = params.startDate;
  if (params.endDate) body.end_date = params.endDate;
  await downloadXlsx(
    `/api/teachers/classrooms/${params.classroomId}/student-grade-report`,
    body,
    `學生成績單_${todayYYYYMMDD()}.xlsx`,
  );
}
