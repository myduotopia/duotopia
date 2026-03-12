import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb } from "@/components/organization/Breadcrumb";

export default function SchoolEditPage() {
  const { schoolId } = useParams<{ schoolId: string }>();

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "學校詳情" }]} />

      <Card>
        <CardHeader>
          <CardTitle>學校編輯 - {schoolId}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">學校 CRUD 功能開發中...</p>
          <p className="text-sm text-gray-500 mt-2">
            這裡將顯示學校的詳細資訊和編輯表單
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
