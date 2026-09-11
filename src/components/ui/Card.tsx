import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
};

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export function Card({ children, className = "", hover, padding = "md" }: CardProps) {
  return (
    <div
      className={`
        border border-line bg-paper
        ${hover ? "transition-shadow duration-200 hover:shadow-lg hover:shadow-ink/5" : ""}
        ${paddingMap[padding]}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
