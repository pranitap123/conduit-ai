import type { ColumnType, Generated } from 'kysely';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';
export type RequestStatus =
  | 'SUCCESS' | 'UPSTREAM_ERROR' | 'CLIENT_ERROR'
  | 'RATE_LIMITED' | 'TIMEOUT' | 'CANCELLED';

/** node-postgres returns NUMERIC as a string so precision survives the wire. */
type Numeric = ColumnType<string, string, string>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** Server-defaulted timestamp: optional on insert, still a Date on select. */
type DefaultedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  created_at: DefaultedTimestamp;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  created_at: DefaultedTimestamp;
}

export interface MembershipsTable {
  id: Generated<string>;
  user_id: string;
  org_id: string;
  role: Generated<Role>;
}

export interface ProjectsTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  slug: string;
  created_at: DefaultedTimestamp;
}

export interface ApiKeysTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  last4: string;
  created_at: DefaultedTimestamp;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
}

export interface RequestsTable {
  id: Generated<string>;
  org_id: string;
  project_id: string;
  api_key_id: string | null;
  provider: string;
  model: string;
  status: RequestStatus;
  status_code: number;
  latency_ms: number;
  upstream_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: Numeric | null;
  cost_known: Generated<boolean>;
  cache_hit: Generated<boolean>;
  streamed: Generated<boolean>;
  retry_count: Generated<number>;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  created_at: DefaultedTimestamp;
}

export interface ModelPricingTable {
  id: Generated<string>;
  provider: string;
  model: string;
  input_price_per_mtok: Numeric;
  output_price_per_mtok: Numeric;
  effective_from: DefaultedTimestamp;
}

export interface DB {
  organizations: OrganizationsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  projects: ProjectsTable;
  api_keys: ApiKeysTable;
  requests: RequestsTable;
  model_pricing: ModelPricingTable;
}
