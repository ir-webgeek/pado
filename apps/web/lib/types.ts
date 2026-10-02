// Response shapes of the API the panel consumes (kept minimal and explicit).
export interface Variant {
  id: string;
  sku: string | null;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  priceUsdCents: number | null;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
}
export interface Product {
  id: string;
  title: string;
  slug: string;
  description: string;
  categoryId: string | null;
  images: string[];
  status: "draft" | "active" | "archived";
  seoTitle: string | null;
  seoDescription: string | null;
  variants: Variant[];
}
export interface Address {
  fullName: string;
  phone: string;
  province: string;
  city: string;
  line: string;
  postalCode?: string;
}
export interface OrderRow {
  id: string;
  code: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  channel: string;
  total: number;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  pointsDiscount: number;
  trackingCode: string | null;
  carrier: string | null;
  address: Address | null;
  createdAt: string;
  paidAt: string | null;
  reservedUntil: string | null;
  customer: { id: string; name: string | null; phone: string | null; city: string | null } | null;
  items: { title: string; variantLabel: string; quantity: number }[];
}
export interface OrderDetail extends Omit<OrderRow, "items" | "customer"> {
  items: { id: string; title: string; variantLabel: string; quantity: number; unitPrice: number; total: number }[];
  events: { id: string; type: string; createdAt: string; actorType: string }[];
  customer: Customer | null;
  payments: { id: string; method: string; status: string; amount: number; receiptUrl: string | null; createdAt: string }[];
  link: string;
  note: string | null;
}
export interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  instagramUsername: string | null;
  city: string | null;
  ordersCount: number;
  appointmentsCount: number;
  noShowCount: number;
  totalSpent: number;
  points: number;
  walletBalance: number;
  segment: string;
  lastOrderAt: string | null;
  lastVisitAt: string | null;
  createdAt: string;
  notes: string | null;
  vipProgress?: number;
}
export interface Service {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  price: number;
  priceFrom: boolean;
  deposit: { type: "none" | "fixed" | "percent"; value: number };
  capacity: number;
  onlineBookable: boolean;
  requiresApproval: boolean;
  color: string;
  image: string | null;
  banner: string | null;
  gallery: string[];
  beforeAfter: BeforeAfter[];
  active: boolean;
  staffIds: string[];
}
export interface BeforeAfter {
  before: string;
  after: string;
  caption?: string;
}
export interface Hours {
  weekday: number;
  startMin: number;
  endMin: number;
}
export interface Staff {
  id: string;
  name: string;
  title: string;
  color: string;
  avatar: string | null;
  active: boolean;
  phone: string | null;
  workingHours: Hours[];
}
export interface Appointment {
  id: string;
  code: string;
  status: string;
  paymentStatus: string;
  startsAt: string;
  endsAt: string;
  staffId: string;
  serviceId: string;
  price: number;
  depositAmount: number;
  paidAmount: number;
  channel: string;
  note: string | null;
  internalNote: string | null;
  refundStatus: string | null;
  service: { name: string; color: string };
  staff: { name: string };
  customer: { name: string | null; phone: string | null; segment: string; noShowCount: number };
}
export interface Slot {
  startsAt: string;
  staffIds: string[];
  seatsLeft?: number;
}
export interface DaySlots {
  date: string;
  slots: Slot[];
}
