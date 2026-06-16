import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/lib/api";
import {
  OrganizationListResponse,
  OrganizationListItem,
  AdminOrganizationUpdateRequest,
  AdminOrganizationUpdateResponse,
} from "@/types/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Building,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { ENABLE_GROUP_BUY } from "@/config/featureFlags";

const DEBOUNCE_DELAY = 300;

export default function AdminOrganizations() {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Edit dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationListItem | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    display_name: "",
    description: "",
    tax_id: "",
    teacher_limit: "",
    contact_email: "",
    contact_phone: "",
    address: "",
    total_points: "",
    subscription_start_date: "",
    subscription_end_date: "",
    per_student_price: "", // Phase 5-2 (#768): institution monthly per-student fee
  });

  // Validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0); // Reset to first page when searching
    }, DEBOUNCE_DELAY);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch organizations
  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.listOrganizations({
        limit: pageSize,
        offset: page * pageSize,
        search: debouncedSearch || undefined,
      });

      const data = response as OrganizationListResponse;
      setOrganizations(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch organizations:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load organizations",
      );
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  // Pagination handlers
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = page * pageSize + 1;
  const endIndex = Math.min((page + 1) * pageSize, total);

  const handlePreviousPage = () => {
    if (page > 0) setPage(page - 1);
  };

  const handleNextPage = () => {
    if (page < totalPages - 1) setPage(page + 1);
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setPage(0); // Reset to first page when changing page size
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  // Edit handler
  const handleEdit = (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) return;

    setSelectedOrg(org);
    setFormData({
      display_name: org.display_name || "",
      description: org.description || "",
      tax_id: org.tax_id || "",
      teacher_limit: org.teacher_limit?.toString() || "",
      contact_email: org.contact_email || "",
      contact_phone: org.contact_phone || "",
      address: org.address || "",
      total_points: org.total_points.toString(),
      subscription_start_date: org.subscription_start_date
        ? org.subscription_start_date.split("T")[0]
        : "",
      subscription_end_date: org.subscription_end_date
        ? org.subscription_end_date.split("T")[0]
        : "",
      per_student_price: org.per_student_price?.toString() || "",
    });
    setFormErrors({});
    setIsEditDialogOpen(true);
  };

  // Form validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Email validation
    if (
      formData.contact_email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact_email)
    ) {
      errors.contact_email = "請輸入有效的 Email 格式";
    }

    // Numeric validations
    if (formData.teacher_limit && isNaN(Number(formData.teacher_limit))) {
      errors.teacher_limit = "教師限制必須是數字";
    }
    if (formData.teacher_limit && Number(formData.teacher_limit) < 0) {
      errors.teacher_limit = "教師限制不能為負數";
    }

    if (formData.total_points && isNaN(Number(formData.total_points))) {
      errors.total_points = "總點數必須是數字";
    }
    if (formData.total_points && Number(formData.total_points) < 0) {
      errors.total_points = "總點數不能為負數";
    }

    // Phase 5-2 (#768): per_student_price validation
    if (
      formData.per_student_price &&
      isNaN(Number(formData.per_student_price))
    ) {
      errors.per_student_price = "單位學生月費必須是數字";
    }
    if (formData.per_student_price && Number(formData.per_student_price) <= 0) {
      errors.per_student_price = "單位學生月費必須大於 0";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Calculate points change
  const calculatePointsChange = (): number => {
    if (!selectedOrg || !formData.total_points) return 0;
    return Number(formData.total_points) - selectedOrg.total_points;
  };

  // Check if reducing points below used points
  const isPointsReductionInvalid = (): boolean => {
    if (!selectedOrg || !formData.total_points) return false;
    const newTotal = Number(formData.total_points);
    return newTotal < selectedOrg.used_points;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!selectedOrg) return;

    if (!validateForm()) {
      toast.error("請修正表單錯誤");
      return;
    }

    if (isPointsReductionInvalid()) {
      toast.error("總點數不能低於已使用點數");
      return;
    }

    setIsSaving(true);

    try {
      // Build update payload (only include changed fields)
      const updateData: Partial<AdminOrganizationUpdateRequest> = {};

      if (formData.display_name !== (selectedOrg.display_name || "")) {
        updateData.display_name = formData.display_name;
      }
      if (formData.description) {
        updateData.description = formData.description;
      }
      if (formData.tax_id) {
        updateData.tax_id = formData.tax_id;
      }
      if (formData.teacher_limit) {
        updateData.teacher_limit = Number(formData.teacher_limit);
      }
      if (formData.contact_email) {
        updateData.contact_email = formData.contact_email;
      }
      if (formData.contact_phone) {
        updateData.contact_phone = formData.contact_phone;
      }
      if (formData.address) {
        updateData.address = formData.address;
      }
      if (formData.subscription_start_date) {
        updateData.subscription_start_date = `${formData.subscription_start_date}T00:00:00Z`;
      }
      if (formData.subscription_end_date) {
        updateData.subscription_end_date = `${formData.subscription_end_date}T23:59:59Z`;
      }
      if (
        formData.total_points &&
        Number(formData.total_points) !== selectedOrg.total_points
      ) {
        updateData.total_points = Number(formData.total_points);
      }
      // Phase 5-2 (#768): explicit clear path. Truthy/falsy on a string
      // would treat "" as "skip", making the field unclearable once set.
      // Distinguish: empty input → send null to clear; non-empty → send
      // parsed value if it differs from current.
      if (formData.per_student_price === "") {
        if (selectedOrg.per_student_price != null) {
          updateData.per_student_price = null;
        }
      } else {
        const parsed = Number(formData.per_student_price);
        if (parsed !== (selectedOrg.per_student_price ?? 0)) {
          updateData.per_student_price = parsed;
        }
      }

      const response = (await apiClient.updateOrganization(
        selectedOrg.id,
        updateData,
      )) as AdminOrganizationUpdateResponse;

      // Show success message
      let successMessage = "組織更新成功";
      if (response.points_adjusted && response.points_change !== null) {
        const changeText =
          response.points_change > 0
            ? `+${response.points_change.toLocaleString()}`
            : response.points_change.toLocaleString();
        successMessage += ` (點數調整: ${changeText})`;
      }
      toast.success(successMessage);

      // Refresh organization list
      await fetchOrganizations();

      // Close dialog
      setIsEditDialogOpen(false);
      setSelectedOrg(null);
    } catch (err) {
      console.error("Failed to update organization:", err);
      const errorMessage = err instanceof Error ? err.message : "更新組織失敗";
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle dialog close
  const handleDialogClose = () => {
    if (isSaving) return; // Prevent closing while saving
    setIsEditDialogOpen(false);
    setSelectedOrg(null);
    setFormErrors({});
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building className="h-6 w-6 text-blue-600" />
              <CardTitle className="text-2xl font-bold">組織管理</CardTitle>
            </div>
            <Button
              onClick={() => navigate("/admin/organizations/create")}
              className="flex items-center gap-2"
            >
              <Building className="h-4 w-4" />
              創建組織
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Search and Filter Bar */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="搜尋組織名稱或擁有人 email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">每頁顯示：</span>
              <Select
                value={String(pageSize)}
                onValueChange={handlePageSizeChange}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Error State */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Loading Skeleton */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-16 bg-gray-100 animate-pulse rounded"
                />
              ))}
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">組織名稱</TableHead>
                      <TableHead className="font-semibold">擁有人</TableHead>
                      <TableHead className="font-semibold text-center">
                        教師數
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        點數
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        狀態
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        起始日期
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        訂閱到期
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        訂閱狀態
                      </TableHead>
                      <TableHead className="font-semibold text-center">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizations.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center py-8 text-gray-500"
                        >
                          {searchQuery
                            ? "找不到符合條件的組織"
                            : "尚無組織資料"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      organizations.map((org) => (
                        <TableRow key={org.id} className="hover:bg-gray-50">
                          {/* Organization Name */}
                          <TableCell className="font-medium">
                            <div>
                              <div className="font-semibold">{org.name}</div>
                              {org.display_name && (
                                <div className="text-sm text-gray-500">
                                  {org.display_name}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Owner */}
                          <TableCell>
                            <div>
                              <div className="text-sm">{org.owner_email}</div>
                              {org.owner_name && (
                                <div className="text-xs text-gray-500">
                                  {org.owner_name}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Teacher Count/Limit */}
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center">
                              <span className="font-semibold">
                                {org.teacher_count}
                                {org.teacher_limit !== null &&
                                  ` / ${org.teacher_limit}`}
                              </span>
                              {org.teacher_limit !== null && (
                                <div className="text-xs text-gray-500">
                                  {Math.round(
                                    (org.teacher_count / org.teacher_limit) *
                                      100,
                                  )}
                                  % 使用
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Points */}
                          <TableCell className="text-center">
                            <div
                              className="flex flex-col items-center cursor-help"
                              title={`總點數: ${org.total_points}\n已使用: ${org.used_points}\n剩餘: ${org.remaining_points}`}
                            >
                              <span className="font-semibold text-green-600">
                                {org.remaining_points.toLocaleString()}
                              </span>
                              <div className="text-xs text-gray-500">
                                / {org.total_points.toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-400">
                                已用 {org.used_points.toLocaleString()}
                              </div>
                            </div>
                          </TableCell>

                          {/* Status */}
                          <TableCell className="text-center">
                            <Badge
                              variant={org.is_active ? "success" : "secondary"}
                            >
                              {org.is_active ? "啟用" : "停用"}
                            </Badge>
                          </TableCell>

                          {/* Subscription Start Date */}
                          <TableCell className="text-center text-sm text-gray-600">
                            {formatDate(org.subscription_start_date)}
                          </TableCell>

                          {/* Subscription End Date */}
                          <TableCell className="text-center text-sm">
                            {org.subscription_end_date ? (
                              <span
                                className={
                                  new Date(org.subscription_end_date) <
                                  new Date()
                                    ? "text-red-600 font-semibold"
                                    : "text-gray-600"
                                }
                              >
                                {formatDate(org.subscription_end_date)}
                              </span>
                            ) : (
                              <span className="text-gray-400">未設定</span>
                            )}
                          </TableCell>

                          {/* Expired Status */}
                          <TableCell className="text-center">
                            {org.subscription_end_date ? (
                              new Date(org.subscription_end_date) <
                              new Date() ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  已到期
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  有效
                                </span>
                              )
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(org.id)}
                                className="flex items-center gap-1"
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                              {/* Phase 5-2 (#768): institution monthly billing */}
                              {/* Issue #768 — Monthly-billing page is
                                  part of the institution billing flow
                                  introduced for group-buy. Gated for
                                  the staging→main release; re-enabled
                                  by flipping VITE_ENABLE_GROUP_BUY. */}
                              {ENABLE_GROUP_BUY &&
                                org.org_type === "institution" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      navigate(
                                        `/admin/organizations/${org.id}/billing`,
                                      )
                                    }
                                    className="flex items-center gap-1"
                                    title="查看機構月度計費"
                                  >
                                    月結
                                  </Button>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {total > 0 && (
                <div className="flex items-center justify-between pt-4">
                  <div className="text-sm text-gray-600">
                    顯示 {startIndex} - {endIndex} 筆，共 {total} 筆
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePreviousPage}
                      disabled={page === 0}
                      className="flex items-center gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一頁
                    </Button>

                    <span className="text-sm text-gray-600">
                      第 {page + 1} / {totalPages} 頁
                    </span>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1"
                    >
                      下一頁
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit Organization Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent
          className="max-w-3xl max-h-[90vh] overflow-y-auto"
          onPointerDownOutside={(e) => {
            if (isSaving) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              編輯組織 - {selectedOrg?.name}
            </DialogTitle>
            <DialogDescription>更新組織的基本資訊和點數配置</DialogDescription>
          </DialogHeader>

          {selectedOrg && (
            <div className="space-y-6 py-4">
              {/* Basic Information Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                  基本資訊
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {/* Display Name */}
                  <div className="space-y-2">
                    <Label htmlFor="display_name">顯示名稱</Label>
                    <Input
                      id="display_name"
                      value={formData.display_name}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          display_name: e.target.value,
                        })
                      }
                      placeholder="組織的公開顯示名稱"
                    />
                  </div>

                  {/* Tax ID */}
                  <div className="space-y-2">
                    <Label htmlFor="tax_id">統一編號</Label>
                    <Input
                      id="tax_id"
                      value={formData.tax_id}
                      onChange={(e) =>
                        setFormData({ ...formData, tax_id: e.target.value })
                      }
                      placeholder="8 位數統一編號"
                      maxLength={8}
                    />
                  </div>

                  {/* Description */}
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="description">組織描述</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="組織的詳細描述"
                      rows={3}
                    />
                  </div>

                  {/* Teacher Limit */}
                  <div className="space-y-2">
                    <Label htmlFor="teacher_limit">教師限制</Label>
                    <Input
                      id="teacher_limit"
                      type="number"
                      min="0"
                      value={formData.teacher_limit}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          teacher_limit: e.target.value,
                        })
                      }
                      placeholder="不限制請留空"
                    />
                    {formErrors.teacher_limit && (
                      <p className="text-sm text-red-600">
                        {formErrors.teacher_limit}
                      </p>
                    )}
                    {selectedOrg.teacher_limit !== null && (
                      <p className="text-xs text-gray-500">
                        目前有 {selectedOrg.teacher_count} 位教師
                      </p>
                    )}
                  </div>

                  {/* Phase 5-2 (#768): per-student monthly price (institution only) */}
                  <div className="space-y-2">
                    <Label htmlFor="per_student_price">
                      單位學生月費（NT$，機構月結用）
                    </Label>
                    <Input
                      id="per_student_price"
                      type="number"
                      min="1"
                      value={formData.per_student_price}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          per_student_price: e.target.value,
                        })
                      }
                      placeholder="僅機構方案需要填寫"
                    />
                    {formErrors.per_student_price && (
                      <p className="text-sm text-red-600">
                        {formErrors.per_student_price}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      每月應收 = 當月活躍學生人數 × 單位學生月費
                    </p>
                  </div>
                </div>
              </div>

              {/* Contact Information Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                  聯絡資訊
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {/* Contact Email */}
                  <div className="space-y-2">
                    <Label htmlFor="contact_email">聯絡 Email</Label>
                    <Input
                      id="contact_email"
                      type="email"
                      value={formData.contact_email}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_email: e.target.value,
                        })
                      }
                      placeholder="contact@example.com"
                    />
                    {formErrors.contact_email && (
                      <p className="text-sm text-red-600">
                        {formErrors.contact_email}
                      </p>
                    )}
                  </div>

                  {/* Contact Phone */}
                  <div className="space-y-2">
                    <Label htmlFor="contact_phone">聯絡電話</Label>
                    <Input
                      id="contact_phone"
                      value={formData.contact_phone}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_phone: e.target.value,
                        })
                      }
                      placeholder="02-1234-5678"
                    />
                  </div>

                  {/* Address */}
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="address">地址</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) =>
                        setFormData({ ...formData, address: e.target.value })
                      }
                      placeholder="組織地址"
                    />
                  </div>

                  {/* Subscription Start Date */}
                  <div className="space-y-2">
                    <Label htmlFor="subscription_start_date">
                      訂閱開始時間
                    </Label>
                    <Input
                      id="subscription_start_date"
                      type="date"
                      value={formData.subscription_start_date}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          subscription_start_date: e.target.value,
                        })
                      }
                    />
                  </div>

                  {/* Subscription End Date */}
                  <div className="space-y-2">
                    <Label htmlFor="subscription_end_date">訂閱結束時間</Label>
                    <Input
                      id="subscription_end_date"
                      type="date"
                      value={formData.subscription_end_date}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          subscription_end_date: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Points Management Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 border-b pb-2">
                  點數管理
                </h3>

                {/* Current Points Display */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">總點數</div>
                      <div className="text-lg font-bold text-blue-600">
                        {selectedOrg.total_points.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">已使用</div>
                      <div className="text-lg font-bold text-orange-600">
                        {selectedOrg.used_points.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">剩餘</div>
                      <div className="text-lg font-bold text-green-600">
                        {selectedOrg.remaining_points.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* New Total Points Input */}
                <div className="space-y-2">
                  <Label htmlFor="total_points">新的總點數</Label>
                  <Input
                    id="total_points"
                    type="number"
                    min="0"
                    value={formData.total_points}
                    onChange={(e) =>
                      setFormData({ ...formData, total_points: e.target.value })
                    }
                    placeholder="輸入新的總點數"
                  />
                  {formErrors.total_points && (
                    <p className="text-sm text-red-600">
                      {formErrors.total_points}
                    </p>
                  )}
                </div>

                {/* Points Change Display */}
                {formData.total_points &&
                  Number(formData.total_points) !==
                    selectedOrg.total_points && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-gray-50 border rounded-lg p-3">
                        <span className="text-sm text-gray-700">
                          點數調整：
                        </span>
                        <span
                          className={`text-lg font-bold ${
                            calculatePointsChange() > 0
                              ? "text-green-600"
                              : calculatePointsChange() < 0
                                ? "text-red-600"
                                : "text-gray-600"
                          }`}
                        >
                          {calculatePointsChange() > 0 ? "+" : ""}
                          {calculatePointsChange().toLocaleString()}
                        </span>
                      </div>

                      {/* Warning for invalid reduction */}
                      {isPointsReductionInvalid() && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            總點數不能低於已使用點數 (
                            {selectedOrg.used_points.toLocaleString()})
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Warning for large adjustments */}
                      {Math.abs(calculatePointsChange()) > 10000 &&
                        !isPointsReductionInvalid() && (
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              注意：您正在進行大幅度點數調整 (
                              {calculatePointsChange() > 0 ? "增加" : "減少"}{" "}
                              {Math.abs(
                                calculatePointsChange(),
                              ).toLocaleString()}{" "}
                              點)
                            </AlertDescription>
                          </Alert>
                        )}
                    </div>
                  )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleDialogClose}
              disabled={isSaving}
            >
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || isPointsReductionInvalid()}
            >
              {isSaving ? "儲存中..." : "儲存變更"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
