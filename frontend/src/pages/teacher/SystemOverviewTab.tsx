import { useTranslation } from "react-i18next";

function AiBadge() {
  return (
    <div
      className="absolute -top-3 -right-3 z-10 w-12 h-12 rounded-full flex flex-col items-center justify-center select-none"
      style={{
        background:
          "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)",
        boxShadow:
          "0 2px 8px rgba(99,102,241,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
      }}
    >
      <span
        style={{
          fontSize: "0.65rem",
          color: "rgba(255,255,255,0.7)",
          lineHeight: 1,
        }}
      >
        ✦
      </span>
      <span
        style={{
          fontSize: "0.85rem",
          fontWeight: 800,
          color: "white",
          letterSpacing: "0.05em",
          lineHeight: 1,
        }}
      >
        AI
      </span>
    </div>
  );
}

function MemoryBadge() {
  return (
    <div
      className="absolute -top-3 -left-3 z-10 w-12 h-12 rounded-full flex flex-col items-center justify-center select-none"
      style={{
        background:
          "linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)",
        boxShadow:
          "0 2px 8px rgba(16,185,129,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
      }}
    >
      <span
        style={{
          fontSize: "1.35rem",
          fontWeight: 700,
          color: "white",
          lineHeight: 1,
        }}
      >
        ∞
      </span>
    </div>
  );
}

interface SectionProps {
  title: string;
  imageSrc?: string;
  imageAlt: string;
  isEn?: boolean;
  showAiBadge?: boolean;
  showMemoryBadge?: boolean;
}

function Section({
  title,
  imageSrc,
  imageAlt,
  isEn = false,
  showAiBadge = false,
  showMemoryBadge = false,
}: SectionProps) {
  return (
    <div className="flex flex-col gap-4 items-center">
      <p
        className="w-3/4 text-center"
        style={
          isEn
            ? {
                fontFamily: "'Caveat', 'Dancing Script', cursive",
                fontSize: "1.6rem",
                lineHeight: 1.3,
                color: "#1e293b",
                fontWeight: 600,
              }
            : {
                fontSize: "1.25rem",
                lineHeight: 1.4,
                color: "#1e293b",
                fontWeight: 700,
              }
        }
      >
        {title}
      </p>

      <div className="relative w-3/4">
        {showAiBadge && <AiBadge />}
        {showMemoryBadge && <MemoryBadge />}
        {imageSrc ? (
          <img src={imageSrc} alt={imageAlt} className="w-full" />
        ) : (
          <div
            className="w-full rounded-2xl flex items-center justify-center text-slate-300 text-sm border-2 border-dashed border-slate-200"
            style={{ minHeight: "200px", background: "#f8fafc" }}
          >
            {imageAlt}
          </div>
        )}
      </div>
    </div>
  );
}

interface ArrowProps {
  src?: string;
  rotate?: number;
  flipX?: boolean;
  className?: string;
}

function Arrow({ src, rotate = 0, flipX = false, className = "" }: ArrowProps) {
  const transform = [`rotate(${rotate}deg)`, flipX ? "scaleX(-1)" : ""]
    .filter(Boolean)
    .join(" ");

  if (!src) {
    return (
      <div className={`flex justify-center opacity-30 ${className}`}>
        <svg
          width="60"
          height="80"
          viewBox="0 0 60 80"
          fill="none"
          style={{ transform }}
        >
          <path
            d="M30 0 C30 0 10 30 30 50 C50 70 30 80 30 80"
            stroke="#64748b"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <polyline
            points="20,70 30,80 40,70"
            stroke="#64748b"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`flex justify-center ${className}`}>
      <img
        src={src}
        alt="arrow"
        className="w-16 h-auto"
        style={{ transform }}
      />
    </div>
  );
}

export default function SystemOverviewTab() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";

  return (
    <div className="px-8 py-8 space-y-8 w-full">
      <Section
        title={t("teacherDashboard.systemOverview.section1")}
        imageSrc="https://storage.googleapis.com/duotopia-social-media-videos/website/systemoverview-01.png"
        imageAlt={t("teacherDashboard.systemOverview.imgAlt1")}
        isEn={isEn}
        showAiBadge
      />

      {/* Arrow 1: right side, no flip */}
      <Arrow
        src="https://storage.googleapis.com/duotopia-social-media-videos/website/handwritingarrow.png"
        className="ml-auto mr-6"
      />

      <Section
        title={t("teacherDashboard.systemOverview.section2")}
        imageSrc="https://storage.googleapis.com/duotopia-social-media-videos/website/systemoverview-02.png"
        imageAlt={t("teacherDashboard.systemOverview.imgAlt2")}
        isEn={isEn}
        showMemoryBadge
      />

      {/* Arrow 2: left side, flipX */}
      <Arrow
        src="https://storage.googleapis.com/duotopia-social-media-videos/website/handwritingarrow.png"
        flipX
        className="ml-6 mr-auto"
      />

      <Section
        title={t("teacherDashboard.systemOverview.section3")}
        imageSrc="https://storage.googleapis.com/duotopia-social-media-videos/website/systemoverview-03.png"
        imageAlt={t("teacherDashboard.systemOverview.imgAlt3")}
        isEn={isEn}
        showAiBadge
      />
    </div>
  );
}
