import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function PrivacyPolicy() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card className="p-8">
          <h1 className="text-3xl font-bold mb-4 text-center">
            {t("privacyPolicy.header.title")}
          </h1>
          <p className="text-sm text-gray-600 mb-8 text-center">
            {t("privacyPolicy.header.lastUpdated")}
          </p>

          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-6 text-gray-700">
              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section1.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section1.item1")}</p>
                  <p>{t("privacyPolicy.section1.item2")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section2.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section2.item1")}</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>{t("privacyPolicy.section2.list.item1")}</li>
                    <li>{t("privacyPolicy.section2.list.item2")}</li>
                    <li>{t("privacyPolicy.section2.list.item3")}</li>
                    <li>{t("privacyPolicy.section2.list.item4")}</li>
                    <li>{t("privacyPolicy.section2.list.item5")}</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section3.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section3.item1")}</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>{t("privacyPolicy.section3.list.item1")}</li>
                    <li>{t("privacyPolicy.section3.list.item2")}</li>
                    <li>{t("privacyPolicy.section3.list.item3")}</li>
                    <li>{t("privacyPolicy.section3.list.item4")}</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section4.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section4.item1")}</p>
                  <p>{t("privacyPolicy.section4.item2")}</p>
                  <p>{t("privacyPolicy.section4.item3")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section5.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section5.item1")}</p>
                  <p>{t("privacyPolicy.section5.item2")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section6.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section6.item1")}</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>{t("privacyPolicy.section6.list.item1")}</li>
                    <li>{t("privacyPolicy.section6.list.item2")}</li>
                    <li>{t("privacyPolicy.section6.list.item3")}</li>
                    <li>{t("privacyPolicy.section6.list.item4")}</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section7.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section7.item1")}</p>
                  <p>{t("privacyPolicy.section7.item2")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section8.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section8.item1")}</p>
                  <p>{t("privacyPolicy.section8.item2")}</p>
                  <p>{t("privacyPolicy.section8.item3")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section9.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section9.item1")}</p>
                  <p>{t("privacyPolicy.section9.item2")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section10.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section10.item1")}</p>
                  <p>{t("privacyPolicy.section10.item2")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("privacyPolicy.section11.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("privacyPolicy.section11.item1")}</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>{t("privacyPolicy.section11.list.item1")}</li>
                    <li>{t("privacyPolicy.section11.list.item2")}</li>
                    <li>{t("privacyPolicy.section11.list.item3")}</li>
                  </ul>
                  <p>{t("privacyPolicy.section11.item2")}</p>
                  <p>{t("privacyPolicy.section11.item3")}</p>
                </div>
              </section>
            </div>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
