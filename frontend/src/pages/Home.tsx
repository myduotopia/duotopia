import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { getTeacherDashboardRoute } from "@/utils/authNavigation";
import {
  Mic,
  GraduationCap,
  X,
  Puzzle,
  BookOpen,
  CheckSquare,
  Headphones,
} from "lucide-react";
import { DemoCard } from "@/components/DemoCard";
import { ImageCarousel } from "@/components/ImageCarousel";
import { demoApi } from "@/lib/demoApi";
import { toast } from "sonner";
import TeacherLoginSheet from "@/components/TeacherLoginSheet";

type DemoType =
  | "reading"
  | "rearrangement"
  | "vocabulary"
  | "wordSelectionListening"
  | "wordSelectionWriting";

interface DemoConfig {
  demo_reading_assignment_id?: string;
  demo_rearrangement_assignment_id?: string;
  demo_vocabulary_assignment_id?: string;
  demo_word_selection_listening_assignment_id?: string;
  demo_word_selection_writing_assignment_id?: string;
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isEn = i18n.language === "en";
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [isTeacherLoginOpen, setIsTeacherLoginOpen] = useState(false);

  const { isAuthenticated: isTeacherAuth, user: teacherUser } =
    useTeacherAuthStore();
  const { isAuthenticated: isStudentAuth } = useStudentAuthStore();

  // Demo section state
  const [demoConfig, setDemoConfig] = useState<DemoConfig | null>(null);

  // Fetch demo config on mount
  useEffect(() => {
    const fetchDemoConfig = async () => {
      try {
        const config = await demoApi.getConfig();
        setDemoConfig(config);
      } catch (error) {
        console.error("Failed to load demo config:", error);
        // Don't show error toast on homepage, just hide demo section
      }
    };

    fetchDemoConfig();
  }, []);

