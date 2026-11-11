import { ApiError } from "~/lib/http";
import { formatDateTime, formatMoney } from "~/lib/i18n";
import type { Order, OrderStatus } from "~/lib/types";

// Mirrors the staff DTOs in store.lupinwear.order.OrderAdminService, payment.PaymentService,
// catalog.api.CatalogDtos and admin.AdminSettingsController.

export interface AdminOrderRow {
  reference: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod?: string;
  total: number;
  customerName: string;
  customerPhone: string;
  governorate: string;
  placedAt: string;
  itemCount: number;
}

export interface AdminOrder {
  order: Order;
  customerEmail?: string;
  nextStatuses: OrderStatus[];
  payments: {
    id: string;
    provider: string;
    method: string;
    status: string;
    amount: number;
    transferReference?: string;
    providerTransactionId?: string;
    createdAt: string;
  }[];
  shipment?: { carrier?: string; trackingReference?: string; status: string; shippedAt?: string; deliveredAt?: string };
  history: { fromStatus?: string; toStatus: OrderStatus; actor?: string; note?: string; at: string }[];
}

export interface Summary {
  ordersByStatus: Record<string, number>;
  transfersToCheck: number;
  refundsPending: number;
  lowStockVariants: number;
}

export interface Transfer {
  paymentId: string;
  orderReference: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  transferReference: string;
  submittedAt: string;
}

export interface AdminVariant {
  variantId: number;
  color: string;
  sizeCode: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface AdminProduct {
  id: number;
  slug: string;
  nameEn: string;
  nameAr: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  price: number;
  salePrice?: number;
  variants: AdminVariant[];
}

export interface GovernorateFee {
  governorateId: number;
  feeOverride?: number | null;
}

export interface AdminDeliveryOption {
  id: number;
  code: string;
  type: "STANDARD" | "EXPRESS" | "PICKUP";
  nameEn: string;
  nameAr: string;
  estimateEn: string;
  estimateAr: string;
  fee: number;
  active: boolean;
  sortOrder: number;
  governorates: GovernorateFee[];
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "New (cash)",
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  CONFIRMED: "Confirmed",
  PROCESSING: "Being prepared",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const PAYMENT_LABEL: Record<string, string> = {
  COD: "Cash on delivery",
  CARD: "Card",
  WALLET: "Wallet",
  FAWRY: "Fawry",
  INSTAPAY_MANUAL: "InstaPay transfer",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Not paid yet",
  VERIFYING: "Transfer to check",
  PAID: "Paid",
  FAILED: "Failed",
  REFUND_PENDING: "Refund needed",
  PARTIALLY_REFUNDED: "Partly refunded",
  REFUNDED: "Refunded",
  NOT_REQUIRED: "Not required",
};

export const money = (amount: number) => formatMoney("en", amount);
export const when = (iso: string) => formatDateTime("en", iso);

/** The server's own message is shown to staff: it is written for them and names the exact problem. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const field = error.fields ? Object.entries(error.fields)[0] : undefined;
    return field ? `${field[0]}: ${field[1]}` : error.message || error.code;
  }
  return "Something went wrong. Please try again.";
}
