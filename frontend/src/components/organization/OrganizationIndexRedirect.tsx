/**
 * Placeholder component for the /organization index route.
 * The actual redirect to the first organization is handled by OrganizationLayout
 * after organizations are fetched.
 */
export function OrganizationIndexRedirect() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-gray-500">載入中...</div>
    </div>
  );
}
