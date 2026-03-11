import { useTranslation } from "react-i18next";

const GIF_SECTION1_URL = "https://storage.googleapis.com/duotopia-social-media-videos/website/myclass-tab01.gif";
const GIF_SECTION2_URL = "https://storage.googleapis.com/duotopia-social-media-videos/website/myclass-tab02.gif";
const GIF_SECTION3_URL = ""; // TODO: share QR code + student login
const GIF_SECTION4_URL = ""; // TODO: AI grading

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
        style={isEn ? {
          maxWidth: "75%",
          fontFamily: "'Caveat', 'Dancing Script', cursive",
          fontSize: "1.6rem",
          lineHeight: 1.3,
          color: "#1e293b",
          fontWeight: 600,
          textWrap: "balance",
        } : {
          maxWidth: "75%",
          fontSize: "1.25rem",
          lineHeight: 1.4,
          color: "#1e293b",
          fontWeight: 700,
          textWrap: "balance",
        }}
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

export default function ClassroomsTab() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";

  return (
    <div className="px-8 py-8 space-y-12 w-full">
      <Section
        title={t("teacherDashboard.classroomsTab.section1")}
        gifUrl={GIF_SECTION1_URL}
        gifAlt={t("teacherDashboard.classroomsTab.gifAlt1")}
        isEn={isEn}
      />
      <Section
        title={t("teacherDashboard.classroomsTab.section2")}
        gifUrl={GIF_SECTION2_URL}
        gifAlt={t("teacherDashboard.classroomsTab.gifAlt2")}
        isEn={isEn}
      />
      <Section
        title={t("teacherDashboard.classroomsTab.section3")}
        gifUrl={GIF_SECTION3_URL}
        gifAlt={t("teacherDashboard.classroomsTab.gifAlt3")}
        isEn={isEn}
      />
      <Section
        title={t("teacherDashboard.classroomsTab.section4")}
        gifUrl={GIF_SECTION4_URL}
        gifAlt={t("teacherDashboard.classroomsTab.gifAlt4")}
        isEn={isEn}
      />
    </div>
  );
}
