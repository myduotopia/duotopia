import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Crown,
  DollarSign,
  AlertTriangle,
  Building,
  Tag,
} from "lucide-react";
import AdminSubscriptionDashboard from "./AdminSubscriptionDashboard";
import AdminBillingDashboard from "./AdminBillingDashboard";
import AdminAudioErrorDashboard from "./AdminAudioErrorDashboard";
import AdminOrganizations from "./AdminOrganizations";
import AdminPlansPage from "./AdminPlansPage";
import AdminLayout from "@/components/admin/AdminLayout";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("subscription");

  return (
    <AdminLayout
      title="管理員控制台"
      description="訂閱管理、費用監控、錯誤追蹤"
      icon={Crown}
    >
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4 md:space-y-6"
      >
        <TabsList className="flex w-full max-w-[1000px] justify-start gap-1 h-auto bg-transparent border-b border-gray-200 rounded-none p-0">
          <TabsTrigger
            value="subscription"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <Crown className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <span className="hidden sm:inline">訂閱管理</span>
            <span className="sm:hidden">訂閱</span>
          </TabsTrigger>
          <TabsTrigger
            value="billing"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <DollarSign className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <span className="hidden sm:inline">GCP 費用</span>
            <span className="sm:hidden">費用</span>
          </TabsTrigger>
          <TabsTrigger
            value="audio-errors"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <span className="hidden sm:inline">錄音錯誤</span>
            <span className="sm:hidden">錯誤</span>
          </TabsTrigger>
          <TabsTrigger
            value="organizations"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <Building className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <span className="hidden sm:inline">組織管理</span>
            <span className="sm:hidden">組織</span>
          </TabsTrigger>
          <TabsTrigger
            value="plans"
            className="flex items-center gap-2 px-4 py-3 text-sm md:text-base font-medium text-gray-500 bg-transparent border-b-2 border-transparent rounded-none data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 data-[state=active]:font-semibold data-[state=active]:shadow-none hover:text-gray-700 transition-colors"
          >
            <Tag className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <span className="hidden sm:inline">方案管理</span>
            <span className="sm:hidden">方案</span>
          </TabsTrigger>
        </TabsList>

        {/* Subscription Management Tab */}
        <TabsContent value="subscription" className="space-y-4">
          <AdminSubscriptionDashboard />
        </TabsContent>

        {/* GCP Billing Tab */}
        <TabsContent value="billing" className="space-y-4">
          <AdminBillingDashboard />
        </TabsContent>

        {/* Audio Error Monitoring Tab */}
        <TabsContent value="audio-errors" className="space-y-4">
          <AdminAudioErrorDashboard />
        </TabsContent>

        {/* Organization Management Tab */}
        <TabsContent value="organizations" className="space-y-4">
          <AdminOrganizations />
        </TabsContent>

        {/* Plans Management Tab */}
        <TabsContent value="plans" className="space-y-4">
          <AdminPlansPage />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
