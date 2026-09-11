/**
 * PrintQ marketing icon set.
 *
 * One stroke family for the whole marketing surface: 24x24 box, 1.5 stroke,
 * round caps/joins, `currentColor`. This replaces the emoji that were used on
 * the features / for-shops pages — emoji render differently per OS and broke
 * the "crisp and intentional" bar.
 *
 * Every icon is decorative, so each is marked aria-hidden at the source.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Flow ─────────────────────────────────────────────────────────── */

export function QrIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 21h1M21 14h-1" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5" />
    </Icon>
  );
}

export function RupeeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M8 13h4.5M8 15.5h4.5M12 13c0 1.6-1.3 2.5-3 2.5l3 2.5" />
    </Icon>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 9V3.5h10V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
      <path d="M17.5 12h1" />
    </Icon>
  );
}

/* ── Features ─────────────────────────────────────────────────────── */

export function MultiFileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v4h4" />
      <path d="M4 7v12a2 2 0 0 0 2 2h9" opacity={0.55} />
    </Icon>
  );
}

export function PhoneEditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="2.5" width="13" height="19" rx="2.5" />
      <path d="M10 5.5h4" />
      <path d="M9 15.5v-2l4.6-4.6a1.3 1.3 0 0 1 1.9 1.9L11 15.5z" />
    </Icon>
  );
}

export function PassportPhotoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <circle cx="12" cy="10" r="2.75" />
      <path d="M7 18.5c1-2.4 2.9-3.6 5-3.6s4 1.2 5 3.6" />
    </Icon>
  );
}

export function ResumeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="2.5" width="15" height="19" rx="1.5" />
      <circle cx="9.5" cy="8" r="1.75" />
      <path d="M13.5 7h3.5M13.5 10h3.5M7 14h10M7 17h6.5" />
    </Icon>
  );
}

export function PaperSizeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="4" width="12" height="16" rx="1.5" />
      <path d="M14.5 8h5a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5H14.5" opacity={0.55} />
      <path d="M6 9h5M6 12.5h5" />
    </Icon>
  );
}

export function DirectPayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="2.5" width="10" height="15" rx="2" />
      <path d="M7 5.5h4" />
      <path d="M13 17.5h6M16.5 15l2.5 2.5-2.5 2.5" />
    </Icon>
  );
}

export function AutoDeleteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2" />
      <path d="M6 6.5 6.9 19a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5" />
      <path d="M10 11v5M14 11v5" />
    </Icon>
  );
}

export function OfflineQueueIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="4" width="19" height="11" rx="2" />
      <path d="M8 19h8M12 15v4" />
      <path d="M7 8.5h4M7 11.5h5.5" opacity={0.6} />
      <path d="M15.5 7.5 18.5 10.5M18.5 7.5 15.5 10.5" />
    </Icon>
  );
}

/* ── Trust / privacy ──────────────────────────────────────────────── */

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.6 4.5 5.7v6c0 4.5 3.1 7.9 7.5 9.7 4.4-1.8 7.5-5.2 7.5-9.7v-6z" />
      <path d="M9 12.2l2.1 2.1L15.4 10" />
    </Icon>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3.5" width="18" height="7" rx="1.5" />
      <rect x="3" y="13.5" width="18" height="7" rx="1.5" />
      <path d="M6.5 7h.01M6.5 17h.01" />
      <path d="M10 7h5M10 17h5" opacity={0.6} />
    </Icon>
  );
}

export function DesktopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
      <path d="M6.5 13.5l2.5-3 2 2 2.5-3.5 3.5 4.5" opacity={0.6} />
    </Icon>
  );
}

/* ── Software showcase ────────────────────────────────────────────── */

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </Icon>
  );
}

export function QueueIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8.5h18" />
      <path d="M6.5 12h5M6.5 15.5h8" />
      <circle cx="17" cy="12" r="1.4" />
    </Icon>
  );
}

export function TrayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 13.5 5.5 5A2 2 0 0 1 7.4 3.5h9.2A2 2 0 0 1 18.5 5L21 13.5" />
      <path d="M3 13.5h5l1 2.5h6l1-2.5h5v4.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  );
}

/* ── Utility ──────────────────────────────────────────────────────── */

export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M8.2 12.2l2.6 2.6 5-5.2" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12H5M10.5 6.5 5 12l5.5 5.5" />
    </Icon>
  );
}

export function StarIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.44 6.19 20.5l1.1-6.47-4.69-4.58 6.5-.95z" />
    </svg>
  );
}

export function SoundOnIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M15.5 9.5a3.6 3.6 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </Icon>
  );
}

export function SoundOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </Icon>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 2.5 4.5 13.5H11l-.5 8L19 10.5h-6.5z" />
    </Icon>
  );
}

export function ShopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 9.5 5 4h14l1.5 5.5" />
      <path d="M3.5 9.5a2.6 2.6 0 0 0 4.25 1.9A2.6 2.6 0 0 0 12 11.4a2.6 2.6 0 0 0 4.25 0 2.6 2.6 0 0 0 4.25-1.9" />
      <path d="M5 12v8h14v-8" />
      <path d="M10 20v-4.5h4V20" />
    </Icon>
  );
}

export function PagesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3.5h7l4 4V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18V5a1.5 1.5 0 0 1 1-1.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 11.5h6M9 14.5h4" />
    </Icon>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 17a9 9 0 1 1 17 0" />
      <path d="M12 17l4-4.5" />
      <circle cx="12" cy="17" r="1.3" />
    </Icon>
  );
}

/* ── Neutral payment badges (pricing trust row) ───────────────────── */

export function CardBadgeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h3.5" />
    </Icon>
  );
}

export function UpiBadgeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10 5.5h4" />
      <path d="M9.5 12.5h5M12 10v5" />
    </Icon>
  );
}

export function LockBadgeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <path d="M12 14v2.5" />
    </Icon>
  );
}

export function BankBadgeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5.5 9.5v8M10 9.5v8M14 9.5v8M18.5 9.5v8" />
      <path d="M3 20.5h18" />
    </Icon>
  );
}

/** India flag chip — tricolour bars, drawn rather than an emoji. */
export function IndiaFlagIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 2) / 3}
      viewBox="0 0 24 16"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="24" height="5.33" fill="#FF9933" />
      <rect y="5.33" width="24" height="5.34" fill="#ffffff" />
      <rect y="10.67" width="24" height="5.33" fill="#138808" />
      <circle cx="12" cy="8" r="1.9" fill="none" stroke="#000080" strokeWidth="0.7" />
      <rect
        x="0.25"
        y="0.25"
        width="23.5"
        height="15.5"
        fill="none"
        stroke="rgba(10,31,60,0.18)"
        strokeWidth="0.5"
      />
    </svg>
  );
}
