import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/utils.js";
import { type VariantProps, cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(
          buttonVariants({ variant, size }),
          // Default fallback styles with dark mode support
          (variant === "default" || !variant) &&
            !className?.includes("bg-") &&
            "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600",
          variant === "outline" &&
            !className?.includes("bg-") &&
            // hover:text-* 是必要的：cva 那邊的 hover:text-accent-foreground
            // 過去因為 tailwind 沒有 colors 而是死 class，#1046 接上 token 後
            // 會真的生效。它沒有 dark 變體，深色模式 hover 會變成近黑字疊在
            // dark:hover:bg-gray-700 上，對比不足。這裡明確蓋掉，維持原本行為。
            "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-200",
          variant === "secondary" &&
            !className?.includes("bg-") &&
            "bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600",
          variant === "ghost" &&
            !className?.includes("bg-") &&
            // 同上：ghost 沒有指定文字色（繼承父層），用 hover:text-inherit
            // 蓋掉 cva 的 hover:text-accent-foreground，hover 時文字不變色。
            "hover:bg-gray-100 hover:text-inherit dark:hover:bg-gray-800",
          variant === "destructive" &&
            !className?.includes("bg-") &&
            "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
