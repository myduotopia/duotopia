import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { toast } from "sonner";
import {
  ChevronLeft,
  BookOpen,
  Clock,
  Calendar,
  Target,
  Play,
  CheckCircle,
  AlertCircle,
  BarChart3,
  Headphones,
  Mic,
} from "lucide-react";
import { getContentTypeIcon } from "@/lib/contentTypeIcon";
import {
  StudentAssignment,
  StudentContentProgress,
  AssignmentStatusEnum,
  AssignmentData,
} from "@/types";
import { useTranslation } from "react-i18next";

export default function StudentAssignmentDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useStudentAuthStore();

  const [assignment, setAssignment] = useState<StudentAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [practiceMode, setPracticeMode] = useState<string | null>(null);

  useEffect(() => {
    if (id && token) {
      loadAssignmentDetail();
    }
  }, [id, token]);

  const loadAssignmentDetail = async () => {
    try {
      setLoading(true);
      const apiUrl = import.meta.env.VITE_API_URL || "";

      // 1. Get all assignments to find the specific one
      const assignmentsResponse = await fetch(
        `${apiUrl}/api/students/assignments`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!assignmentsResponse.ok) {
        throw new Error(`HTTP error! status: ${assignmentsResponse.status}`);
      }

      const assignments = await assignmentsResponse.json();
      const foundAssignment = assignments.find(
        (a: AssignmentData) => a.id === parseInt(id!),
      );

      if (!foundAssignment) {
        throw new Error("Assignment not found");
      }

      // 2. Get activities for this assignment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let contentProgress: any[] = [];
      let completedCount = 0;
      let totalCount = 0;

      try {
        const activitiesResponse = await fetch(
          `${apiUrl}/api/students/assignments/${id}/activities`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (activitiesResponse.ok) {
          const data = await activitiesResponse.json();

          // 設置 practice_mode（例句重組模式）
          if (data.practice_mode) {
            setPracticeMode(data.practice_mode);
          }

          // Get activities from the response (may be wrapped in an object)
          const activities = data.activities || data;

          // Transform activities to content progress format
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contentProgress = activities.map((activity: any, index: number) => {
            // Count items within this activity
            const items = activity.items || [];
            totalCount += items.length;

            // Count completed items
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            items.forEach((item: any) => {
              if (item.recording_url || item.answer || item.teacher_feedback) {
                completedCount++;
              }
            });

            return {
              id: activity.progress_id || activity.id,
              student_assignment_id: foundAssignment.id,
              content_id: activity.content_id || activity.id,
              content: {
                id: activity.content_id || activity.id,
                title: activity.title || `活動 ${index + 1}`,
                type: activity.type || "grouped_questions",
                items: activity.items || [],
              },
              status: activity.status || "NOT_STARTED",
              score: activity.score,
              order_index:
                activity.order_index !== undefined
                  ? activity.order_index
                  : index,
              estimated_time:
                activity.estimated_time ||
                `5 ${t("studentActivityPage.stats.minutes")}`,
              items: activity.items || [],
              answers: activity.answers,
              recording_url: activity.recording_url,
              teacher_feedback: activity.teacher_feedback,
              teacher_passed: activity.teacher_passed,
            };
          });
        }
      } catch (error) {
        console.error("Failed to load activities:", error);
        // Continue without activities data
      }

      // 3. Create assignment detail object
      const assignmentDetail: StudentAssignment = {
        id: foundAssignment.id,
        assignment_id: foundAssignment.assignment_id,
        student_number: foundAssignment.student_id,
        classroom_id: foundAssignment.classroom_id,
        title: foundAssignment.title,
        status: foundAssignment.status || "NOT_STARTED",
        score: foundAssignment.score,
        feedback: foundAssignment.feedback,
        is_active: foundAssignment.is_active !== false,
        created_at: foundAssignment.assigned_at || foundAssignment.created_at,
        due_date: foundAssignment.due_date,
        submitted_at: foundAssignment.submitted_at,
        content_progress: contentProgress,
        progress_percentage:
          totalCount > 0 ? (completedCount / totalCount) * 100 : 0,
        completed_count: completedCount,
        content_count: totalCount,
      };

      setAssignment(assignmentDetail);
    } catch (error) {
      console.error("Failed to load assignment detail:", error);
      toast.error(t("studentAssignmentDetail.errors.loadFailed"));
      navigate("/student/assignments");
    } finally {
      setLoading(false);
    }
  };

  const getStatusDisplay = (status: AssignmentStatusEnum) => {
    switch (status) {
      case "NOT_STARTED":
      case "IN_PROGRESS":
        return {
          text: t("studentAssignmentDetail.status.inProgress"),
          color: "bg-blue-100 text-blue-800",
          icon: <Clock className="h-4 w-4" />,
        };
      case "SUBMITTED":
        return {
          text: t("studentAssignmentDetail.status.submitted"),
          color: "bg-yellow-100 text-yellow-800",
          icon: <CheckCircle className="h-4 w-4" />,
        };
      case "GRADED":
        return {
          text: t("studentAssignmentDetail.status.graded"),
          color: "bg-green-100 text-green-800",
          icon: <BarChart3 className="h-4 w-4" />,
        };
      case "RETURNED":
        return {
          text: t("studentAssignmentDetail.status.returned"),
          color: "bg-orange-100 text-orange-800",
          icon: <AlertCircle className="h-4 w-4" />,
        };
      case "RESUBMITTED":
        return {
          text: t("studentAssignmentDetail.status.resubmitted"),
          color: "bg-purple-100 text-purple-800",
          icon: <CheckCircle className="h-4 w-4" />,
        };
      default:
        return {
          text: status,
          color: "bg-gray-100 text-gray-800",
          icon: <BookOpen className="h-4 w-4" />,
        };
    }
  };

  const getContentTypeIconElement = (type?: string) => {
    switch (type) {
      case "reading_assessment":
        return <Mic className="h-4 w-4" />;
      case "listening":
        return <Headphones className="h-4 w-4" />;
      default: {
        const Icon = getContentTypeIcon(type);
        return <Icon className="h-4 w-4" />;
      }
    }
  };

  const formatDueDate = (dueDate?: string) => {
    if (!dueDate) return null;

    const due = new Date(dueDate);
    const now = new Date();
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        text: t("studentAssignmentDetail.dueDate.overdue", {
          days: Math.abs(diffDays),
        }),
        isOverdue: true,
      };
    } else if (diffDays === 0) {
      return {
        text: t("studentAssignmentDetail.dueDate.today"),
        isOverdue: false,
      };
    } else if (diffDays <= 3) {
      return {
        text: t("studentAssignmentDetail.dueDate.remaining", {
          days: diffDays,
        }),
        isOverdue: false,
      };
    } else {
      return { text: due.toLocaleDateString("zh-TW"), isOverdue: false };
    }
  };

  const handleStartActivity = () => {
    // 對於已提交的作業，直接導航到作業的活動頁面
    // 因為後端 API 使用的是 assignment ID，不是 progress ID
    navigate(`/student/assignment/${id}/activity`);
  };

  const handleStartAssignment = () => {
    navigate(`/student/assignment/${id}/activity`);
  };

  const renderContentProgress = (progress: StudentContentProgress) => {
    const statusDisplay = getStatusDisplay(progress.status);
    const contentTypeIcon = getContentTypeIconElement(progress.content?.type);

    // 檢查題目的評分狀態
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (progress as any).items || [];
    let passedCount = 0;
    let failedCount = 0;
    let ungradedCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items.forEach((item: any) => {
      if (
        item.teacher_feedback !== undefined &&
        item.teacher_feedback !== null
      ) {
        if (item.teacher_passed === true) {
          passedCount++;
        } else if (item.teacher_passed === false) {
          failedCount++;
        } else {
          ungradedCount++;
        }
      } else {
        ungradedCount++;
      }
    });

    return (
      <Card key={progress.id} className="hover:shadow-sm transition-shadow">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <div className="p-1.5 sm:p-2 bg-blue-50 rounded-lg flex-shrink-0">
                {contentTypeIcon}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm sm:text-base truncate">
                  {progress.content?.title ||
                    t("studentAssignmentDetail.progress.activityNumber", {
                      number: progress.order_index + 1,
                    })}
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 whitespace-nowrap">
                  {progress.content?.type === "reading_assessment" &&
                    t(
                      "studentAssignmentDetail.contentTypes.reading_assessment",
                    )}
                  {progress.content?.type === "listening" &&
                    t("studentAssignmentDetail.contentTypes.listening")}
                  {progress.content?.type === "grouped_questions" &&
                    t("studentAssignmentDetail.contentTypes.grouped_questions")}
                  {progress.estimated_time && ` • ${progress.estimated_time}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* 顯示題目評分狀態 */}
              {items.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  {passedCount > 0 && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      {passedCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      {failedCount}
                    </span>
                  )}
                  {ungradedCount > 0 && (
                    <span className="flex items-center gap-1 text-gray-500">
                      <Clock className="h-4 w-4" />
                      {ungradedCount}
                    </span>
                  )}
                </div>
              )}

              <Badge className={statusDisplay.color}>
                {statusDisplay.icon}
                <span className="ml-1">{statusDisplay.text}</span>
              </Badge>

              {progress.score !== undefined && progress.status === "GRADED" && (
                <div className="text-sm font-medium text-green-600">
                  {progress.score.toFixed(1)}
                  {t("studentAssignmentDetail.scoring.scoreUnit")}
                </div>
              )}

              <Button
                size="sm"
                onClick={handleStartActivity}
                disabled={false} // 允許查看已提交的作業
                variant={
                  progress.status === "NOT_STARTED" ? "default" : "outline"
                }
                className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap"
              >
                {progress.status === "NOT_STARTED" &&
                  t("studentAssignmentDetail.buttons.start")}
                {progress.status === "IN_PROGRESS" &&
                  t("studentAssignmentDetail.buttons.continue")}
                {(progress.status === "SUBMITTED" ||
                  progress.status === "GRADED") &&
                  t("studentAssignmentDetail.buttons.view")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">
            {t("studentAssignmentDetail.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600 mb-4">
            {t("studentAssignmentDetail.errors.notFound")}
          </p>
          <Button onClick={() => navigate("/student/assignments")}>
            {t("studentAssignmentDetail.buttons.back")}
          </Button>
        </div>
      </div>
    );
  }

  const statusDisplay = getStatusDisplay(assignment.status);
  const dueDateInfo = formatDueDate(assignment.due_date);
  // Issue #460: Allow GRADED word_selection to start practice
  const isGradedWordSelection =
    assignment.status === "GRADED" && practiceMode === "word_selection";
  const canStart =
    assignment.status === "NOT_STARTED" ||
    assignment.status === "IN_PROGRESS" ||
    assignment.status === "RETURNED" ||
    isGradedWordSelection;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <Button
          variant="ghost"
          onClick={() => navigate("/student/assignments")}
          className="mb-6"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          {t("studentAssignmentDetail.buttons.back")}
        </Button>

        {/* Assignment Overview */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg sm:text-xl lg:text-2xl mb-2 break-words">
                  {assignment.title}
                </CardTitle>
                {assignment.estimated_time && (
                  <div className="flex items-center gap-1 text-sm text-gray-600 mb-4">
                    <Clock className="h-4 w-4" />
                    <span>
                      {t("studentAssignmentDetail.overview.estimatedTime", {
                        time: assignment.estimated_time,
                      })}
                    </span>
                  </div>
                )}
              </div>
              <Badge className={statusDisplay.color}>
                {statusDisplay.icon}
                <span className="ml-2">{statusDisplay.text}</span>
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Due Date */}
            {dueDateInfo && (
              <div
                className={`flex items-center gap-2 text-sm ${
                  dueDateInfo.isOverdue ? "text-red-600" : "text-gray-600"
                }`}
              >
                <Calendar className="h-4 w-4" />
                <span>{dueDateInfo.text}</span>
              </div>
            )}

            {/* Assignment Targets */}
            {(assignment.contents?.[0]?.target_wpm ||
              assignment.contents?.[0]?.target_accuracy) && (
              <div className="flex gap-6">
                {assignment.contents[0].target_wpm && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock className="h-4 w-4" />
                    <span>
                      {t("studentAssignmentDetail.overview.targetWPM", {
                        wpm: assignment.contents[0].target_wpm,
                      })}
                    </span>
                  </div>
                )}
                {assignment.contents[0].target_accuracy && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Target className="h-4 w-4" />
                    <span>
                      {t("studentAssignmentDetail.overview.targetAccuracy", {
                        accuracy: assignment.contents[0].target_accuracy,
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 活動進度 - 例句重組模式不顯示 */}
            {practiceMode !== "rearrangement" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {t("studentAssignmentDetail.progress.title")}
                  </h3>
                  <span className="text-sm font-medium text-gray-600">
                    {t("studentAssignmentDetail.progress.completed", {
                      completed: assignment.completed_count || 0,
                      total: assignment.content_count || 0,
                    })}
                  </span>
                </div>
                <Progress
                  value={assignment.progress_percentage || 0}
                  className="h-2"
                />
                <div className="space-y-2">
                  {assignment.content_progress &&
                  assignment.content_progress.length > 0 ? (
                    assignment.content_progress
                      .sort((a, b) => a.order_index - b.order_index)
                      .map(renderContentProgress)
                  ) : (
                    <div className="text-center py-4 text-gray-500">
                      <BookOpen className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">
                        {t("studentAssignmentDetail.progress.empty")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick Start Button */}
            {canStart && (
              <div className="pt-4 border-t">
                <Button
                  onClick={handleStartAssignment}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {isGradedWordSelection
                    ? t("studentAssignmentDetail.buttons.practice") ||
                      "Practice"
                    : assignment.status === "NOT_STARTED"
                      ? t("studentAssignmentDetail.buttons.startAssignment")
                      : assignment.status === "IN_PROGRESS"
                        ? t(
                            "studentAssignmentDetail.buttons.continueAssignment",
                          )
                        : t("studentAssignmentDetail.buttons.resubmit")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Total Score Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t("studentAssignmentDetail.scoring.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 分數顯示 */}
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-2">
                  {t("studentAssignmentDetail.scoring.score")}
                </div>
                <div className="text-2xl sm:text-3xl lg:text-4xl font-bold text-blue-600">
                  {assignment.score !== undefined ? assignment.score : "--"}
                </div>
              </div>

              {/* 詳實記錄 */}
              <div>
                <div className="text-sm text-gray-600 mb-2">
                  {t("studentAssignmentDetail.scoring.detailRecord")}
                </div>
                {assignment.content_progress &&
                assignment.content_progress.length > 0 ? (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {assignment.content_progress.map((progress: any) => {
                      const items = progress.items || [];
                      let questionNumber = 0;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      return items.map((item: any, idx: number) => {
                        const hasFeedback =
                          item.teacher_feedback !== undefined &&
                          item.teacher_feedback !== null;
                        if (!hasFeedback) return null;
                        questionNumber++;

                        return (
                          <div
                            key={`${progress.id}-${idx}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            <span className="flex-shrink-0">
                              {item.teacher_passed ? "✅" : "❌"}
                            </span>
                            <div className="flex-1">
                              <div className="text-xs text-gray-500 truncate">
                                {item.text ||
                                  t(
                                    "studentAssignmentDetail.scoring.questionNumber",
                                    { number: questionNumber },
                                  )}
                              </div>
                              <div className="text-xs text-gray-700">
                                {item.teacher_feedback}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">
                    {t("studentAssignmentDetail.scoring.noRecordsYet")}
                  </div>
                )}
              </div>

              {/* 總評 */}
              <div>
                <div className="text-sm text-gray-600 mb-2">
                  {t("studentAssignmentDetail.scoring.overallFeedback")}
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-700">
                    {assignment.feedback ||
                      t("studentAssignmentDetail.scoring.noFeedbackYet")}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
