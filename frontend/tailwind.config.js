/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Issue #892 朗讀作答畫面改版 — design tokens（來源：issue 視覺語言表，
        // 非 .pen 檔殘留的 accent/primary 變數）。朗讀作答頁屬固定米色場景，
        // 不隨全站 dark mode 切換，故用固定 hex 而非 shadcn HSL 變數。
        recording: {
          bg: "#F5F1EA", // 米色頁面背景
          card: "#FFFFFF", // 白色卡片
          "card-soft": "#FFF8EE", // 卡片柔和變體
          accent: "#F97316", // 橘 — 錄音強調
          "accent-soft": "#FFE7D1", // 橘 — POS 徽章底
          "accent-deep": "#C2410C", // 橘 — POS 徽章字
          rerecord: "#2563EB", // 藍 — 評測後重錄
          upload: "#8B5CF6", // 紫 — 上傳分析
          danger: "#EF4444", // 紅 — 錄音中 / 未通過 / 紅字
          pass: "#10B981", // 綠 — 通過
          warn: "#F59E0B", // 黃 — 提醒
          "text-primary": "#1F2937",
          "text-secondary": "#6B7280",
          "text-translation": "#9CA3AF",
          border: "#E5E0D5",
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  // eslint-disable-next-line no-undef
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
}
