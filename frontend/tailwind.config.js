/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // #1046: src/index.css 的 @layer base 老早就定義了整組 shadcn CSS 變數
      // （--primary、--muted、--accent…），但這裡一直沒有把它們接成 colors，
      // 導致 bg-primary / bg-muted / text-muted-foreground 這類 class 根本不會
      // 被 Tailwind 產生出來 —— 編譯整包 CSS 後那些選擇器是 0 條規則。
      //
      // 症狀是元件「沒有顏色」而不是「顏色錯誤」，所以過去是一個一個元件硬寫
      // 顏色繞過去（button.tsx 甚至疊了一整套 fallback variants）。實際踩到的
      // 例子：學生答題畫面的進度條軌道與填色都是 transparent，整條隱形。
      //
      // 這裡補上對應關係，讓語意 class 真正生效。既有那些硬寫顏色不必移除 ——
      // cn() 是 twMerge，呼叫端與後寫的 class 仍然勝出，外觀不受影響。
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
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
