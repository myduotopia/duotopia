import { useTranslation } from "react-i18next";

const GIF_SECTION1_URL =
  "https://storage.googleapis.com/duotopia-social-media-videos/website/Resource%20Materials-tab01.gif";
const GIF_SECTION2_URL =
  "https://storage.googleapis.com/duotopia-social-media-videos/website/Resource%20Materials-tab02.gif";

interface SectionProps {
  title: string;
  gifUrl: string;
  gifAlt: string;
  isEn: boolean;
}

function Section({ title, gifUrl, gifAlt, isEn }: SectionProps) {
  return (
    <div className="space-y-6">
      <p
        className="text-center mx-auto"
        style={
          isEn
            ? {
                maxWidth: "75%",
                fontFamily: "'Caveat', 'Dancing Script', cursive",
                fontSize: "clamp(1.1rem, 3.5vw, 1.6rem)",
                lineHeight: 1.3,
                color: "#1e293b",
                fontWeight: 600,
                textWrap: "balance",
              }
            : {
                maxWidth: "75%",
                fontSize: "clamp(0.95rem, 2.8vw, 1.25rem)",
                lineHeight: 1.4,
                color: "#1e293b",
                fontWeight: 700,
                textWrap: "balance",
              }
        }
      >
        {title}
      </p>

      <div className="flex justify-center">
        {gifUrl ? (
          <img
            src={gifUrl}
            alt={gifAlt}
            className="w-3/4 rounded-2xl shadow-lg"
          />
        ) : (
          <div
            className="w-3/4 rounded-2xl flex items-center justify-center text-slate-300 text-sm border-2 border-dashed border-slate-200"
            style={{ minHeight: "280px", background: "#f8fafc" }}
          >
            {gifAlt}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResourceMaterialsTab() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";

  return (
    <div className="px-1 py-2 md:px-8 md:py-8 space-y-12 w-full">
      <Section
        title={t("teacherDashboard.resourceMaterialsTab.section1")}
        gifUrl={GIF_SECTION1_URL}
        gifAlt={t("teacherDashboard.resourceMaterialsTab.gifAlt1")}
        isEn={isEn}
      />
      <Section
        title={t("teacherDashboard.resourceMaterialsTab.section2")}
        gifUrl={GIF_SECTION2_URL}
        gifAlt={t("teacherDashboard.resourceMaterialsTab.gifAlt2")}
        isEn={isEn}
      />
    </div>
  );
}
