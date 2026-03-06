import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative w-full sm:w-64">
        <select
          ref={ref}
          className={cn(
            "bg-background border-input ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring h-10 w-full appearance-none rounded-md border px-3 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
      </div>
    );
  },
);

Select.displayName = "Select";

export { Select };
