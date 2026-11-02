/**
 * The Cloudflare API token permissions the console needs. One list, used by the
 * "create token" link (key and type) and by the guide in the UI (the rest), so
 * the two can't disagree.
 */

export interface TokenPermission {
  /** Cloudflare's permission group key, as the dashboard's token link expects it. */
  key: string;
  type: "edit" | "read";
  /** The row as it appears in Cloudflare's token form: Account › <area> › <level>. */
  area: string;
  level: "Edit" | "Read";
  /** Why the console needs it, in plain words. */
  why: string;
}

export const CLOUDFLARE_TOKEN_PERMISSIONS: TokenPermission[] = [
  { key: "workers_scripts", type: "edit", area: "Workers Scripts", level: "Edit", why: "Upload the gateway, store Slack signing secrets, and open the live log view." },
  { key: "workers_kv_storage", type: "edit", area: "Workers KV Storage", level: "Edit", why: "Keep the gateway's settings (Slack apps, routes, lists) and their version history." },
  { key: "account_analytics", type: "read", area: "Account Analytics", level: "Read", why: "Read the forwarded and dropped counts for the Overview." },
  { key: "account_settings", type: "read", area: "Account Settings", level: "Read", why: "See which Cloudflare accounts the token belongs to." },
];
