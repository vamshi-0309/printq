import type { ReactNode } from "react";

type SectionProps = {
  children: ReactNode;
  className?: string;
  bg?: "paper" | "grey" | "ink";
  narrow?: boolean;
  id?: string;
};

const bgMap = {
  paper: "bg-paper",
  grey: "bg-paper-grey",
  ink: "bg-ink text-paper",
};

export function Section({ children, className = "", bg = "paper", narrow, id }: SectionProps) {
  return (
    <section id={id} className={`${bgMap[bg]} ${className}`}>
      <div className={`mx-auto px-5 sm:px-6 py-16 md:py-24 ${narrow ? "max-w-4xl" : "max-w-6xl"}`}>
        {children}
      </div>
    </section>
  );
}
