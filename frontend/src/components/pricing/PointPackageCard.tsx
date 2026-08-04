import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gift, ShoppingCart } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface PointPackage {
  id: string;
  points: number;
  price: number;
  bonusPoints: number;
  unitCost: number;
  bestValue?: boolean;
}

interface PointPackageCardProps {
  pkg: PointPackage;
  onSelect?: (pkg: PointPackage) => void;
  disabled?: boolean;
  ctaText: string;
  baseUnitCost: number; // highest unit cost for discount calculation
  // issue #983-5：團購成員的加購折扣（0.85/0.90/0.95）；有值時顯示折後價。
  // 折後價 = round(price × groupBuyDiscount)，與後端 /credit-packages/purchase
  // 的 ROUND_HALF_UP 一致（正數 Math.round 即 round-half-up）。null=原價。
  groupBuyDiscount?: number | null;
}

export function PointPackageCard({
  pkg,
  onSelect,
  disabled,
  ctaText,
  baseUnitCost,
  groupBuyDiscount,
}: PointPackageCardProps) {
  const { t } = useTranslation();
  const discountPercent =
    baseUnitCost > pkg.unitCost
      ? Math.round(((baseUnitCost - pkg.unitCost) / baseUnitCost) * 100)
      : 0;

  const hasGbDiscount =
    typeof groupBuyDiscount === "number" &&
    groupBuyDiscount > 0 &&
    groupBuyDiscount < 1;
  const discountedPrice = hasGbDiscount
    ? Math.round(pkg.price * (groupBuyDiscount as number))
    : pkg.price;
  const gbOffPercent = hasGbDiscount
    ? Math.round((1 - (groupBuyDiscount as number)) * 100)
    : 0;

  const greenGradient =
    "linear-gradient(145deg, #15803d, #22c55e, #6ee7a0, #22c55e, #15803d)";

  const cardStyle = pkg.bestValue
    ? {
        backgroundImage: `linear-gradient(white, white), ${greenGradient}`,
        backgroundOrigin: "border-box" as const,
        backgroundClip: "padding-box, border-box",
        boxShadow: "0 0 18px rgba(34,197,94,0.35)",
      }
    : undefined;

  return (
    <Card
      className={`relative p-6 hover:shadow-xl transition-all duration-300 flex flex-col ${
        pkg.bestValue ? "border-2 border-transparent" : ""
      }`}
      style={cardStyle}
    >
      {pkg.bestValue && (
        <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-green-500 text-white">
          {t("pricing.pointPackages.bestValue")}
        </Badge>
      )}

      <div className="text-center flex-1 flex flex-col">
        {/* Points */}
        <h3 className="text-xl font-bold text-gray-900 mb-1">
          {pkg.points.toLocaleString()} {t("pricing.pointPackages.points")}
        </h3>

        {/* Bonus */}
        {pkg.bonusPoints > 0 && (
          <div className="flex items-center justify-center gap-1 text-green-600 text-sm font-medium mb-3">
            <Gift className="w-4 h-4" />
            <span>
              {t("pricing.pointPackages.bonusPoints", {
                count: pkg.bonusPoints,
              })}
            </span>
          </div>
        )}
        {pkg.bonusPoints === 0 && (
          <div className="flex items-center justify-center gap-1 text-transparent text-sm font-medium mb-3">
            <Gift className="w-4 h-4" />
            <span>&nbsp;</span>
          </div>
        )}

        {/* Price */}
        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          {hasGbDiscount ? (
            <>
              <div className="text-2xl font-bold text-blue-600">
                NT$ {discountedPrice.toLocaleString()}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                <span className="line-through">
                  NT$ {pkg.price.toLocaleString()}
                </span>{" "}
                <span className="text-blue-600 font-medium">
                  {t("pricing.pointPackages.groupBuyDiscount", {
                    percent: gbOffPercent,
                  })}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-gray-900">
                NT$ {pkg.price.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {pkg.unitCost.toFixed(2)} {t("pricing.pointPackages.unitCost")}
              </div>
            </>
          )}
        </div>

        {/* Discount Badge */}
        {discountPercent > 0 && (
          <div className="mb-3">
            <Badge
              variant="outline"
              className="text-orange-600 border-orange-300"
            >
              {t("pricing.pointPackages.discount", {
                percent: discountPercent,
              })}
            </Badge>
          </div>
        )}

        {/* Spacer to push button to bottom */}
        <div className="flex-1" />

        {/* Validity */}
        <p className="text-xs text-gray-400 mb-4">
          {t("pricing.pointPackages.validity")}
        </p>

        <Button
          onClick={() => onSelect?.(pkg)}
          disabled={disabled}
          variant={pkg.bestValue ? "default" : "outline"}
          className={`w-full ${
            pkg.bestValue ? "bg-green-600 hover:bg-green-700 text-white" : ""
          }`}
        >
          <ShoppingCart className="mr-2 h-4 w-4" />
          {ctaText}
        </Button>
      </div>
    </Card>
  );
}
