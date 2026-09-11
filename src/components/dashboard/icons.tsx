/**
 * Navigation icons, drawn rather than typed.
 *
 * The sidebar previously used typographic characters (⊞ ☰ ₹ ⎙ ⚙ ⊟) whose
 * shapes depend entirely on which font the machine happens to have — on
 * Windows several render as boxes. These are line icons on the same 24-unit
 * grid and 1.7 stroke as the rest of the product.
 */

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const OverviewIcon = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7.5" height="7.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" />
  </svg>
);

export const OrdersIcon = () => (
  <svg {...base}>
    <path d="M8 3h8l4 4v14H4V3z" />
    <path d="M8 12h8M8 16h5" />
  </svg>
);

export const PrinterIcon = () => (
  <svg {...base}>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="8" />
    <path d="M7 15h10v6H7z" />
  </svg>
);

export const AgentIcon = () => (
  <svg {...base}>
    <rect x="2.5" y="4" width="19" height="12" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const PricingIcon = () => (
  <svg {...base}>
    <path d="M7 5h10M7 9.5h10M15.5 5c0 4-3.5 4.5-7 4.5 3 0 8 1.5 8 5.5S12 20 9 20" />
  </svg>
);

export const SettingsIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
  </svg>
);

export const QrIcon = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4" />
  </svg>
);
