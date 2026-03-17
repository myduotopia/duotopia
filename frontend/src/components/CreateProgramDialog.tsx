import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Copy,
  Plus,
  Search,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  School,
  Building2,
  AlertTriangle,
} from "lucide-react";
import {
  TagInputWithSuggestions,
  TagSuggestion,
} from "@/components/ui/tag-input";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface Program {
  id: number;
  name: string;
  description?: string;
  is_template?: boolean;
  classroom_id?: number;
  classroom_name?: string;
  level?: string;
  estimated_hours?: number;
  lesson_count?: number;
  tags?: string[];
  is_duplicate?: boolean;
}

interface CreateProgramDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  classroomId: number;
  classroomName: string;
}

export default function CreateProgramDialog({
  open,
  onClose,
  onSuccess,
  classroomId,
  classroomName,
}: CreateProgramDialogProps) {
  const { t } = useTranslation();
  const { mode, selectedOrganization } = useWorkspace();
  const isOrganizationMode = mode === "organization" && selectedOrganization;

  const [activeTab, setActiveTab] = useState(
    isOrganizationMode ? "organization" : "template",
  );
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const isCreatingRef = useRef(false); // 🔒 同步追蹤處理狀態，防止雙擊

  // 機構教材 (僅組織模式)
  const [orgPrograms, setOrgPrograms] = useState<Program[]>([]);
  const [selectedOrgPrograms, setSelectedOrgPrograms] = useState<Program[]>([]);
  const [orgProgramName, setOrgProgramName] = useState("");

  // 個人教材 (原 "公版模板")
  const [templates, setTemplates] = useState<Program[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Program[]>([]);
  const [templateName, setTemplateName] = useState("");

  // 其他班級課程
  const [copyablePrograms, setCopyablePrograms] = useState<Program[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<Program[]>([]);
  const [copyName, setCopyName] = useState("");

  // 自建課程
  const [customForm, setCustomForm] = useState({
    name: "",
    description: "",
    level: "A1",
    tags: [] as string[],
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedClassrooms, setExpandedClassrooms] = useState<Set<number>>(
    new Set(),
  );

  // 預設的標籤建議
  const tagSuggestions: TagSuggestion[] = [
    // 程度相關
    { value: "beginner", label: t("tags.beginner"), category: "level" },
    { value: "intermediate", label: t("tags.intermediate"), category: "level" },
    { value: "advanced", label: t("tags.advanced"), category: "level" },

    // 技能相關
    { value: "speaking", label: t("tags.speaking"), category: "skill" },
    { value: "listening", label: t("tags.listening"), category: "skill" },
    { value: "reading", label: t("tags.reading"), category: "skill" },
    { value: "writing", label: t("tags.writing"), category: "skill" },
    { value: "grammar", label: t("tags.grammar"), category: "skill" },
    { value: "vocabulary", label: t("tags.vocabulary"), category: "skill" },
    {
      value: "pronunciation",
      label: t("tags.pronunciation"),
      category: "skill",
    },

    // 主題相關
    { value: "daily", label: t("tags.daily"), category: "topic" },
    { value: "business", label: t("tags.business"), category: "topic" },
    { value: "travel", label: t("tags.travel"), category: "topic" },
    { value: "academic", label: t("tags.academic"), category: "topic" },
    { value: "conversation", label: t("tags.conversation"), category: "topic" },
    { value: "exam", label: t("tags.exam"), category: "topic" },

    // 其他
    { value: "phonics", label: t("tags.phonics"), category: "other" },
    { value: "interactive", label: t("tags.interactive"), category: "other" },
    { value: "game-based", label: t("tags.gameBased"), category: "other" },
  ];

  useEffect(() => {
    if (open) {
      fetchData();
      resetForms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchData/resetForms recreated each render; only run on dialog open
  }, [open]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const promises = [
        apiClient.getTemplatePrograms() as Promise<Program[]>,
        apiClient.getCopyablePrograms(
          classroomId,
          isOrganizationMode && selectedOrganization
            ? selectedOrganization.id
            : undefined,
        ) as Promise<Program[]>,
      ];

      // 組織模式下載入機構教材
      if (isOrganizationMode && selectedOrganization) {
        promises.push(
          apiClient.getTeacherPrograms(
            true,
            undefined,
            undefined,
            selectedOrganization.id,
          ) as Promise<Program[]>,
        );
      }

      const results = await Promise.all(promises);
      const [templatesData, copyableData, orgProgramsData] = results;

      setTemplates(templatesData);
      // 過濾掉當前班級的課程
      const otherPrograms = copyableData.filter(
        (p) => p.classroom_id !== classroomId,
      );
      setCopyablePrograms(otherPrograms);

      // 設定機構教材
      if (orgProgramsData) {
        setOrgPrograms(orgProgramsData);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
      toast.error(t("dialogs.createProgramDialog.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const resetForms = () => {
    setSelectedOrgPrograms([]);
    setOrgProgramName("");
    setSelectedTemplates([]);
    setTemplateName("");
    setSelectedPrograms([]);
    setCopyName("");
    setCustomForm({
      name: "",
      description: "",
      level: "A1",
      tags: [],
    });
    setSearchTerm("");
    setActiveTab(isOrganizationMode ? "organization" : "template");
    setExpandedClassrooms(new Set());
    isCreatingRef.current = false; // 🔒 重置處理狀態
  };

  // 將課程按班級分組
  const groupProgramsByClassroom = () => {
    const grouped: {
      [key: string]: { programs: Program[]; classroomId?: number };
    } = {};

    copyablePrograms.forEach((program) => {
      // 只處理有班級名稱的課程（已移除模板課程）
      if (!program.classroom_name) return;
      const classroomKey = program.classroom_name;
      if (!grouped[classroomKey]) {
        grouped[classroomKey] = {
          programs: [],
          classroomId: program.classroom_id,
        };
      }
      grouped[classroomKey].programs.push(program);
    });

    return grouped;
  };

  const toggleClassroom = (classroomId: number) => {
    const newExpanded = new Set(expandedClassrooms);
    if (newExpanded.has(classroomId)) {
      newExpanded.delete(classroomId);
    } else {
      newExpanded.add(classroomId);
    }
    setExpandedClassrooms(newExpanded);
  };

  const toggleTemplate = (template: Program, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isSelected = selectedTemplates.some((t) => t.id === template.id);
    if (isSelected) {
      setSelectedTemplates((prev) => prev.filter((t) => t.id !== template.id));
    } else {
      setSelectedTemplates((prev) => [...prev, template]);
    }
  };

  const toggleProgram = (program: Program, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isSelected = selectedPrograms.some((p) => p.id === program.id);
    if (isSelected) {
      setSelectedPrograms((prev) => prev.filter((p) => p.id !== program.id));
    } else {
      setSelectedPrograms((prev) => [...prev, program]);
    }
  };

  const toggleOrgProgram = (program: Program, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isSelected = selectedOrgPrograms.some((p) => p.id === program.id);
    if (isSelected) {
      setSelectedOrgPrograms((prev) => prev.filter((p) => p.id !== program.id));
    } else {
      setSelectedOrgPrograms((prev) => [...prev, program]);
    }
  };

  const handleCreateFromSchool = async () => {
    if (selectedOrgPrograms.length === 0) return;

    // 🔒 防止雙擊
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;

    // 檢查是否有重複課程
    const duplicatePrograms = selectedOrgPrograms.filter((p) => p.is_duplicate);
    if (duplicatePrograms.length > 0) {
      const duplicateNames = duplicatePrograms.map((p) => p.name).join("、");
      const confirmed = window.confirm(
        t("createProgramDialog.school.confirmDuplicate", {
          names: duplicateNames,
        }),
      );
      if (!confirmed) {
        isCreatingRef.current = false;
        return;
      }
    }

    setCreating(true);
    try {
      const promises = selectedOrgPrograms.map((program) =>
        apiClient.copyProgram({
          program_id: program.id,
          target_scope: "classroom",
          target_id: classroomId.toString(),
          name:
            selectedOrgPrograms.length === 1 && orgProgramName
              ? orgProgramName
              : undefined,
        }),
      );

      await Promise.all(promises);
      toast.success(
        t("dialogs.createProgramDialog.success.created", {
          count: selectedOrgPrograms.length,
        }),
      );
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to create from org programs:", error);
      toast.error(t("dialogs.createProgramDialog.errors.createFailed"));
    } finally {
      setCreating(false);
      isCreatingRef.current = false;
    }
  };

  const handleCreateFromTemplate = async () => {
    if (selectedTemplates.length === 0) return;

    // 🔒 防止雙擊：同步檢查是否正在處理中
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;

    // 檢查是否有重複課程
    const duplicateTemplates = selectedTemplates.filter((t) => t.is_duplicate);
    if (duplicateTemplates.length > 0) {
      const duplicateNames = duplicateTemplates.map((t) => t.name).join("、");
      const confirmed = window.confirm(
        t("createProgramDialog.template.confirmDuplicate", {
          names: duplicateNames,
        }),
      );
      if (!confirmed) {
        isCreatingRef.current = false;
        return;
      }
    }

    setCreating(true);
    try {
      // Create programs from multiple templates
      const promises = selectedTemplates.map((template) =>
        apiClient.copyFromTemplate({
          template_id: template.id,
          classroom_id: classroomId,
          name:
            selectedTemplates.length === 1 && templateName
              ? templateName
              : undefined,
        }),
      );

      await Promise.all(promises);
      toast.success(
        t("dialogs.createProgramDialog.success.created", {
          count: selectedTemplates.length,
        }),
      );
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to create from template:", error);
      toast.error(t("dialogs.createProgramDialog.errors.createFailed"));
    } finally {
      setCreating(false);
      isCreatingRef.current = false;
    }
  };

  const handleCopyFromClassroom = async () => {
    if (selectedPrograms.length === 0) return;

    // 🔒 防止雙擊：同步檢查是否正在處理中
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;

    // 檢查是否有重複課程
    const duplicatePrograms = selectedPrograms.filter((p) => p.is_duplicate);
    if (duplicatePrograms.length > 0) {
      const duplicateNames = duplicatePrograms.map((p) => p.name).join("、");
      const confirmed = window.confirm(
        t("createProgramDialog.classroom.confirmDuplicate", {
          names: duplicateNames,
        }),
      );
      if (!confirmed) {
        isCreatingRef.current = false;
        return;
      }
    }

    setCreating(true);
    try {
      // Copy multiple programs
      const promises = selectedPrograms.map((program) =>
        apiClient.copyFromClassroom({
          source_program_id: program.id,
          target_classroom_id: classroomId,
          name:
            selectedPrograms.length === 1 && copyName ? copyName : undefined,
        }),
      );

      await Promise.all(promises);
      toast.success(
        t("dialogs.createProgramDialog.success.copied", {
          count: selectedPrograms.length,
        }),
      );
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to copy from classroom:", error);
      toast.error(t("dialogs.createProgramDialog.errors.copyFailed"));
    } finally {
      setCreating(false);
      isCreatingRef.current = false;
    }
  };

  const handleCreateCustom = async () => {
    if (!customForm.name) return;

    // 🔒 防止雙擊：同步檢查是否正在處理中
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;

    setCreating(true);
    try {
      await apiClient.createCustomProgram(classroomId, {
        name: customForm.name,
        description: customForm.description,
        level: customForm.level,
        tags: customForm.tags,
      });
      toast.success(t("dialogs.createProgramDialog.success.customCreated"));
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to create custom program:", error);
      toast.error(t("dialogs.createProgramDialog.errors.createFailed"));
    } finally {
      setCreating(false);
      isCreatingRef.current = false;
    }
  };

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getLevelBadge = (level?: string) => {
    if (!level) return null;
    const levelColors: Record<string, string> = {
      A1: "bg-green-100 text-green-800",
      A2: "bg-green-100 text-green-800",
      B1: "bg-blue-100 text-blue-800",
      B2: "bg-blue-100 text-blue-800",
      C1: "bg-purple-100 text-purple-800",
      C2: "bg-purple-100 text-purple-800",
    };
    const color =
      levelColors[level.toUpperCase()] || "bg-gray-100 text-gray-800";
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}
      >
        {level}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {t("dialogs.createProgramDialog.title", {
              classroomName: classroomName,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("dialogs.createProgramDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 overflow-hidden"
        >
          <TabsList
            className={`grid w-full bg-gray-100 ${isOrganizationMode ? "grid-cols-4" : "grid-cols-3"}`}
          >
            {isOrganizationMode && (
              <TabsTrigger
                value="organization"
                className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white"
              >
                <Building2 className="h-4 w-4" />
                {t("createProgramDialog.tabs.school")}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="classroom"
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white"
            >
              <Copy className="h-4 w-4" />
              {t("createProgramDialog.tabs.classroom")}
            </TabsTrigger>
            <TabsTrigger
              value="template"
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white"
            >
              <BookOpen className="h-4 w-4" />
              {t("createProgramDialog.tabs.personal")}
            </TabsTrigger>
            <TabsTrigger
              value="custom"
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white"
            >
              <Plus className="h-4 w-4" />
              {t("createProgramDialog.tabs.custom")}
            </TabsTrigger>
          </TabsList>

          {/* 機構教材 (僅組織模式) */}
          {isOrganizationMode && (
            <TabsContent
              value="organization"
              className="flex-1 overflow-hidden flex flex-col"
            >
              <div className="mb-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder={t(
                      "createProgramDialog.school.searchPlaceholder",
                    )}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {orgPrograms.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {t("createProgramDialog.school.selected", {
                        count: selectedOrgPrograms.length,
                        total: orgPrograms.length,
                      })}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedOrgPrograms(orgPrograms)}
                        disabled={
                          selectedOrgPrograms.length === orgPrograms.length
                        }
                        className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                      >
                        {t("createProgramDialog.school.selectAll")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedOrgPrograms([])}
                        disabled={selectedOrgPrograms.length === 0}
                        className="text-xs text-gray-600 hover:text-gray-800 disabled:text-gray-400"
                      >
                        {t("createProgramDialog.school.clear")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 mb-4 max-h-[400px] min-h-[200px]">
                {loading ? (
                  <div className="text-center py-8 text-gray-500">
                    {t("createProgramDialog.school.loading")}
                  </div>
                ) : orgPrograms.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {t("createProgramDialog.school.empty")}
                  </div>
                ) : (
                  orgPrograms
                    .filter((p) =>
                      p.name.toLowerCase().includes(searchTerm.toLowerCase()),
                    )
                    .map((program) => (
                      <div
                        key={program.id}
                        onClick={(e) => toggleOrgProgram(program, e)}
                        className={`p-4 rounded-lg cursor-pointer transition-all ${
                          selectedOrgPrograms.some((p) => p.id === program.id)
                            ? "bg-blue-50 border-2 border-blue-500 shadow-sm"
                            : program.is_duplicate
                              ? "border border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
                              : "border border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-gray-400" />
                              <h4 className="font-medium">{program.name}</h4>
                              {program.is_duplicate && (
                                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                              )}
                              {selectedOrgPrograms.some(
                                (p) => p.id === program.id,
                              ) && (
                                <CheckCircle className="h-4 w-4 text-blue-500" />
                              )}
                            </div>
                            {program.description && (
                              <p className="text-sm text-gray-500 mt-1">
                                {program.description}
                              </p>
                            )}
                            {program.is_duplicate && (
                              <p className="text-xs text-yellow-700 mt-1 bg-yellow-100 px-2 py-1 rounded">
                                {t("createProgramDialog.school.duplicate")}
                              </p>
                            )}
                            <div className="flex items-center gap-4 mt-2">
                              {program.level && getLevelBadge(program.level)}
                              {program.estimated_hours && (
                                <span className="text-xs text-gray-500">
                                  {t("createProgramDialog.common.hours", {
                                    hours: program.estimated_hours,
                                  })}
                                </span>
                              )}
                              {program.lesson_count && (
                                <span className="text-xs text-gray-500">
                                  {program.lesson_count}{" "}
                                  {t("classroomDetail.stats.lessons")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>

              {selectedOrgPrograms.length === 1 && (
                <div className="border-t pt-4">
                  <Label htmlFor="school-program-name">
                    {t("createProgramDialog.school.nameLabel")}
                  </Label>
                  <Input
                    id="school-program-name"
                    value={orgProgramName}
                    onChange={(e) => setOrgProgramName(e.target.value)}
                    placeholder={selectedOrgPrograms[0].name}
                    className="mt-1"
                  />
                </div>
              )}
              {selectedOrgPrograms.length > 1 && (
                <div className="border-t pt-4">
                  <p className="text-sm text-gray-600">
                    {t("createProgramDialog.school.multipleNote", {
                      count: selectedOrgPrograms.length,
                    })}
                  </p>
                </div>
              )}
            </TabsContent>
          )}

          {/* 個人教材 (原「從公版模板複製」) */}
          <TabsContent
            value="template"
            className="flex-1 overflow-hidden flex flex-col"
          >
            <div className="mb-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t(
                    "createProgramDialog.template.searchPlaceholder",
                  )}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              {filteredTemplates.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">
                    {t("createProgramDialog.template.selected", {
                      count: selectedTemplates.length,
                      total: filteredTemplates.length,
                    })}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTemplates(filteredTemplates)}
                      disabled={
                        selectedTemplates.length === filteredTemplates.length
                      }
                      className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                    >
                      {t("createProgramDialog.template.selectAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedTemplates([])}
                      disabled={selectedTemplates.length === 0}
                      className="text-xs text-gray-600 hover:text-gray-800 disabled:text-gray-400"
                    >
                      {t("createProgramDialog.template.clear")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4 max-h-[400px] min-h-[200px]">
              {loading ? (
                <div className="text-center py-8 text-gray-500">
                  {t("createProgramDialog.template.loading")}
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {t("createProgramDialog.template.empty")}
                </div>
              ) : (
                filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    onClick={(e) => toggleTemplate(template, e)}
                    className={`p-4 rounded-lg cursor-pointer transition-all ${
                      selectedTemplates.some((t) => t.id === template.id)
                        ? "bg-blue-50 border-2 border-blue-500 shadow-sm"
                        : template.is_duplicate
                          ? "border border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
                          : "border border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-gray-400" />
                          <h4 className="font-medium">{template.name}</h4>
                          {template.is_duplicate && (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          )}
                          {selectedTemplates.some(
                            (t) => t.id === template.id,
                          ) && (
                            <CheckCircle className="h-4 w-4 text-blue-500" />
                          )}
                        </div>
                        {template.description && (
                          <p className="text-sm text-gray-500 mt-1">
                            {template.description}
                          </p>
                        )}
                        {template.is_duplicate && (
                          <p className="text-xs text-yellow-700 mt-1 bg-yellow-100 px-2 py-1 rounded">
                            {t("createProgramDialog.template.duplicate")}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2">
                          {template.level && getLevelBadge(template.level)}
                          {template.estimated_hours && (
                            <span className="text-xs text-gray-500">
                              {t("createProgramDialog.common.hours", {
                                hours: template.estimated_hours,
                              })}
                            </span>
                          )}
                          {template.lesson_count && (
                            <span className="text-xs text-gray-500">
                              {template.lesson_count}{" "}
                              {t("classroomDetail.stats.lessons")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {selectedTemplates.length === 1 && (
              <div className="border-t pt-4">
                <Label htmlFor="template-name">
                  {t("createProgramDialog.template.nameLabel")}
                </Label>
                <Input
                  id="template-name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={selectedTemplates[0].name}
                  className="mt-1"
                />
              </div>
            )}
            {selectedTemplates.length > 1 && (
              <div className="border-t pt-4">
                <p className="text-sm text-gray-600">
                  {t("createProgramDialog.template.multipleNote", {
                    count: selectedTemplates.length,
                  })}
                </p>
              </div>
            )}
          </TabsContent>

          {/* 從其他班級複製 */}
          <TabsContent
            value="classroom"
            className="flex-1 overflow-hidden flex flex-col"
          >
            <div className="mb-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t(
                    "createProgramDialog.classroom.searchPlaceholder",
                  )}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              {copyablePrograms.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">
                    {t("createProgramDialog.classroom.selected", {
                      count: selectedPrograms.length,
                      total: copyablePrograms.length,
                    })}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPrograms(copyablePrograms)}
                      disabled={
                        selectedPrograms.length === copyablePrograms.length
                      }
                      className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                    >
                      {t("createProgramDialog.classroom.selectAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPrograms([])}
                      disabled={selectedPrograms.length === 0}
                      className="text-xs text-gray-600 hover:text-gray-800 disabled:text-gray-400"
                    >
                      {t("createProgramDialog.classroom.clear")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto mb-4 max-h-[400px] min-h-[200px]">
              {loading ? (
                <div className="text-center py-8 text-gray-500">
                  {t("createProgramDialog.classroom.loading")}
                </div>
              ) : Object.keys(groupProgramsByClassroom()).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {t("createProgramDialog.classroom.noPrograms")}
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupProgramsByClassroom()).map(
                    ([classroomName, classroomData]) => {
                      // 為字符串生成簡單的 hash 值
                      const stringToHash = (str: string) => {
                        let hash = 0;
                        for (let i = 0; i < str.length; i++) {
                          const char = str.charCodeAt(i);
                          hash = (hash << 5) - hash + char;
                          hash = hash & hash; // Convert to 32-bit integer
                        }
                        return Math.abs(hash);
                      };

                      const classroomId =
                        classroomData.classroomId ||
                        stringToHash(classroomName);
                      const programs = classroomData.programs;
                      const isExpanded = expandedClassrooms.has(classroomId);
                      const filteredClassroomPrograms = programs.filter((p) =>
                        p.name.toLowerCase().includes(searchTerm.toLowerCase()),
                      );

                      if (
                        searchTerm &&
                        filteredClassroomPrograms.length === 0
                      ) {
                        return null;
                      }

                      return (
                        <div
                          key={classroomName}
                          className="border rounded-lg overflow-hidden"
                        >
                          {/* 班級標頭 */}
                          <div
                            onClick={() => toggleClassroom(classroomId)}
                            className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-gray-500" />
                              )}
                              <School className="h-4 w-4 text-gray-500" />
                              <span className="font-medium text-sm">
                                {classroomName}
                              </span>
                              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                                {t(
                                  "createProgramDialog.classroom.courseCount",
                                  {
                                    count: searchTerm
                                      ? filteredClassroomPrograms.length
                                      : programs.length,
                                  },
                                )}
                              </span>
                            </div>
                          </div>

                          {/* 班級課程列表 */}
                          {isExpanded && (
                            <div className="p-2 space-y-2 bg-white border-t">
                              {(searchTerm
                                ? filteredClassroomPrograms
                                : programs
                              ).map((program) => (
                                <div
                                  key={program.id}
                                  onClick={(e) => toggleProgram(program, e)}
                                  className={`p-3 rounded-lg cursor-pointer transition-all ${
                                    selectedPrograms.some(
                                      (p) => p.id === program.id,
                                    )
                                      ? "bg-blue-50 border-2 border-blue-500 shadow-sm"
                                      : program.is_duplicate
                                        ? "border border-yellow-300 bg-yellow-50 hover:bg-yellow-100"
                                        : "border border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <BookOpen className="h-4 w-4 text-gray-400" />
                                        <h4 className="font-medium text-sm">
                                          {program.name}
                                        </h4>
                                        {program.is_duplicate && (
                                          <AlertTriangle className="h-3 w-3 text-yellow-500" />
                                        )}
                                        {selectedPrograms.some(
                                          (p) => p.id === program.id,
                                        ) && (
                                          <CheckCircle className="h-4 w-4 text-blue-500" />
                                        )}
                                      </div>
                                      {program.description && (
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                          {program.description}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-3 mt-2">
                                        {program.level &&
                                          getLevelBadge(program.level)}
                                        {program.estimated_hours && (
                                          <span className="text-xs text-gray-500">
                                            {t(
                                              "createProgramDialog.common.hours",
                                              {
                                                hours: program.estimated_hours,
                                              },
                                            )}
                                          </span>
                                        )}
                                        {program.lesson_count && (
                                          <span className="text-xs text-gray-500">
                                            {program.lesson_count}{" "}
                                            {t("classroomDetail.stats.lessons")}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>

            {selectedPrograms.length === 1 && (
              <div className="border-t pt-4">
                <Label htmlFor="copy-name">
                  {t("createProgramDialog.classroom.nameOptional")}
                </Label>
                <Input
                  id="copy-name"
                  value={copyName}
                  onChange={(e) => setCopyName(e.target.value)}
                  placeholder={selectedPrograms[0].name}
                  className="mt-1"
                />
              </div>
            )}
            {selectedPrograms.length > 1 && (
              <div className="border-t pt-4">
                <p className="text-sm text-gray-600">
                  {t("createProgramDialog.classroom.multipleSelected", {
                    count: selectedPrograms.length,
                  })}
                </p>
              </div>
            )}
          </TabsContent>

          {/* 自建課程 */}
          <TabsContent
            value="custom"
            className="flex-1 overflow-hidden flex flex-col"
          >
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              <div>
                <Label htmlFor="custom-name">
                  {t("createProgramDialog.custom.nameRequired")}
                </Label>
                <Input
                  id="custom-name"
                  value={customForm.name}
                  onChange={(e) =>
                    setCustomForm({ ...customForm, name: e.target.value })
                  }
                  placeholder={t("createProgramDialog.custom.namePlaceholder")}
                />
              </div>

              <div>
                <Label htmlFor="custom-description">
                  {t("createProgramDialog.custom.descLabel")}
                </Label>
                <Textarea
                  id="custom-description"
                  value={customForm.description}
                  onChange={(e) =>
                    setCustomForm({
                      ...customForm,
                      description: e.target.value,
                    })
                  }
                  placeholder={t("createProgramDialog.custom.descPlaceholder")}
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="custom-level">
                  {t("createProgramDialog.custom.levelLabel")}
                </Label>
                <Select
                  value={customForm.level}
                  onValueChange={(value) =>
                    setCustomForm({ ...customForm, level: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A1">
                      {t("createProgramDialog.custom.levels.a1")}
                    </SelectItem>
                    <SelectItem value="A2">
                      {t("createProgramDialog.custom.levels.a2")}
                    </SelectItem>
                    <SelectItem value="B1">
                      {t("createProgramDialog.custom.levels.b1")}
                    </SelectItem>
                    <SelectItem value="B2">
                      {t("createProgramDialog.custom.levels.b2")}
                    </SelectItem>
                    <SelectItem value="C1">
                      {t("createProgramDialog.custom.levels.c1")}
                    </SelectItem>
                    <SelectItem value="C2">
                      {t("createProgramDialog.custom.levels.c2")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("createProgramDialog.custom.tagsLabel")}</Label>
                <TagInputWithSuggestions
                  value={customForm.tags}
                  onChange={(tags) => setCustomForm({ ...customForm, tags })}
                  placeholder={t("createProgramDialog.custom.tagsPlaceholder")}
                  maxTags={10}
                  suggestions={tagSuggestions}
                  showSuggestions={true}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={creating}>
            {t("createProgramDialog.buttons.cancel")}
          </Button>
          {activeTab === "organization" && (
            <Button
              onClick={handleCreateFromSchool}
              disabled={selectedOrgPrograms.length === 0 || creating}
            >
              {creating
                ? t("createProgramDialog.buttons.creating")
                : selectedOrgPrograms.length > 1
                  ? t("createProgramDialog.buttons.createMultiple", {
                      count: selectedOrgPrograms.length,
                    })
                  : t("createProgramDialog.buttons.create")}
            </Button>
          )}
          {activeTab === "template" && (
            <Button
              onClick={handleCreateFromTemplate}
              disabled={selectedTemplates.length === 0 || creating}
            >
              {creating
                ? t("createProgramDialog.buttons.creating")
                : selectedTemplates.length > 1
                  ? t("createProgramDialog.buttons.createMultiple", {
                      count: selectedTemplates.length,
                    })
                  : t("createProgramDialog.buttons.create")}
            </Button>
          )}
          {activeTab === "classroom" && (
            <Button
              onClick={handleCopyFromClassroom}
              disabled={selectedPrograms.length === 0 || creating}
            >
              {creating
                ? t("createProgramDialog.buttons.copying")
                : selectedPrograms.length > 1
                  ? t("createProgramDialog.buttons.copyMultiple", {
                      count: selectedPrograms.length,
                    })
                  : t("createProgramDialog.buttons.copy")}
            </Button>
          )}
          {activeTab === "custom" && (
            <Button
              onClick={handleCreateCustom}
              disabled={!customForm.name || creating}
            >
              {creating
                ? t("createProgramDialog.buttons.creating")
                : t("createProgramDialog.buttons.createCustom")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
