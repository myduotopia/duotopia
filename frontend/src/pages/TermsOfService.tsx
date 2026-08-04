import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function TermsOfService() {
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
            {t("termsOfService.header.title")}
          </h1>
          <p className="text-sm text-gray-600 mb-8 text-center">
            {t("termsOfService.header.lastUpdated")}
          </p>

          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-6 text-gray-700">
              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section1.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section1.item1")}</p>
                  <p>{t("termsOfService.section1.item2")}</p>
                  <p>{t("termsOfService.section1.item3")}</p>
                  <p>{t("termsOfService.section1.item4")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section2.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section2.item1")}</p>
                  <p>{t("termsOfService.section2.item2")}</p>
                  <p>{t("termsOfService.section2.item3")}</p>
                  <p>{t("termsOfService.section2.item4")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section3.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section3.item1")}</p>
                  <p>{t("termsOfService.section3.item2")}</p>
                  <p>{t("termsOfService.section3.item3")}</p>
                  <p>{t("termsOfService.section3.item4")}</p>
                  <p>{t("termsOfService.section3.item5")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section4.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section4.item1")}</p>
                  <p>{t("termsOfService.section4.item2")}</p>
                  <p>{t("termsOfService.section4.item3")}</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>{t("termsOfService.section4.list.item1")}</li>
                    <li>{t("termsOfService.section4.list.item2")}</li>
                    <li>{t("termsOfService.section4.list.item3")}</li>
                    <li>{t("termsOfService.section4.list.item4")}</li>
                  </ul>
                  <p>{t("termsOfService.section4.item4")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section5.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section5.item1")}</p>
                  <p>{t("termsOfService.section5.item2")}</p>
                  <p>{t("termsOfService.section5.item3")}</p>
                  <p>{t("termsOfService.section5.item4")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section6.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section6.item1")}</p>
                  <p>{t("termsOfService.section6.item2")}</p>
                  <p>{t("termsOfService.section6.item3")}</p>
                  <p>{t("termsOfService.section6.item4")}</p>
                  <p>{t("termsOfService.section6.item5")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section7.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section7.item1")}</p>
                  <p>{t("termsOfService.section7.item2")}</p>
                  <p>{t("termsOfService.section7.item3")}</p>
                  <p>{t("termsOfService.section7.item4")}</p>
                  <p>{t("termsOfService.section7.item5")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section8.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section8.item1")}</p>
                  <p>{t("termsOfService.section8.item2")}</p>
                  <p>{t("termsOfService.section8.item3")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section9.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section9.item1")}</p>
                  <p>{t("termsOfService.section9.item2")}</p>
                </div>
              </section>

              <section id="data-deletion" className="scroll-mt-4">
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.dataDeletion.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.dataDeletion.item1")}</p>
                  <p>{t("termsOfService.dataDeletion.item2")}</p>
                  <p>{t("termsOfService.dataDeletion.item3")}</p>
                  <p>{t("termsOfService.dataDeletion.item4")}</p>
                  <p>{t("termsOfService.dataDeletion.item5")}</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold mb-3">
                  {t("termsOfService.section10.title")}
                </h2>
                <div className="space-y-2 text-sm">
                  <p>{t("termsOfService.section10.company")}</p>
                  <p>{t("termsOfService.section10.taxId")}</p>
                  <p>{t("termsOfService.section10.contactPrompt")}</p>
                  <p>{t("termsOfService.section10.email")}</p>
                </div>
              </section>
            </div>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
