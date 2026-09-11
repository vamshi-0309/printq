"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Print settings, sized for one hand on a phone.
 *
 * Every control is a real tap target (44px minimum) rather than a native
 * <select>, so the whole form is visible at a glance and nothing hides behind
 * a picker wheel. The selected segment animates with a shared layout element,
 * which reads as the highlight sliding rather than blinking between options.
 */

export type ColorMode = "bw" | "color";
export type PaperSize = "A4" | "A3";
export type Sides = "single" | "double";

export type Options = {
  copies: number;
  colorMode: ColorMode;
  paperSize: PaperSize;
  sides: Sides;
};

export function PrintOptions({
  value,
  onChange,
  enabledPaperSizes,
  disabled,
}: {
  value: Options;
  onChange: (next: Options) => void;
  enabledPaperSizes: PaperSize[];
  disabled?: boolean;
}) {
  const set = <K extends keyof Options>(key: K, v: Options[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className={`space-y-5 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <Field label="Copies">
        <Stepper
          value={value.copies}
          min={1}
          max={500}
          onChange={(n) => set("copies", n)}
        />
      </Field>

      <Field label="Colour">
        <Segmented
          name="colour"
          value={value.colorMode}
          onChange={(v) => set("colorMode", v as ColorMode)}
          options={[
            { value: "bw", label: "Black & white" },
            { value: "color", label: "Colour" },
          ]}
        />
      </Field>

      <Field label="Sides">
        <Segmented
          name="sides"
          value={value.sides}
          onChange={(v) => set("sides", v as Sides)}
          options={[
            { value: "single", label: "Single" },
            { value: "double", label: "Double" },
          ]}
        />
      </Field>

      {enabledPaperSizes.length > 1 && (
        <Field label="Paper size">
          <Segmented
            name="paper"
            value={value.paperSize}
            onChange={(v) => set("paperSize", v as PaperSize)}
            options={enabledPaperSizes.map((s) => ({ value: s, label: s }))}
          />
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Plus/minus stepper — no keyboard needed for the common 1-5 copies case. */
function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="inline-flex items-stretch border border-line">
      <StepButton onClick={() => onChange(clamp(value - 1))} disabled={value <= min} label="One fewer copy">
        &minus;
      </StepButton>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10) || min))}
        aria-label="Number of copies"
        className="w-14 border-x border-line bg-paper text-center font-data text-[15px] font-semibold text-ink [appearance:textfield] focus:outline-none focus:ring-2 focus:ring-cyan/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <StepButton onClick={() => onChange(clamp(value + 1))} disabled={value >= max} label="One more copy">
        +
      </StepButton>
    </div>
  );
}

function StepButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center text-lg text-ink transition-colors hover:bg-paper-grey active:bg-line disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Segmented({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const reduced = useReducedMotion();
  return (
    <div className="relative flex border border-line" role="radiogroup">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 px-3 py-3 text-[13.5px] font-medium transition-colors ${
              active ? "text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${name}`}
                className="absolute inset-0 bg-ink"
                transition={
                  reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }
                }
                aria-hidden="true"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
