import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { apiClient } from "@/lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { API_URL } from "@/config/api";
import { logError } from "@/utils/errorLogger";
import { toast } from "sonner";

interface ImportStudentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  onSuccess: () => void;
}

interface Classroom {
  id: number;
  name: string;
}

interface ImportStudent {
  name: string;
  email?: string;
  student_number?: string;
  birthdate?: string;
  phone?: string;
  classroom_id?: number;
  classroom_name?: string;
  isValid: boolean;
  errors: string[];
}

export function ImportStudentsDialog({
  open,
  onOpenChange,
  schoolId,
  onSuccess,
}: ImportStudentsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportStudent[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<
    "skip" | "update" | "add_suffix"
  >("skip");
  const token = useTeacherAuthStore((state) => state.token);

  useEffect(() => {
    if (open && schoolId) {
      fetchClassrooms();
    }
  }, [open, schoolId]);

  const fetchClassrooms = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/schools/${schoolId}/classrooms`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setClassrooms(data || []);
      } else {
        logError("Failed to fetch classrooms", new Error(response.statusText), {
          schoolId,
        });
      }
    } catch (error) {
      logError("Failed to fetch classrooms", error, { schoolId });
    }
  };

  // 下載範本
  const downloadTemplate = () => {
    const template = [
      ["姓名", "學號", "Email", "生日", "電話", "班級"],
      [
        "張三",
        "S001",
        "zhang@example.com",
        "2012-01-01",
        "0912345678",
        "一年級A班",
      ],
      [
        "李四",
        "S002",
        "li@example.com",
        "2012-02-15",
        "0923456789",
        "一年級A班",
      ],
      ["王五", "S003", "", "2012-03-20", "", "一年級B班"],
    ];

    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "學生名單");

    ws["!cols"] = [
      { wch: 15 }, // 姓名
      { wch: 10 }, // 學號
      { wch: 25 }, // Email
      { wch: 12 }, // 生日
      { wch: 15 }, // 電話
      { wch: 15 }, // 班級
    ];

    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, "學生匯入範本.xlsx");

    toast.success("範本下載成功");
  };

  // 解析檔案
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = file.name.split(".").pop()?.toLowerCase();

    if (fileType === "csv") {
      Papa.parse(file, {
        complete: (results) => {
          processData(results.data as string[][]);
        },
        encoding: "UTF-8",
        skipEmptyLines: true,
      });
    } else if (fileType === "xlsx" || fileType === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
        }) as string[][];
        processData(jsonData);
      };
      reader.readAsArrayBuffer(file);
    } else {
      toast.error("不支援的檔案格式，請上傳 CSV 或 Excel 檔案");
    }
  };

  // 處理資料
  const processData = (data: string[][]) => {
    if (data.length < 2) {
      toast.error("檔案中沒有資料");
      return;
    }

    // 解析標題列（支援中文和英文）
    const headers = data[0].map((h) => h?.toLowerCase().trim() || "");

    // 尋找欄位索引
    const nameIndex = headers.findIndex(
      (h) => h.includes("姓名") || h.includes("name") || h.includes("學生"),
    );
    const studentNumberIndex = headers.findIndex(
      (h) =>
        h.includes("學號") || h.includes("student") || h.includes("number"),
    );
    const emailIndex = headers.findIndex(
      (h) => h.includes("email") || h.includes("信箱"),
    );
    const classIndex = headers.findIndex(
      (h) =>
        h.includes("班級") || h.includes("class") || h.includes("classroom"),
    );
    const birthIndex = headers.findIndex(
      (h) => h.includes("生日") || h.includes("birth") || h.includes("date"),
    );
    const phoneIndex = headers.findIndex(
      (h) => h.includes("電話") || h.includes("phone") || h.includes("tel"),
    );

    if (nameIndex === -1) {
      toast.error("找不到「姓名」欄位");
      return;
    }

    const students: ImportStudent[] = [];
    const importErrors: string[] = [];

    // 處理每一列資料（跳過標題列）
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const name = String(row[nameIndex] || "").trim();
      const student_number =
        studentNumberIndex !== -1
          ? String(row[studentNumberIndex] || "").trim()
          : undefined;
      const email =
        emailIndex !== -1 ? String(row[emailIndex] || "").trim() : undefined;
      const classroom_name =
        classIndex !== -1 ? String(row[classIndex] || "").trim() : undefined;
      const birthdate =
        birthIndex !== -1 ? String(row[birthIndex] || "").trim() : "";
      const phone =
        phoneIndex !== -1 ? String(row[phoneIndex] || "").trim() : undefined;

      if (!name) continue;

      const studentErrors: string[] = [];

      // 驗證姓名
      if (name.length < 2) {
        studentErrors.push("姓名長度至少需要 2 個字元");
      }

      // 驗證生日格式
      let formattedBirthdate = "";
      if (birthdate) {
        const cleanDate = birthdate.trim();

        // 1. 檢查 YYYYMMDD 格式 (20120101)
        if (/^\d{8}$/.test(cleanDate)) {
          const year = cleanDate.slice(0, 4);
          const month = cleanDate.slice(4, 6);
          const day = cleanDate.slice(6, 8);
          formattedBirthdate = `${year}-${month}-${day}`;
        }
        // 2. 檢查 YYYY-MM-DD 格式 (2012-01-01)
        else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleanDate)) {
          const parts = cleanDate.split("-");
          const year = parts[0];
          const month = parts[1].padStart(2, "0");
          const day = parts[2].padStart(2, "0");
          formattedBirthdate = `${year}-${month}-${day}`;
        }
        // 3. 檢查 YYYY/MM/DD 格式 (2012/01/01)
        else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(cleanDate)) {
          const parts = cleanDate.split("/");
          const year = parts[0];
          const month = parts[1].padStart(2, "0");
          const day = parts[2].padStart(2, "0");
          formattedBirthdate = `${year}-${month}-${day}`;
        }
        // 4. 檢查是否為 Excel 序列號格式（數字）
        else {
          const numericDate = Number(cleanDate);
          if (
            !isNaN(numericDate) &&
            numericDate > 25569 &&
            numericDate < 50000
          ) {
            const excelDate = new Date((numericDate - 25569) * 86400 * 1000);
            const year = excelDate.getFullYear();
            const month = String(excelDate.getMonth() + 1).padStart(2, "0");
            const day = String(excelDate.getDate()).padStart(2, "0");
            formattedBirthdate = `${year}-${month}-${day}`;
          } else {
            studentErrors.push(`無效的日期格式：${birthdate}`);
          }
        }

        // 驗證日期是否合理
        if (formattedBirthdate) {
          const date = new Date(formattedBirthdate);
          const year = parseInt(formattedBirthdate.slice(0, 4));
          if (isNaN(date.getTime()) || year < 2000 || year > 2020) {
            studentErrors.push("日期不合理（應在 2000-2020 年之間）");
            formattedBirthdate = "";
          }
        }
      }

      // 驗證 Email
      if (email && email.length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          studentErrors.push(`無效的 Email 格式：${email}`);
        }
      }

      // 驗證並轉換班級名稱為 ID
      let classroom_id: number | undefined = undefined;
      if (classroom_name) {
        const classroom = classrooms.find((c) => c.name === classroom_name);
        if (!classroom) {
          studentErrors.push(`找不到班級：${classroom_name}`);
        } else {
          classroom_id = classroom.id;
        }
      }

      students.push({
        name,
        email: email || undefined,
        student_number: student_number || undefined,
        birthdate: formattedBirthdate || undefined,
        phone: phone || undefined,
        classroom_id,
        classroom_name,
        isValid: studentErrors.length === 0,
        errors: studentErrors,
      });
    }

    if (students.length === 0) {
      toast.error("沒有有效的學生資料");
      return;
    }

    setPreview(students);
    setErrors(importErrors);
  };

  // 執行匯入
  const handleImport = async () => {
    const validStudents = preview.filter((s) => s.isValid);

    if (validStudents.length === 0) {
      toast.error("沒有有效的學生資料可以匯入");
      return;
    }

    setImporting(true);

    try {
      // 確保空字串被轉換為 undefined，避免 422 錯誤
      const response = (await apiClient.batchImportStudentsForSchool(
        schoolId,
        validStudents.map((student) => {
          const item: {
            name: string;
            email?: string;
            student_number?: string;
            birthdate?: string;
            phone?: string;
            classroom_id?: number;
          } = {
            name: student.name,
          };

          if (student.birthdate) {
            item.birthdate = student.birthdate;
          }

          // 只添加非空欄位
          if (student.email && student.email.trim()) {
            item.email = student.email.trim();
          }
          if (student.student_number && student.student_number.trim()) {
            item.student_number = student.student_number.trim();
          }
          if (student.phone && student.phone.trim()) {
            item.phone = student.phone.trim();
          }
          if (student.classroom_id) {
            item.classroom_id = student.classroom_id;
          }

          return item;
        }),
        duplicateAction,
      )) as {
        created?: number;
        updated?: number;
        skipped?: number;
        errors?: string[];
      };

      setCreatedCount(response.created || 0);
      setUpdatedCount(response.updated || 0);
      setSkippedCount(response.skipped || 0);
      setImportErrors(response.errors || []);

      // 顯示錯誤
      if (response.errors && response.errors.length > 0) {
        toast.error(`部分資料匯入失敗：${response.errors.join("; ")}`);
      }

      if (response.created || response.updated) {
        toast.success(
          `匯入完成！新增 ${response.created || 0} 筆，更新 ${response.updated || 0} 筆`,
        );
        onSuccess();
      }
    } catch (error: unknown) {
      logError("Failed to import students", error, { schoolId });
      const errorMessage =
        error instanceof Error ? error.message : "匯入失敗，請稍後再試";
      toast.error(errorMessage);
    } finally {
      setImporting(false);
    }
  };

  // 關閉對話框
  const handleClose = () => {
    setPreview([]);
    setErrors([]);
    setCreatedCount(0);
    setUpdatedCount(0);
    setSkippedCount(0);
    setImportErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            批量匯入學生
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 步驟說明 */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">操作步驟</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>下載範本檔案並填入學生資料</li>
              <li>上傳填好的 CSV 或 Excel 檔案</li>
              <li>檢查預覽資料是否正確</li>
              <li>選擇重複資料處理方式後執行匯入</li>
            </ol>
          </div>

          {/* 重複處理選項 */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">重複資料處理方式</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="duplicateAction"
                  value="skip"
                  checked={duplicateAction === "skip"}
                  onChange={(e) => setDuplicateAction(e.target.value as "skip")}
                  className="text-blue-600"
                />
                <span>跳過（不處理重複資料）</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="duplicateAction"
                  value="update"
                  checked={duplicateAction === "update"}
                  onChange={(e) =>
                    setDuplicateAction(e.target.value as "update")
                  }
                  className="text-blue-600"
                />
                <span>更新（更新已存在的學生資料）</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="duplicateAction"
                  value="add_suffix"
                  checked={duplicateAction === "add_suffix"}
                  onChange={(e) =>
                    setDuplicateAction(e.target.value as "add_suffix")
                  }
                  className="text-blue-600"
                />
                <span>加後綴（為重複的學號加上數字後綴）</span>
              </label>
            </div>
          </div>

          {/* 操作按鈕 */}
          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={downloadTemplate}
              className="flex-1"
            >
              <Download className="h-4 w-4 mr-2" />
              下載範本
            </Button>

            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1"
              disabled={importing}
            >
              <Upload className="h-4 w-4 mr-2" />
              選擇檔案
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* 錯誤訊息 */}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* 預覽資料 */}
          {preview.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium">預覽資料</h3>
                <div className="text-sm text-gray-600">
                  有效: {preview.filter((s) => s.isValid).length} / 總數:{" "}
                  {preview.length}
                </div>
              </div>

              <div className="border rounded-lg max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">狀態</th>
                      <th className="px-4 py-2 text-left">姓名</th>
                      <th className="px-4 py-2 text-left">學號</th>
                      <th className="px-4 py-2 text-left">Email</th>
                      <th className="px-4 py-2 text-left">生日</th>
                      <th className="px-4 py-2 text-left">電話</th>
                      <th className="px-4 py-2 text-left">班級</th>
                      <th className="px-4 py-2 text-left">錯誤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((student, index) => (
                      <tr
                        key={index}
                        className={student.isValid ? "" : "bg-red-50"}
                      >
                        <td className="px-4 py-2">
                          {student.isValid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <X className="h-4 w-4 text-red-500" />
                          )}
                        </td>
                        <td className="px-4 py-2">{student.name}</td>
                        <td className="px-4 py-2">
                          {student.student_number || "-"}
                        </td>
                        <td className="px-4 py-2">{student.email || "-"}</td>
                        <td className="px-4 py-2">
                          {student.birthdate || "-"}
                        </td>
                        <td className="px-4 py-2">{student.phone || "-"}</td>
                        <td className="px-4 py-2">
                          {student.classroom_name || "-"}
                        </td>
                        <td className="px-4 py-2 text-red-600 text-xs">
                          {student.errors.join(", ") || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 匯入結果 */}
          {(createdCount > 0 || updatedCount > 0 || skippedCount > 0) && (
            <Alert
              className={
                createdCount > 0 || updatedCount > 0
                  ? "border-green-200 bg-green-50"
                  : "border-yellow-200 bg-yellow-50"
              }
            >
              {createdCount > 0 || updatedCount > 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              )}
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold text-lg">匯入結果</p>
                  <div className="flex gap-4">
                    {createdCount > 0 && (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span>新增: {createdCount} 筆</span>
                      </div>
                    )}
                    {updatedCount > 0 && (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-600" />
                        <span>更新: {updatedCount} 筆</span>
                      </div>
                    )}
                    {skippedCount > 0 && (
                      <div className="flex items-center gap-2">
                        <X className="h-4 w-4 text-yellow-600" />
                        <span>跳過: {skippedCount} 筆</span>
                      </div>
                    )}
                  </div>
                  {importErrors.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-red-600">
                        錯誤訊息：
                      </p>
                      <ul className="list-disc list-inside text-sm text-red-600">
                        {importErrors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* 操作按鈕 */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={importing}
            >
              取消
            </Button>
            {createdCount > 0 || updatedCount > 0 || skippedCount > 0 ? (
              <Button onClick={handleClose} variant="default">
                完成
              </Button>
            ) : (
              <Button
                onClick={handleImport}
                disabled={
                  preview.filter((s) => s.isValid).length === 0 || importing
                }
              >
                {importing
                  ? "匯入中..."
                  : `匯入 ${preview.filter((s) => s.isValid).length} 筆資料`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
