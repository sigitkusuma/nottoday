/** Shapes the console API returns. Config types come from the shared package. */

import type { AppConfig } from "@gw/shared";

export type { AppConfig, EventFilters, GatewayConfig, ListRef, ListSource, Route, Trigger } from "@gw/shared";

export interface ConnectionSummary {
  id: string;
  accountId: string | null;
  accountName: string | null;
  scriptName: string | null;
  gatewayUrl: string | null;
  active: boolean;
  /** Token saved but no account chosen yet. */
  pending: boolean;
}

export interface Status {
  /** Every saved Cloudflare account; the active one is also described by `cloudflare` and `gateway`. */
  connections: ConnectionSummary[];
  cloudflare: { accountId: string | null; accountName: string | null } | null;
  gateway: {
    scriptName: string;
    url: string;
    dataset: string;
    health: { reachable: boolean; ok?: boolean; version?: string; configHash?: string | null };
    bundledVersion: string;
    upgradeAvailable: boolean;
    statsEnabled: boolean;
    analyticsEngineUrl: string;
  } | null;
  n8n: { baseUrl: string } | null;
  tokenUrl: string;
}

export interface RouteSummary {
  app: string;
  route: string;
  mode: string;
  received: number;
  forwarded: number;
  dropped: number;
  wouldDrop: number;
  reasons: Record<string, number>;
  n8nErrors: number;
  errorStatuses?: Record<string, number>;
}

export interface AppSignal {
  app: string;
  lastVerified?: string;
  lastBadSignature?: string;
  lastRequest?: string;
}

export interface RecentDecision {
  time: string;
  app: string;
  route: string;
  kind: string;
  type: string;
  channel: string;
  mode: string;
  filter: string;
  reason: string;
  outcome: string;
  status: number;
}

export interface TriggerNode {
  workflowId: string;
  workflowName: string;
  nodeName: string;
  kind: "slack" | "webhook";
  url: string;
  suggestedEvents?: string[];
}

export interface WorkflowUsage {
  workflowId: string;
  workflowName: string;
  active: boolean;
  executions: number;
  triggers: TriggerNode[];
}

/** One saved account's gateway as `GET /overview` returns it: read without making the account active. */
export interface AccountOverview {
  id: string;
  active: boolean;
  accountId: string;
  accountName: string | null;
  scriptName: string;
  url: string;
  statsEnabled: boolean;
  /** Absent when the account couldn't be read; `error` says why. */
  health?: { reachable: boolean; ok?: boolean; version?: string };
  apps?: Record<string, AppConfig>;
  missingSecrets?: string[];
  routes?: RouteSummary[];
  signals?: AppSignal[];
  error?: string;
}
