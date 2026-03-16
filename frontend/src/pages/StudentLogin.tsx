import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ArrowLeft, ChevronRight, Home, Mail, Eye, EyeOff } from "lucide-react";
import { useStudentAuthStore, StudentUser } from "@/stores/studentAuthStore";
import { authService } from "@/services/authService";
import { teacherService } from "@/services/teacherService";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface TeacherHistory {
  email: string;
  name: string;
  lastUsed: Date;
}

interface Classroom {
  id: number;
  name: string;
  studentCount: number;
}

interface Student {
  id: number;
  name: string;
  email: string;
  avatar?: string;
}

export default function StudentLogin() {
  const navigate = useNavigate();
  const { login } = useStudentAuthStore();
  const { t } = useTranslation();

  // 檢查是否為 demo 模式 (通過 URL 參數 ?is_demo=true)
  const searchParams = new URLSearchParams(window.location.search);
  const isDemoMode = searchParams.get("is_demo") === "true";
  const urlTeacherEmail = searchParams.get("teacher_email");

  // 檢查環境
  const isProduction = import.meta.env.VITE_ENVIRONMENT === "production";
  const showDemoBlocks = !isProduction || isDemoMode;

  // Login mode: "teacher" (original 4-step) or "email" (direct email login)
  const [loginMode, setLoginMode] = useState<"teacher" | "email">("teacher");

  // Multi-step form state
  const [step, setStep] = useState(1);
  const [teacherEmail, setTeacherEmail] = useState("");
  const [, setSelectedTeacher] = useState<TeacherHistory | null>(null);
  const [teacherHistory, setTeacherHistory] = useState<TeacherHistory[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(
    null,
  );
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasAutoSubmitted = useRef(false);

  // Password visibility state
  const [showEmailPassword, setShowEmailPassword] = useState(false);
  const [showStepPassword, setShowStepPassword] = useState(false);

  // Email direct login state
  const [emailLoginEmail, setEmailLoginEmail] = useState("");
  const [emailLoginPassword, setEmailLoginPassword] = useState("");

  // Load teacher history from localStorage
  useEffect(() => {
    const history = localStorage.getItem("teacherHistory");
    if (history) {
      setTeacherHistory(JSON.parse(history));
    }
  }, []);

  // Step 1: Teacher selection
  const handleTeacherSubmit = useCallback(
    async (emailToValidate?: string) => {
      const email = emailToValidate || teacherEmail;
      if (!email) return;

      setLoading(true);
      setError("");
      try {
        // Validate teacher email exists
        const response = await teacherService.validateTeacher(email);
        if (response.valid) {
          const teacher = {
            email: email,
            name: response.name,
            lastUsed: new Date(),
          };

          // Save to history
          const updatedHistory = [
            teacher,
            ...teacherHistory.filter((t) => t.email !== email),
          ].slice(0, 5); // Keep last 5 teachers

          localStorage.setItem(
            "teacherHistory",
            JSON.stringify(updatedHistory),
          );
          setTeacherHistory(updatedHistory);
          setSelectedTeacher(teacher);

          // Load classrooms for this teacher
          const classroomsData =
            await teacherService.getPublicClassrooms(email);
          setClassrooms(classroomsData);
          setStep(2);
        } else {
          setError(t("studentLogin.errors.teacherNotFound"));
        }
      } catch {
        setError(t("studentLogin.errors.teacherValidationFailed"));
      } finally {
        setLoading(false);
      }
    },
    [teacherEmail, teacherHistory, t],
  );

  // Auto-validate teacher email from URL parameter
  useEffect(() => {
    if (urlTeacherEmail && !hasAutoSubmitted.current) {
      hasAutoSubmitted.current = true;
      setTeacherEmail(urlTeacherEmail);
      // Pass the URL email directly to avoid stale state issue
      handleTeacherSubmit(urlTeacherEmail);
    }
  }, [urlTeacherEmail, handleTeacherSubmit]);

  // Step 2: Classroom selection
  const handleClassroomSelect = async (classroom: Classroom) => {
    setLoading(true);
    setError("");
    try {
      setSelectedClassroom(classroom);
      // Load students for this classroom
      const studentsData = await teacherService.getClassroomStudents(
        classroom.id,
      );
      // Sort students by ID
      const sortedStudents = [...studentsData].sort((a, b) => a.id - b.id);
      setStudents(sortedStudents);
      setStep(3);
    } catch {
      setError(t("studentLogin.errors.loadClassroomFailed"));
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Student selection
  const handleStudentSelect = (student: Student) => {
    setSelectedStudent(student);
    setStep(4);
  };

  // Step 4: Password submission
  const handleLogin = async () => {
    if (!selectedStudent) return;

    setLoading(true);
    setError("");
    try {
      const response = await authService.studentLogin({
        id: selectedStudent.id,
        password: password,
      });

      if (response.access_token) {
        login(response.access_token, {
          ...response.user,
          student_number:
            response.user.student_number || response.user.id.toString(),
          classroom_id: selectedClassroom?.id ?? undefined,
          classroom_name: selectedClassroom?.name,
          teacher_name: teacherHistory.find((t) => t.email === teacherEmail)
            ?.name,
        } as StudentUser);
        navigate("/student/dashboard");
      }
    } catch (err) {
      console.error("Student login failed:", err);
      setError(t("studentLogin.errors.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  // Email direct login
  const handleEmailLogin = async () => {
    if (!emailLoginEmail || !emailLoginPassword) return;

    setLoading(true);
    setError("");
    try {
      const response = await authService.studentEmailLogin(
        emailLoginEmail,
        emailLoginPassword,
      );

      const s = response.student;
      login(response.access_token, {
        id: s.id,
        name: s.name,
        email: s.email,
        student_number: s.student_number || "",
        classroom_id: s.classroom_id ?? undefined,
        classroom_name: s.classroom_name || undefined,
        teacher_name: s.classrooms?.[0]?.teacher_name || undefined,
        school_id: s.school_id || undefined,
        school_name: s.school_name || undefined,
        organization_id: s.organization_id || undefined,
        organization_name: s.organization_name || undefined,
        has_linked_accounts: s.has_linked_accounts,
        linked_accounts_count: s.linked_accounts_count,
        classrooms: s.classrooms,
        classrooms_count: s.classrooms_count,
      } as StudentUser);
      navigate("/student/dashboard");
    } catch (err) {
      console.error("Email login failed:", err);
      setError(t("studentLogin.emailLogin.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setError("");
    if (loginMode === "email") {
      setLoginMode("teacher");
      setEmailLoginEmail("");
      setEmailLoginPassword("");
      return;
    }
    if (step > 1) {
      setStep(step - 1);
    }
  };

  // Avatar component
  const Avatar = ({
    name,
    size = "normal",
  }: {
    name: string;
    size?: "normal" | "small";
  }) => {
    const colors = [
      "bg-blue-500",
      "bg-green-500",
      "bg-purple-500",
      "bg-pink-500",
      "bg-yellow-500",
    ];
    const colorIndex = name.charCodeAt(0) % colors.length;
    const sizeClasses =
      size === "small" ? "w-12 h-12 text-lg" : "w-20 h-20 text-2xl";

    return (
      <div
        className={`${sizeClasses} ${colors[colorIndex]} rounded-full flex items-center justify-center text-white font-bold`}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-4">
      {/* Home link */}
      <div className="absolute top-4 left-4">
        <Link to="/">
          <Button
            variant="ghost"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <Home className="h-4 w-4" />
            <span>{t("studentLogin.header.home")}</span>
          </Button>
        </Link>
      </div>

      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-blue-600 flex items-center justify-center gap-2">
          <span className="text-4xl">🚀</span>
          {t("studentLogin.header.welcome")}
        </h1>
      </div>

      <Card className="w-full max-w-2xl">
        <CardHeader>
          {(step > 1 || loginMode === "email") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="mb-2 w-fit"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("studentLogin.buttons.back")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {/* Email Direct Login Mode */}
          {loginMode === "email" && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-center">
                {t("studentLogin.emailLogin.title")}
              </h2>
              <p className="text-sm text-gray-500 text-center">
                {t("studentLogin.emailLogin.description")}
              </p>

              <div className="space-y-4">
                <Input
                  type="email"
                  placeholder={t("studentLogin.emailLogin.emailPlaceholder")}
                  value={emailLoginEmail}
                  onChange={(e) => setEmailLoginEmail(e.target.value)}
                  className="text-lg py-6"
                />
                <div className="relative">
                  <Input
                    type={showEmailPassword ? "text" : "password"}
                    placeholder={t(
                      "studentLogin.emailLogin.passwordPlaceholder",
                    )}
                    value={emailLoginPassword}
                    onChange={(e) => setEmailLoginPassword(e.target.value)}
                    className="text-lg py-6 pr-10"
                    onKeyDown={(e) => e.key === "Enter" && handleEmailLogin()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmailPassword(!showEmailPassword)}
                    aria-label={showEmailPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showEmailPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                <Button
                  onClick={handleEmailLogin}
                  disabled={!emailLoginEmail || !emailLoginPassword || loading}
                  className="w-full py-6 text-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                >
                  {loading ? (
                    <>
                      <span className="animate-spin mr-2">⏳</span>
                      {t("studentLogin.emailLogin.loggingIn")}
                    </>
                  ) : (
                    t("studentLogin.emailLogin.login")
                  )}
                </Button>
              </div>

              {error && (
                <p className="text-red-500 text-center mt-4">{error}</p>
              )}
            </div>
          )}

          {/* Step 1: Teacher Email */}
          {loginMode === "teacher" && step === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-center">
                {t("studentLogin.step1.title")}
              </h2>

              <div className="space-y-4">
                <Input
                  type="email"
                  placeholder={t("studentLogin.step1.placeholder")}
                  value={teacherEmail}
                  onChange={(e) => setTeacherEmail(e.target.value)}
                  className="text-lg py-6"
                  onKeyDown={(e) => e.key === "Enter" && handleTeacherSubmit()}
                />

                <Button
                  onClick={() => handleTeacherSubmit()}
                  disabled={!teacherEmail || loading}
                  className="w-full py-6 text-lg bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
                >
                  {loading ? (
                    <>
                      <span className="animate-spin mr-2">⏳</span>
                      {t("studentLogin.step1.validating")}
                    </>
                  ) : (
                    t("studentLogin.step1.next")
                  )}
                </Button>
              </div>

              {error && (
                <p className="text-red-500 text-center mt-4">{error}</p>
              )}

              {/* Demo 教師快捷鍵 - 只在非 production 或有 ?is_demo=true 時顯示 */}
              {showDemoBlocks && (
                <div className="mt-6 pt-6 border-t">
                  <p className="text-sm text-gray-600 mb-3">
                    {t("studentLogin.step1.quickTest")}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full py-4 bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 border-purple-200"
                    onClick={() => {
                      setTeacherEmail("demo@duotopia.com");
                    }}
                  >
                    <span className="text-purple-600 font-medium">
                      {t("studentLogin.step1.demoTeacher")}
                    </span>
                  </Button>
                </div>
              )}

              {teacherHistory.length > 0 && (
                <div className="space-y-3 mt-6">
                  <p className="text-sm text-gray-600">
                    {t("studentLogin.step1.recentTeachers")}
                  </p>
                  <div className="space-y-2">
                    {teacherHistory
                      .filter((t) => t.email !== "demo@duotopia.com")
                      .map((teacher) => (
                        <Button
                          key={teacher.email}
                          variant="outline"
                          className="w-full justify-start py-4"
                          onClick={() => {
                            setTeacherEmail(teacher.email);
                            handleTeacherSubmit(teacher.email);
                          }}
                        >
                          {teacher.email}
                        </Button>
                      ))}
                  </div>
                </div>
              )}

              {/* Email direct login link */}
              <div className="mt-6 pt-6 border-t text-center">
                <Button
                  variant="link"
                  className="text-emerald-600 hover:text-emerald-700"
                  onClick={() => {
                    setLoginMode("email");
                    setError("");
                  }}
                >
                  <Mail className="h-4 w-4 mr-1.5" />
                  {t("studentLogin.emailLogin.switchToEmail")}
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Classroom Selection */}
          {loginMode === "teacher" && step === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-center">
                {t("studentLogin.step2.title")}
              </h2>

              <div className="space-y-3">
                {classrooms.map((classroom) => (
                  <Button
                    key={classroom.id}
                    variant="outline"
                    className="w-full justify-between py-6 text-left"
                    onClick={() => handleClassroomSelect(classroom)}
                  >
                    <span className="text-lg font-medium">
                      {classroom.name}
                    </span>
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                ))}
              </div>

              {error && <p className="text-red-500 text-center">{error}</p>}
            </div>
          )}

          {/* Step 3: Student Selection */}
          {loginMode === "teacher" && step === 3 && selectedClassroom && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold">
                  {selectedClassroom.name}
                </h2>
                <p className="text-gray-600 mt-1">
                  {t("studentLogin.step3.title")}
                </p>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                {students.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => handleStudentSelect(student)}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Avatar name={student.name} />
                    <span className="text-sm font-medium">{student.name}</span>
                  </button>
                ))}
              </div>

              {error && <p className="text-red-500 text-center">{error}</p>}
            </div>
          )}

          {/* Step 4: Password */}
          {loginMode === "teacher" && step === 4 && selectedStudent && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-semibold">
                  {t("studentLogin.step4.greeting", {
                    name: selectedStudent.name,
                  })}
                </h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type={showStepPassword ? "text" : "password"}
                      placeholder={t("studentLogin.step4.placeholder")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="text-lg py-6 pr-10"
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowStepPassword(!showStepPassword)}
                      aria-label={showStepPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showStepPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {/* Password hint - always visible */}
                  <div className="text-sm text-gray-600 space-y-1 px-1">
                    <p>💡 {t("studentLogin.step4.passwordHint")}</p>
                    <p>📧 {t("studentLogin.step4.verifiedEmailHint")}</p>
                    <p>🔑 {t("studentLogin.step4.forgotPassword")}</p>
                  </div>
                </div>

                <Button
                  onClick={handleLogin}
                  disabled={!password || loading}
                  className="w-full py-6 text-lg bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
                >
                  {t("studentLogin.step4.login")}
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSelectedStudent(null);
                    setPassword("");
                    setError("");
                    setStep(3);
                  }}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t("studentLogin.step4.selectOther")}
                </Button>
              </div>

              {error && <p className="text-red-500 text-center">{error}</p>}

              {/* 測試提示 - 只在非 production 或有 ?is_demo=true 時顯示 */}
              {showDemoBlocks && (
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800 font-medium mb-1">
                    {t("studentLogin.step4.demoHint")}
                  </p>
                  <p className="text-xs text-yellow-700">
                    {t("studentLogin.step4.demoPassword")}
                    <span className="font-mono font-bold">20120101</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-2">
                    {t("studentLogin.step4.passwordFormat")}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
