/**
 * Admin page: institution monthly billing query for a specific org.
 *
 * Route: /admin/organizations/:orgId/billing
 * Auth: requires admin (ProtectedRoute requireAdmin).
 *
 * Simple host for OrgMonthlyBillingPanel — keeps the panel reusable so
 * the org_owner side can embed it in OrganizationDetail later without
 * touching this page.
 */
import { useParams, useNavigate } from "react-router-dom";
import OrgMonthlyBillingPanel from "@/components/OrgMonthlyBillingPanel";
import { Button } from "@/components/ui/button";

export default function AdminOrgMonthlyBilling() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  if (!orgId) {
    return (
      <div className="p-6 text-red-600">
        Missing orgId in URL. Go back to{" "}
        <button
          className="underline"
          onClick={() => navigate("/admin/organizations")}
        >
          organizations list
        </button>
        .
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">機構月度計費查詢</h1>
        <Button
          variant="ghost"
          onClick={() => navigate("/admin/organizations")}
        >
          ← 返回機構列表
        </Button>
      </div>
      <p className="text-sm text-gray-600">
        Org ID:{" "}
        <code className="rounded bg-gray-100 px-1.5 py-0.5">{orgId}</code>
      </p>
      <OrgMonthlyBillingPanel orgId={orgId} />
    </div>
  );
}