  // Open demo in new tab
  const openDemoInNewTab = (type: DemoType) => {
    if (!demoConfig) {
      toast.error(t("demo.configError"));
      return;
    }

    const assignmentIdMap: Record<DemoType, string | undefined> = {
      reading: demoConfig.demo_reading_assignment_id,
      rearrangement: demoConfig.demo_rearrangement_assignment_id,
      vocabulary: demoConfig.demo_vocabulary_assignment_id,
      wordSelectionListening:
        demoConfig.demo_word_selection_listening_assignment_id,
      wordSelectionWriting:
        demoConfig.demo_word_selection_writing_assignment_id,
    };

    const assignmentId = assignmentIdMap[type];
    if (!assignmentId) {
      toast.error(t("demo.notAvailable"));
      return;
    }

    window.open(`/demo/${assignmentId}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-white">
      {/* 第一區段: Header - 白色背景 */}
      <header className="bg-white py-3 px-3 sm:py-4 sm:px-6 flex items-center justify-between shadow-sm">
        <img
          src="https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png"
          alt={t("home.header.logo")}
          className="h-8 sm:h-10"
        />
        <div className="flex items-center gap-1.5 sm:gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (isTeacherAuth && teacherUser) {
                navigate(getTeacherDashboardRoute(teacherUser));
              } else {
                setIsTeacherLoginOpen(true);
              }
            }}
            className="text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
          >
            {isTeacherAuth
              ? t("home.header.teacherDashboard", "教師後台")
              : t("home.header.teacherLogin")}
          </Button>
          {isStudentAuth ? (
            <Link to="/student/dashboard">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
              >
                {t("home.header.studentDashboard", "學生專區")}
              </Button>
            </Link>
          ) : (
            <Link to="/student/login">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-xs sm:text-sm px-2 sm:px-3 h-8 sm:h-9"
              >
                {t("home.header.studentLogin")}
              </Button>
            </Link>
          )}
          <LanguageSwitcher />
        </div>
      </header>

      {/* 第二區段: Hero - 漸層背景 */}
      <section className="bg-gradient-to-b from-[#204dc0] to-[#101f6b] text-white py-20">
        <div className="container mx-auto px-4 sm:px-8 lg:px-16">
          <div className="grid lg:grid-cols-2 gap-8 xl:gap-10 min-[1440px]:gap-12 items-center max-w-6xl mx-auto">
            {/* 左側文案 */}
            <div className="text-center">
              <p className="text-yellow-400 mb-2 text-base lg:text-lg font-medium">
                {t("home.hero.tagline")}
              </p>
              <p className="text-yellow-400 text-base lg:text-lg font-medium mb-2">
                <span className="bg-white/20 text-white font-bold px-1.5 py-0.5 rounded">
                  {t("home.hero.preClass")}
                </span>
                {t("home.hero.preClassDesc")}
                <span className="bg-white/20 text-white font-bold px-1.5 py-0.5 rounded">
                  {t("home.hero.inClass")}
                </span>
                {t("home.hero.inClassDesc")}
                <span className="bg-white/20 text-white font-bold px-1.5 py-0.5 rounded">
                  {t("home.hero.postClass")}
                </span>
                {t("home.hero.postClassDesc")}
              </p>
              <h1 className="mb-4 flex justify-center">
                <img
                  src="https://storage.googleapis.com/duotopia-social-media-videos/website/whitelogoword.png"
                  alt={t("home.hero.brand")}
                  className="h-[60px] lg:h-[80px] min-[1440px]:h-[100px]"
                />
              </h1>
              <h2
                className={`mb-4 text-blue-100 ${isEn ? "text-base lg:text-lg min-[1440px]:text-xl" : "text-lg lg:text-xl min-[1440px]:text-2xl"}`}
              >
                {t("home.hero.subtitle")}
              </h2>
              <p
                className={`font-bold mb-8 text-yellow-400 ${isEn ? "text-lg lg:text-xl min-[1440px]:text-2xl" : "text-xl lg:text-2xl min-[1440px]:text-3xl"}`}
              >
                {t("home.hero.description")}
              </p>

              {/* 按鈕區域 */}
              <div className="flex flex-wrap gap-4 justify-center">
                {/* 免費體驗按鈕 */}
                <Link to="/teacher/register">
                  <Button
                    size="lg"
                    className="bg-white text-gray-900 hover:bg-gray-100 px-8 py-6 text-lg font-semibold shadow-xl"
                  >
                    <img
                      src="https://storage.googleapis.com/duotopia-social-media-videos/website/assigment_icon.png"
                      alt=""
                      className="w-6 h-6 mr-2"
                    />
                    {t("home.hero.freeTrialBtn")}
                  </Button>
                </Link>

                {/* 教育機構方案按鈕 */}
                <a
                  href="https://forms.gle/azFtAQCW13afA8ab6"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-2 border-white text-white hover:bg-white hover:text-blue-700 px-8 py-[22px] text-lg font-semibold transition-colors"
                  >
                    <GraduationCap className="w-5 h-5 mr-2" />
                    {t("home.hero.eduPlan")}
                  </Button>
                </a>
              </div>

              {/* 教師頭像 + 統計 */}
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-center sm:text-left">
                <div className="flex -space-x-3">
                  {[1, 2, 3, 4].map((i) => (
                    <img
                      key={i}
                      src={`https://storage.googleapis.com/duotopia-social-media-videos/website/teacherprofile_0${i}.png`}
                      alt={`Teacher ${i}`}
                      className="w-10 h-10 rounded-full border-2 border-white"
                    />
                  ))}
                </div>
                <div>
                  <p className="font-semibold text-sm sm:text-base">
                    {t("home.hero.trustedTeachers")}
                  </p>
                  <p className="text-blue-200 text-xs sm:text-sm">
                    {t("home.hero.studentsImproved")}
                  </p>
                </div>
              </div>
            </div>

            {/* 右側圖片 */}
            <div className="hidden lg:flex lg:justify-end lg:items-center">
              <img
                src="https://storage.googleapis.com/duotopia-social-media-videos/website/girlspeaksenglish.png"
                alt="Girl speaks English"
                className="max-w-[208px] sm:max-w-[240px] lg:max-w-[312px] xl:max-w-[368px] min-[1440px]:max-w-[424px] h-auto drop-shadow-[0_0_40px_rgba(255,255,255,0.25)]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Demo 體驗區 - 移到登入區下方 */}
      {demoConfig && (
        <section className="py-16 bg-blue-50">
          <div className="container mx-auto px-4">
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-10">
                <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
                  {t("home.demo.title")}
                </h2>
                <p className="text-xl text-gray-600">
                  {t("home.demo.subtitle")}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 例句朗讀 */}
                <DemoCard
                  icon={<Mic className="h-7 w-7" />}
                  title={t("home.demo.reading.title")}
                  description={t("home.demo.reading.description")}
                  onClick={() => openDemoInNewTab("reading")}
                  gradient="from-blue-500 to-indigo-600"
                  disabled={!demoConfig.demo_reading_assignment_id}
                />

                {/* 例句重組 */}
                <DemoCard
                  icon={<Puzzle className="h-7 w-7" />}
                  title={t("home.demo.rearrangement.title")}
                  description={t("home.demo.rearrangement.description")}
                  onClick={() => openDemoInNewTab("rearrangement")}
                  gradient="from-green-500 to-emerald-600"
                  disabled={!demoConfig.demo_rearrangement_assignment_id}
                />

                {/* 單字朗讀 */}
                <DemoCard
                  icon={<BookOpen className="h-7 w-7" />}
                  title={t("home.demo.vocabulary.title")}
                  description={t("home.demo.vocabulary.description")}
                  onClick={() => openDemoInNewTab("vocabulary")}
                  gradient="from-purple-500 to-pink-600"
                  disabled={!demoConfig.demo_vocabulary_assignment_id}
                />

                {/* 單字聽力選擇 */}
                <DemoCard
                  icon={<Headphones className="h-7 w-7" />}
                  title={t("home.demo.wordSelectionListening.title")}
                  description={t(
                    "home.demo.wordSelectionListening.description",
                  )}
                  onClick={() => openDemoInNewTab("wordSelectionListening")}
                  gradient="from-orange-500 to-red-600"
                  disabled={
                    !demoConfig.demo_word_selection_listening_assignment_id
                  }
                />

                {/* 單字選擇 */}
                <DemoCard
                  icon={<CheckSquare className="h-7 w-7" />}
                  title={t("home.demo.wordSelectionWriting.title")}
                  description={t("home.demo.wordSelectionWriting.description")}
                  onClick={() => openDemoInNewTab("wordSelectionWriting")}
                  gradient="from-teal-500 to-cyan-600"
                  disabled={
                    !demoConfig.demo_word_selection_writing_assignment_id
                  }
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 第四區段: 為什麼選擇 Duotopia */}
      <section id="features" className="py-20 lg:py-28">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                {t("home.features.title")}
              </h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                {t("home.features.subtitle")}
              </p>
            </div>

            <ImageCarousel
              images={[
                {
                  src: "https://storage.googleapis.com/duotopia-social-media-videos/website/whyus01.png",
                  caption: t("home.features.carousel.captions.orgMaterial"),
                },
                {
                  src: "https://storage.googleapis.com/duotopia-social-media-videos/website/whyus03.png",
                  caption: t("home.features.carousel.captions.forgettingCurve"),
                },
                {
                  src: "https://storage.googleapis.com/duotopia-social-media-videos/website/whyus04.jpg",
                  caption: t("home.features.carousel.captions.aiGrading"),
                },
                {
                  src: "https://storage.googleapis.com/duotopia-social-media-videos/website/whyus05.png",
                  caption: t("home.features.carousel.captions.speakingWriting"),
                },
                {
                  src: "https://storage.googleapis.com/duotopia-social-media-videos/website/whyus06.png",
                  caption: t("home.features.carousel.captions.anyMaterial"),
                },
                {
                  src: "https://storage.googleapis.com/duotopia-social-media-videos/website/whyus07.png",
                  caption: t("home.features.carousel.captions.moreFeatures"),
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-4 gap-8">
              <div>
                <h3 className="text-white text-lg font-bold mb-4">
                  {t("home.hero.brand")}
                </h3>
                <p className="text-sm mb-4">{t("home.footer.description")}</p>
                <div className="text-sm">
                  <p className="text-gray-400 mb-1">
                    {t("home.footer.contact")}
                  </p>
                  <a
                    href="mailto:contact@duotopia.co"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    contact@duotopia.co
                  </a>
                </div>
              </div>
              <div>
                <h4 className="text-white font-semibold mb-4">
                  {t("home.footer.product")}
                </h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <a href="#features" className="hover:text-white">
                      {t("home.footer.features")}
                    </a>
                  </li>
                  <li>
                    <Link to="/pricing" className="hover:text-white">
                      {t("home.footer.pricing")}
                    </Link>
                  </li>
                  <li>
                    <a
                      href="https://forms.gle/azFtAQCW13afA8ab6"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white"
                    >
                      {t("home.footer.eduPlan")}
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-semibold mb-4">
                  {t("home.footer.support")}
                </h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <button
                      onClick={() => setIsVideoModalOpen(true)}
                      className="hover:text-white"
                    >
                      {t("home.footer.tutorial")}
                    </button>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-semibold mb-4">
                  {t("home.footer.company")}
                </h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <a href="#" className="hover:text-white">
                      {t("home.footer.about")}
                    </a>
                  </li>
                  <li>
                    <Link to="/privacy" className="hover:text-white">
                      {t("home.footer.privacy")}
                    </Link>
                  </li>
                  <li>
                    <Link to="/terms" className="hover:text-white">
                      {t("home.footer.terms")}
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-gray-800 text-center text-sm">
              <p>{t("home.footer.copyright")}</p>
            </div>
          </div>
        </div>
      </footer>

      {/* 影片彈窗 Modal */}
      {isVideoModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setIsVideoModalOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 關閉按鈕 */}
            <button
              onClick={() => setIsVideoModalOpen(false)}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
              aria-label="Close video"
            >
              <X className="w-8 h-8" />
            </button>

            {/* YouTube 影片嵌入 */}
            <div className="relative pt-[56.25%] bg-black rounded-lg overflow-hidden">
              <iframe
                className="absolute inset-0 w-full h-full"
                src="https://www.youtube.com/embed/m2jfog0EvXo?list=PLu97PbZuQSs0nK6raEQmCj5Fj_0YxExt2&autoplay=1"
                title="Duotopia 介紹影片"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

      {/* Meta Messenger 浮動按鈕 */}
      <a
        href="https://m.me/duotopia"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-[#0084FF] hover:bg-[#0073E6] rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-110"
        aria-label="Meta Messenger 客服"
      >
        <svg viewBox="0 0 36 36" fill="white" className="w-7 h-7">
          <path d="M18 2.1C9.1 2.1 2 8.6 2 16.6c0 4.6 2.3 8.6 5.8 11.2V34l5.7-3.1c1.5.4 3 .6 4.5.6 8.9 0 16-6.5 16-14.5S26.9 2.1 18 2.1zm1.6 19.5l-4.1-4.3-7.9 4.3 8.7-9.2 4.2 4.3 7.8-4.3-8.7 9.2z" />
        </svg>
      </a>

      {/* 教師登入 Sheet */}
      <TeacherLoginSheet
        isOpen={isTeacherLoginOpen}
        onClose={() => setIsTeacherLoginOpen(false)}
      />
    </div>
  );
}
