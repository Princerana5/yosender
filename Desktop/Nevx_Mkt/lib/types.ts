export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";
export type PostStatus = "ACTIVE" | "HIDDEN" | "DELETED" | "COMPLETED";
export type AppStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DealStatus =
  | "Pending"
  | "Negotiating"
  | "Payment Pending"
  | "Payment Received"
  | "In Progress"
  | "Delivered"
  | "Completed"
  | "Cancelled"
  | "Disputed";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  country: string;
  telegram?: string;
  avatarColor: string;
  role: Role;
  status: UserStatus;
  verified: boolean;
  rating: number;
  ratingCount: number;
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  /** ISO-3166 code for flagcdn, or "world" */
  code: string;
  country: string;
  active: boolean;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Need {
  id: string;
  userId: string;
  groupId: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string;
  budgetMin?: number;
  budgetMax?: number;
  budgetType: "fixed" | "range" | "negotiable";
  country: string;
  deadline?: string;
  status: PostStatus;
  applicationCount: number;
  createdAt: number;
}

export interface Offer {
  id: string;
  userId: string;
  groupId: string;
  title: string;
  description: string;
  category: string;
  price: number;
  priceType: "fixed" | "from" | "negotiable";
  country: string;
  deliveryTime?: string;
  status: PostStatus;
  createdAt: number;
}

export interface Application {
  id: string;
  needId: string;
  applicantId: string;
  price: number;
  deliveryTime: string;
  message: string;
  status: AppStatus;
  createdAt: number;
}

export interface Deal {
  id: string;
  needId: string;
  applicationId: string;
  buyerId: string;
  sellerId: string;
  title: string;
  agreedPrice: number;
  commission: number;
  finalAmount: number;
  paymentStatus: "Pending" | "Received" | "Refunded";
  deliveryStatus: "Pending" | "In Progress" | "Delivered";
  status: DealStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  dealId: string;
  side: "buyer" | "seller";
  sender: "admin" | "user";
  text: string;
  createdAt: number;
}

export interface Notification {
  id: string;
  userId: string;
  icon: string;
  text: string;
  read: boolean;
  link?: string;
  createdAt: number;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: "need" | "offer" | "user";
  targetId: string;
  reason: string;
  details?: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  createdAt: number;
}

export interface DbShape {
  seq: number;
  users: User[];
  groups: Group[];
  categories: Category[];
  needs: Need[];
  offers: Offer[];
  applications: Application[];
  deals: Deal[];
  messages: Message[];
  notifications: Notification[];
  reports: Report[];
}

/** Safe public profile — never leaks email / password hash */
export interface PublicUser {
  id: string;
  name: string;
  country: string;
  telegram?: string;
  avatarColor: string;
  verified: boolean;
  rating: number;
  ratingCount: number;
  createdAt: number;
}
