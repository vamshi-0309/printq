import type { DerivedOrderState } from "./orderStatus";
import type { ShopReadiness } from "./shopReadiness";

/**
 * The shapes the dashboard API routes return.
 *
 * Declared once and imported by both sides so a field renamed in a route is a
 * compile error in the page that reads it, rather than `undefined` on screen.
 */

export interface OverviewResponse {
  shop: { id: string; slug: string; name: string; city: string | null; status: string };
  readiness: ShopReadiness;
  settings: {
    paymentGateway: string | null;
    hasUpiId: boolean;
    fileRetentionHours: number;
    pricingConfigured: boolean;
  };
  today: {
    paidOrders: number;
    unpaidOrders: number;
    completedOrders: number;
    revenue: number;
    pagesOrdered: number;
    pagesPrinted: number;
    since: string;
  };
  queue: QueueItem[];
  counts: {
    active: number;
    blocked: number;
    awaitingPayment: number;
    unprintedValue: number;
  };
  serverTime: string;
}

export interface QueueItem {
  id: string;
  publicOrderId: string;
  tokenNumber: string | null;
  amount: number;
  pageCount: number | null;
  copies: number;
  colorMode: string;
  paperSize: string;
  sides: string;
  createdAt: string;
  paidAt: string | null;
  state: DerivedOrderState;
}

export interface OrderListItem extends Omit<QueueItem, "paidAt"> {
  pageRange: string;
  paidAt: string | null;
  completedAt: string | null;
}

export interface OrderListResponse {
  orders: OrderListItem[];
  nextCursor: string | null;
  agentOnline: boolean;
  printerAvailable: boolean;
  serverTime: string;
}

export interface OrderAction {
  action: string;
  label: string;
  description: string;
  destructive?: boolean;
}

export interface OrderDetailResponse {
  order: {
    id: string;
    publicOrderId: string;
    tokenNumber: string | null;
    tokenCounter: number | null;
    amount: number;
    priceBreakdown: {
      perPageRate: number;
      effectivePages: number;
      subtotal: number;
      duplexDiscount: number;
      total: number;
      minimumApplied: boolean;
    } | null;
    pageCount: number | null;
    copies: number;
    pageRange: string;
    colorMode: string;
    paperSize: string;
    orientation: string;
    sides: string;
    paymentStatus: string;
    printStatus: string;
    createdAt: string;
    paidAt: string | null;
    printStartedAt: string | null;
    completedAt: string | null;
    failureReason: string | null;
    state: DerivedOrderState;
  };
  file: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    deletedAt: string | null;
    uploadedAt: string;
  } | null;
  payment: {
    method: string;
    gateway: string | null;
    reference: string | null;
    amount: number;
    status: string;
    createdAt: string;
    verifiedAt: string | null;
  } | null;
  job: {
    id: string;
    state: string;
    claimedAt: string | null;
    claimedByAgentId: string | null;
  } | null;
  queuePosition: number | null;
  attempts: {
    attempt_number: number;
    attempted_at: string;
    result: string | null;
    error_message: string | null;
    printer_id: string | null;
  }[];
  actions: OrderAction[];
  agentOnline: boolean;
  printerAvailable: boolean;
  serverTime: string;
}

export interface PrinterRow {
  id: string;
  agent_id: string | null;
  system_name: string;
  display_name: string;
  is_default: boolean;
  is_enabled: boolean;
  supports_color: boolean;
  supports_duplex: boolean;
  supported_paper_sizes: string[];
  last_status: string | null;
  updated_at: string;
  agentOnline: boolean;
  available: boolean;
}

export interface PrintersResponse {
  printers: PrinterRow[];
  agent: {
    id: string;
    hostname: string | null;
    version: string | null;
    last_heartbeat_at: string | null;
    status: string;
  } | null;
  agentCount: number;
  agentOnline: boolean;
  printerAvailable: boolean;
  serverTime: string;
}

export interface AgentRow {
  id: string;
  hostname: string | null;
  version: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string | null;
  online: boolean;
  neverSeen: boolean;
  printerCount: number;
}

export interface AgentsResponse {
  agents: AgentRow[];
  agentOnline: boolean;
  heartbeatTimeoutSeconds: number;
  pairing: { code: string; secondsRemaining: number } | null;
  serverTime: string;
}

export interface PricingRow {
  shop_id: string;
  a4_bw_per_page: number;
  a4_color_per_page: number;
  a3_bw_per_page: number;
  a3_color_per_page: number;
  duplex_discount_percent: number;
  minimum_order_amount: number;
  enabled_paper_sizes: string[];
  updated_at: string;
}

export interface SettingsResponse {
  shop: {
    id: string;
    slug: string;
    shop_name: string;
    owner_name: string;
    phone: string;
    email: string;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
    status: string;
    created_at: string;
  };
  settings: {
    shop_id: string;
    upi_id: string | null;
    payment_gateway: string | null;
    payment_gateway_account_id: string | null;
    file_retention_hours: number;
    heartbeat_timeout_seconds: number;
    updated_at: string;
  } | null;
  licence: {
    plan: string;
    status: string;
    activated_at: string;
    expires_at: string;
    grace_period_days: number;
  } | null;
  gatewayAvailability: { cashfree: boolean; razorpay: boolean };
}
