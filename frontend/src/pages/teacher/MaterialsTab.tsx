import { useTranslation } from "react-i18next";

// TODO: add sections when GIFs are ready

export default function MaterialsTab() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[300px] flex items-center justify-center text-gray-400 text-sm">
      {t("teacherDashboard.materialsTab.placeholder")}
    </div>
  );
}
