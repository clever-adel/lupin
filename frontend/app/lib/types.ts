// Mirrors the backend DTOs in store.lupinwear.catalog.api.CatalogDtos and auth.api.AuthDtos.

export type Lang = "en" | "ar";

export interface Category {
  slug: string;
  nameEn: string;
  nameAr: string;
  parentSlug?: string;
}

export interface Department {
  slug: string;
  nameEn: string;
  nameAr: string;
  status: "ACTIVE" | "COMING_SOON";
  productCount: number;
  categories: Category[];
}

export interface ColorDot {
  nameEn: string;
  nameAr: string;
  hex: string;
  imageUrl?: string;
  /** The colour's second photo, shown while the card is pointed at. */
  hoverImageUrl?: string;
}

export interface ProductCard {
  slug: string;
  nameEn: string;
  nameAr: string;
  categoryEn: string;
  categoryAr: string;
  price: number;
  salePrice?: number;
  discountPercent?: number;
  badge?: "NEW" | "BESTSELLER";
  inStock: boolean;
  colors: ColorDot[];
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

export interface ProductImage {
  url: string;
  altEn: string;
  altAr: string;
  width?: number;
  height?: number;
}

export interface Variant {
  id: number;
  sizeCode: string;
  available: boolean;
  maxQuantity: number;
}

export interface ProductColor {
  id: number;
  nameEn: string;
  nameAr: string;
  hex: string;
  main: boolean;
  images: ProductImage[];
  variants: Variant[];
}

export interface Crumb {
  slug: string;
  nameEn: string;
  nameAr: string;
}

export interface ProductDetail {
  id: number;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  fabricEn: string;
  fabricAr: string;
  fitEn: string;
  fitAr: string;
  brand?: string;
  badge?: "NEW" | "BESTSELLER";
  price: number;
  salePrice?: number;
  discountPercent?: number;
  department: Crumb;
  category: Crumb;
  colors: ProductColor[];
}

export interface Facets {
  sizes: string[];
  colors: ColorDot[];
  minPrice?: number;
  maxPrice?: number;
}

export interface VariantLine {
  variantId: number;
  productSlug: string;
  nameEn: string;
  nameAr: string;
  colorEn: string;
  colorAr: string;
  sizeCode: string;
  imageUrl?: string;
  unitPrice: number;
  available: boolean;
  maxQuantity: number;
}

/** A bag line as shown to the shopper, whether it came from this browser or from the account. */
export interface BagItem {
  variantId: number;
  productSlug: string;
  nameEn: string;
  nameAr: string;
  colorEn: string;
  colorAr: string;
  sizeCode: string;
  imageUrl?: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  purchasable: boolean;
  maxQuantity: number;
}

export interface Cart {
  lines: BagItem[];
  count: number;
  subtotal: number;
}

export interface Governorate {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface DeliveryOption {
  id: number;
  code: string;
  type: "STANDARD" | "EXPRESS" | "PICKUP";
  nameEn: string;
  nameAr: string;
  estimateEn: string;
  estimateAr: string;
  noteEn: string;
  noteAr: string;
  fee: number;
}

export interface Quote {
  lines: BagItem[];
  subtotal: number;
  discount: number;
  discountLabelEn: string;
  discountLabelAr: string;
  promo?: { code: string; applied: boolean; reason?: string };
  delivery?: {
    optionId: number;
    nameEn: string;
    nameAr: string;
    estimateEn: string;
    estimateAr: string;
    listFee: number;
    fee: number;
    free: boolean;
  };
  total: number;
  issues: { code: string; variantId?: number; message: string }[];
  readyToOrder: boolean;
}

export interface PolicyLink {
  slug: string;
  titleEn: string;
  titleAr: string;
}

export interface Policy extends PolicyLink {
  bodyEn: string;
  bodyAr: string;
}

export interface Faq {
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
}

export interface SiteContent {
  hero: {
    labelEn: string; labelAr: string; headlineEn: string; headlineAr: string; textEn: string; textAr: string;
    /** The home page photo chosen in the dashboard; when empty, the first featured product's photo is used. */
    imageUrl?: string;
    imagePublicId?: string;
  };
  announcement: { itemsEn: string[]; itemsAr: string[] };
  contact: {
    email: string; phone: string; whatsappNumber: string; hoursEn: string; hoursAr: string;
    addressEn: string; addressAr: string; instagram: string; facebook: string; tiktok: string;
  };
  policies: PolicyLink[];
  freeDeliveryThreshold?: number;
  paymentMethods: Record<PaymentMethod, boolean>;
  /** Present only while manual InstaPay is usable. */
  instapay?: { handle: string; instructionsEn: string; instructionsAr: string };
}

export type PaymentMethod = "COD" | "CARD" | "WALLET" | "FAWRY" | "INSTAPAY_MANUAL";

export type OrderStatus =
  | "PENDING" | "AWAITING_PAYMENT" | "PAID" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED"
  | "CANCELLED" | "REFUNDED";

export interface OrderItem {
  productNameEn: string;
  productNameAr: string;
  colorEn: string;
  colorAr: string;
  sizeCode: string;
  imageUrl?: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Order {
  reference: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod?: PaymentMethod;
  subtotal: number;
  discountTotal: number;
  discountLabelEn: string;
  discountLabelAr: string;
  promoCode?: string;
  deliveryFee: number;
  total: number;
  customerName: string;
  customerPhone: string;
  governorateEn: string;
  governorateAr: string;
  city: string;
  addressLine: string;
  deliveryNotes?: string;
  deliveryNameEn: string;
  deliveryNameAr: string;
  deliveryEstimateEn: string;
  deliveryEstimateAr: string;
  placedAt: string;
  cancelledAt?: string;
  undoExpiresAt?: string;
  canCancel: boolean;
  canUndo: boolean;
  /** What the customer still has to do to pay, decided by the server. */
  paymentAction?: "PAYMOB" | "TRANSFER";
  transferReference?: string;
  items: OrderItem[];
  history: { status: OrderStatus; at: string }[];
  /** Set once the order has been handed to a courier. */
  carrier?: string;
  trackingNumber?: string;
}

export interface OrderSummary {
  reference: string;
  status: OrderStatus;
  total: number;
  placedAt: string;
  itemCount: number;
}

export interface Me {
  id: string;
  email?: string;
  phone?: string;
  fullName: string;
  roles: string[];
  emailVerified: boolean;
  preferredLang: Lang;
}
