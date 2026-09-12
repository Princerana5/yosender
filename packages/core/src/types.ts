// ── 8xtelSMPP shared domain types (§4–§35) ─────────────────────────────────

/** Client account lifecycle (§4) */
export type ClientStatus = 'active' | 'suspended' | 'blocked' | 'pending';
export type BindType = 'transceiver' | 'transmitter' | 'receiver';
export type Channel = 'sms' | 'whatsapp' | 'rcs';

export interface Client {
  id: string;
  name: string;
  company_name: string | null;
  system_id: string;
  status: ClientStatus;
  balance: string; // numeric as string (pg numeric)
  credit_limit: string;
  currency: string;
  default_route_id: string | null;
  tps_limit: number;
  daily_limit: number | null;
  monthly_limit: number | null;
  pricing_profile_id: string | null;
  dlr_mode: 'smpp' | 'http' | 'api' | 'none';
  dlr_callback_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientIp {
  id: string;
  client_id: string;
  ip: string; // single IP or CIDR
  enabled: boolean;
}

/** Upstream vendor (§7–§8) */
export type ConnectorStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'error';

export interface Vendor {
  id: string;
  name: string;
  host: string;
  port: number;
  system_id: string;
  bind_type: BindType;
  source_ton: number;
  source_npi: number;
  dest_ton: number;
  dest_npi: number;
  tps: number;
  connection_count: number;
  dlr_supported: boolean;
  use_tls: boolean;
  status: string;
  reconnect_interval_sec: number;
}

export interface VendorRate {
  id: string;
  vendor_id: string;
  country_id: string | null;
  prefix: string | null;
  operator: string | null;
  sender_type: string | null;
  cost: string;
  effective_from: string;
}

/** Routing (§10–§12, §24) */
export type RouteStrategy =
  | 'priority'
  | 'failover'
  | 'round_robin'
  | 'least_cost'
  | 'percentage';

export interface Route {
  id: string;
  name: string;
  channel: Channel;
  client_id: string | null; // null = global
  country_id: string | null;
  prefix: string | null;
  sender_id: string | null;
  strategy: RouteStrategy;
  status: string;
  tps_limit: number | null;
  group_id: string | null;
}

export interface RouteVendor {
  route_id: string;
  vendor_id: string;
  priority: number;
  weight: number; // percentage weight
}

/** Messages + DLR (§15–§17) */
export type MessageStatus =
  | 'submitted'
  | 'delivered'
  | 'undelivered'
  | 'expired'
  | 'rejected'
  | 'failed'
  | 'unknown';

export interface MessageJob {
  /** internal message id (uuid) */
  internal_id: string;
  client_id: string;
  client_msg_id: string;
  channel: Channel;
  source: string; // sender id
  destination: string;
  country_id: string | null;
  text: string;
  data_coding: number;
  route_id: string | null;
  attempts: number;
  /** Test override (Send Test SMS page): skip route matching, force path */
  force_route_id?: string | null;
  force_vendor_id?: string | null;
}

export interface DlrEvent {
  internal_id: string;
  vendor_msg_id: string | null;
  status: MessageStatus;
  error_code: string | null;
  error_description: string | null;
  raw_body: string;
  delivered_at: string | null;
}

/** Billing (§28) */
export interface BillingCharge {
  internal_id: string;
  client_id: string;
  vendor_id: string | null;
  client_price: string;
  vendor_cost: string;
}

/** RBAC (§30) */
export type RoleName =
  | 'super_admin'
  | 'admin'
  | 'operations'
  | 'finance'
  | 'support'
  | 'read_only';

export const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  super_admin: ['*'],
  admin: [
    'clients.*', 'vendors.*', 'routes.*', 'messages.read', 'messages.send', 'billing.*',
    'reports.*', 'system.logs', 'users.manage',
  ],
  operations: [
    'messages.read', 'messages.send', 'routes.read', 'routes.update', 'vendors.read',
    'vendors.reconnect', 'system.logs', 'reports.traffic',
  ],
  finance: ['billing.*', 'rates.*', 'reports.revenue', 'reports.cost', 'reports.profit'],
  support: ['clients.read', 'messages.read', 'system.logs'],
  read_only: ['dashboard.read', 'reports.read'],
};

export function can(permissions: string[], required: string): boolean {
  if (permissions.includes('*')) return true;
  if (permissions.includes(required)) return true;
  const [scope] = required.split('.');
  return permissions.includes(`${scope}.*`);
}
