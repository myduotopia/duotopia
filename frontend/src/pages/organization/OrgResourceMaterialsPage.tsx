import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useResourceMaterialsAPI,
  ResourceMaterial,
  ResourceMaterialDetail,
} from "@/hooks/useResourceMaterialsAPI";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Package,
  Copy,
  BookOpen,
  Layers,
  FileText,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  ListOrdered,
  Clock,
  ChevronDown,
} from "lucide-react";
import { getContentTypeIcon } from "@/lib/contentTypeIcon";
import { toast } from "sonner";

/** Expandable content card showing items inside */
function ContentItemAccordion({
  content,
}: {
  content: ResourceMaterialDetail["lessons"][number]["contents"][number];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const contentTypeLabel = (type: string | null) => {
    if (!type) return "";
    const key = `resourceMaterials.contentTypes.${type.toLowerCase()}`;
    const translated = t(key);
    return translated === key ? type : translated;
  };

  return (
    <div className="border-l-4 border-l-violet-500 bg-gray-100/60 shadow-sm rounded-[0.15rem] mb-3">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <div className="w-7 h-7 bg-purple-100 rounded-md flex items-center justify-center flex-shrink-0">
            {(() => {
              const Icon = getContentTypeIcon(content.type);
              return <Icon className="h-4 w-4 text-purple-600" />;
            })()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{content.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {content.type && (
            <span className="text-xs text-gray-400">
              {contentTypeLabel(content.type)}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {t("resourceMaterials.detail.itemCount", {
              count: content.item_count,
            })}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </div>
      {expanded && content.items && content.items.length > 0 && (
        <div className="px-3 pb-3">
          <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-x-2 border-b border-gray-100 bg-gray-50/80 px-3 py-1.5">
              <span className="w-8 text-xs font-medium text-gray-500 flex-shrink-0">
                #
              </span>
              <span className="text-xs font-medium text-gray-500">
                {t("resourceMaterials.detail.tableHeader.content")}
              </span>
              <span className="text-xs font-medium text-gray-500">/</span>
              <span className="text-xs font-medium text-gray-500">
                {t("resourceMaterials.detail.tableHeader.translation")}
              </span>
            </div>
            {/* Items */}
            {content.items.map((item, idx) => (
              <div
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 border-b border-gray-50 last:border-0"
              >
                <span className="w-8 text-xs text-gray-400 flex-shrink-0">
                  {idx + 1}
                </span>
                <span className="text-sm text-gray-900 break-all">
                  {item.text}
                </span>
                <span className="text-sm text-gray-400">/</span>
                <span className="text-sm text-gray-500 break-all">
                  {item.translation || "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {expanded && (!content.items || content.items.length === 0) && (
        <div className="px-3 pb-3">
          <p className="text-sm text-gray-400 text-center py-2">
            {t("resourceMaterials.detail.noItems")}
          </p>
        </div>
      )}
    </div>
  );
}

export default function OrgResourceMaterialsPage() {
  const { t } = useTranslation();
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { loading, listMaterials, getMaterialDetail, copyMaterial } =
    useResourceMaterialsAPI();

  const [materials, setMaterials] = useState<ResourceMaterial[]>([]);
  const [selectedDetail, setSelectedDetail] =
    useState<ResourceMaterialDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<ResourceMaterial | null>(null);
  const [copying, setCopying] = useState(false);

  const fetchMaterials = useCallback(async () => {
    if (!orgId) return;
    const result = await listMaterials("organization", orgId);
    setMaterials(result.materials);
  }, [listMaterials, orgId]);

  useEffect(() => {
    fetchMaterials();
  }, [orgId, fetchMaterials]);

  const handleViewDetail = async (material: ResourceMaterial) => {
    const detail = await getMaterialDetail(material.id);
    if (detail) {
      setSelectedDetail(detail);
      setShowDetail(true);
    }
  };

  const handleCopyClick = (material: ResourceMaterial) => {
    setCopyTarget(material);
    setCopyDialogOpen(true);
  };

  const handleConfirmCopy = async () => {
    if (!copyTarget || !orgId) return;
    setCopying(true);
    try {
      await copyMaterial(copyTarget.id, "organization", orgId);
      toast.success(
        t("resourceMaterials.toast.copySuccessOrg", {
          name: copyTarget.name,
        }),
      );
      setCopyDialogOpen(false);
      setCopyTarget(null);
      fetchMaterials();
    } catch {
      toast.error(t("resourceMaterials.toast.copyFailed"));
    } finally {
      setCopying(false);
    }
  };

  const getLevelBadgeColor = (level: string | null) => {
    const colors: Record<string, string> = {
      preA: "bg-gray-100 text-gray-700",
      A1: "bg-green-100 text-green-700",
      A2: "bg-blue-100 text-blue-700",
      B1: "bg-yellow-100 text-yellow-700",
      B2: "bg-orange-100 text-orange-700",
      C1: "bg-red-100 text-red-700",
      C2: "bg-purple-100 text-purple-700",
    };
    return level ? (colors[level] ?? "bg-gray-100 text-gray-700") : "";
  };

  // Copy dialog — rendered in both detail and list views
  const copyDialog = (
    <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("resourceMaterials.copyDialog.titleOrg")}
          </DialogTitle>
          <DialogDescription>
            {t("resourceMaterials.copyDialog.descriptionOrg", {
              name: copyTarget?.name,
            })}
            <br />
            <span className="text-xs text-muted-foreground">
              {t("resourceMaterials.copyDialog.orgLimit")}
            </span>
          </DialogDescription>
        </DialogHeader>
        {copyTarget && (
          <div className="py-2 text-sm space-y-1">
            <p>
              <span className="font-medium">
                {t("resourceMaterials.copyDialog.courseName")}
              </span>
              {copyTarget.name}
            </p>
            <p>
              <span className="font-medium">
                {t("resourceMaterials.copyDialog.includes")}
              </span>
              {t("resourceMaterials.copyDialog.units", {
                count: copyTarget.lesson_count,
              })}
              {t("resourceMaterials.copyDialog.contents", {
                count: copyTarget.content_count,
              })}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCopyDialogOpen(false)}
            disabled={copying}
          >
            {t("resourceMaterials.copyDialog.cancel")}
          </Button>
          <Button onClick={handleConfirmCopy} disabled={copying}>
            {copying ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                {t("resourceMaterials.copyDialog.copying")}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" />
                {t("resourceMaterials.copyDialog.confirmCopy")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (showDetail && selectedDetail) {
    return (
      <div className="p-6 space-y-4 bg-gray-50 min-h-full">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowDetail(false);
            setSelectedDetail(null);
          }}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("resourceMaterials.detail.backToList")}
        </Button>

        {/* Program-level card */}
        <div className="border-l-4 border-l-blue-500 bg-white shadow-sm rounded-[0.15rem]">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className="w-9 h-9 bg-blue-100 rounded-md flex items-center justify-center flex-shrink-0">
                  <BookOpen className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-base">
                    {selectedDetail.name}
                  </h4>
                  {selectedDetail.description && (
                    <p className="text-sm text-gray-500 truncate">
                      {selectedDetail.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {selectedDetail.level && (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getLevelBadgeColor(selectedDetail.level)}`}
                  >
                    {selectedDetail.level}
                  </span>
                )}
                {selectedDetail.estimated_hours && (
                  <div className="flex items-center text-sm text-gray-500">
                    <Clock className="h-4 w-4 mr-1" />
                    <span>
                      {selectedDetail.estimated_hours}{" "}
                      {t("resourceMaterials.detail.hours")}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {/* Tags */}
            {selectedDetail.tags && selectedDetail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 pl-12">
                {selectedDetail.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Lessons inside program */}
          <div className="px-3 pb-3 space-y-0">
            <Accordion type="multiple">
              {selectedDetail.lessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className="border-l-4 border-l-emerald-500 bg-gray-50/80 shadow-sm rounded-[0.15rem] mb-3"
                >
                  <AccordionItem
                    value={`lesson-${lesson.id}`}
                    className="border-none"
                  >
                    <AccordionTrigger
                      hideChevron
                      className="hover:no-underline px-4 py-3"
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <div className="w-9 h-9 bg-green-100 rounded-md flex items-center justify-center flex-shrink-0">
                            <ListOrdered className="h-5 w-5 text-green-600" />
                          </div>
                          <div className="text-left flex-1 min-w-0">
                            <h4 className="font-semibold text-sm sm:text-base">
                              {lesson.name}
                            </h4>
                            {lesson.description && (
                              <p className="text-xs sm:text-sm text-gray-500 truncate">
                                {lesson.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {t("resourceMaterials.detail.contentCount", {
                            count: lesson.content_count,
                          })}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="px-3 pb-3 space-y-0">
                        {lesson.contents.map((content) => (
                          <ContentItemAccordion
                            key={content.id}
                            content={content}
                          />
                        ))}
                        {lesson.contents.length === 0 && (
                          <p className="text-sm text-gray-500 py-4 text-center">
                            {t("resourceMaterials.detail.noContent")}
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </div>
              ))}
            </Accordion>
            {selectedDetail.lessons.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">
                {t("resourceMaterials.detail.noUnits")}
              </p>
            )}
          </div>
        </div>

        {/* Copy button at bottom */}
        <div className="flex justify-center pt-2">
          <Button
            size="lg"
            onClick={() => {
              const material = materials.find(
                (m) => m.id === selectedDetail.id,
              );
              if (material) {
                handleCopyClick(material);
              }
            }}
            className="px-8"
          >
            <Copy className="w-4 h-4 mr-2" />
            {t("resourceMaterials.card.copyToOrg")}
          </Button>
        </div>
        {copyDialog}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/organization/${orgId}`)}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("resourceMaterials.detail.back")}
        </Button>
        <Package className="w-6 h-6 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">{t("resourceMaterials.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("resourceMaterials.subtitleOrg")}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && materials.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            {t("resourceMaterials.loading")}
          </span>
        </div>
      )}

      {/* Empty State */}
      {!loading && materials.length === 0 && (
        <div className="text-center py-12">
          <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">
            {t("resourceMaterials.empty.title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t("resourceMaterials.empty.subtitle")}
          </p>
        </div>
      )}

      {/* Materials Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {materials.map((material) => (
          <Card
            key={material.id}
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => handleViewDetail(material)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base line-clamp-2">
                  {material.name}
                </CardTitle>
                {material.level && (
                  <Badge
                    className={getLevelBadgeColor(material.level)}
                    variant="secondary"
                  >
                    {material.level}
                  </Badge>
                )}
              </div>
              {material.description && (
                <CardDescription className="line-clamp-2">
                  {material.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                <span className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  {material.lesson_count} {t("resourceMaterials.card.units")}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  {material.content_count}{" "}
                  {t("resourceMaterials.card.contents")}
                </span>
              </div>
              <Button
                size="sm"
                className="w-full"
                variant={material.copied_today ? "secondary" : "default"}
                disabled={material.copied_today}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyClick(material);
                }}
              >
                {material.copied_today ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    {t("resourceMaterials.card.copiedToday")}
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    {t("resourceMaterials.card.copyToOrg")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {copyDialog}
    </div>
  );
}
