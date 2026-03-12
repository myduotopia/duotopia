import { ChevronRight, Home } from "lucide-react";
import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb - Navigation breadcrumb component
 * Shows current location in the organization portal hierarchy
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="flex items-center space-x-2 text-sm text-gray-600 mb-4">
      <Home className="h-4 w-4 text-gray-400" />

      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div key={index} className="flex items-center space-x-2">
            <ChevronRight className="h-4 w-4 text-gray-400" />
            {item.href ? (
              <Link
                to={item.href}
                className={
                  isLast
                    ? "font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    : "hover:text-gray-900 transition-colors"
                }
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "font-medium text-gray-900" : ""}>
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
