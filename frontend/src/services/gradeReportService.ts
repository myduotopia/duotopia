/**
 * Grade-report download client (issue #708).
 *
 * Both endpoints take the same input — a list of selected (archived)
 * assignment ids — and stream a binary file back:
 *  - POST /api/teachers/classrooms/:id/grade-report
 *      → one xlsx for the whole class (across the selected assignments).
 *  - POST /api/teachers/classrooms/:id/student-grade-report
 *      → one zip containing one xlsx per enrolled student. The classroom
 *        having only one student still produces a zip with one file inside.
 *
 * Both responses carry the unicode filename via RFC-5987
 * `Content-Disposition: filename*=UTF-8''<urlencoded>`; we honour that
 * and fall through to a sensible default if the header is missing.
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
function parseFilename(header: string | null, fallback: string): string {
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

async function downloadBinary(
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
  await downloadBinary(
    `/api/teachers/classrooms/${classroomId}/grade-report`,
    { assignment_ids: assignmentIds },
    `成績總覽_${todayYYYYMMDD()}.xlsx`,
  );
}

export async function downloadStudentGradeReport(
  classroomId: number,
  assignmentIds: number[],
): Promise<void> {
  await downloadBinary(
    `/api/teachers/classrooms/${classroomId}/student-grade-report`,
    { assignment_ids: assignmentIds },
    `學生成績單_${todayYYYYMMDD()}.zip`,
  );
}
