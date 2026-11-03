import { describe, expect, it } from "vitest";
import { parseGithubRequest, verifyGithubSignature } from "../src/github";
import { lookup, failedCondition } from "../src/match";
import { parseTelegramRequest, verifyTelegramToken } from "../src/telegram";
import { parseWebhookRequest, verifyWebhook } from "../src/webhook";
import type { AppConfig, WebhookVerify } from "@gw/shared";

const SECRET = "whsec-test";

async function hmac(body: string, encoding: "hex" | "base64", secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return encoding === "hex" ? [...mac].map((b) => b.toString(16).padStart(2, "0")).join("") : btoa(String.fromCharCode(...mac));
}

const req = (headers: Record<string, string>, body = "{}", url = "https://gw.test/hook/x") => new Request(url, { method: "POST", headers, body });

describe("GitHub", () => {
  const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/api" }, sender: { login: "dependabot[bot]", type: "Bot" } });

  it("accepts sha256=<hex> of the body and rejects anything else", async () => {
    expect(await verifyGithubSignature(SECRET, `sha256=${await hmac(body, "hex")}`, body)).toBe(true);
    expect(await verifyGithubSignature(SECRET, `sha256=${await hmac(body, "hex", "other")}`, body)).toBe(false);
    expect(await verifyGithubSignature(SECRET, await hmac(body, "hex"), body)).toBe(false);
    expect(await verifyGithubSignature(SECRET, null, body)).toBe(false);
  });

  it("reads the event, branch, repository and delivery ID; ping is the handshake", () => {
    const headers = new Headers({ "x-github-event": "push", "x-github-delivery": "d-1", "content-type": "application/json" });
    const inbound = parseGithubRequest(headers, body);
    expect(inbound).toMatchObject({ type: "push", channel: "acme/api", id: "d-1", handshake: false });
    expect(inbound.data.branch).toBe("main");
    expect(parseGithubRequest(new Headers({ "x-github-event": "ping" }), "{}").handshake).toBe(true);
  });

  it("understands form-encoded deliveries too", () => {
    const form = `payload=${encodeURIComponent(body)}`;
    const inbound = parseGithubRequest(new Headers({ "x-github-event": "push", "content-type": "application/x-www-form-urlencoded" }), form);
    expect(inbound.data.branch).toBe("main");
  });
});

describe("Telegram", () => {
  it("checks the secret-token header", () => {
    expect(verifyTelegramToken("tok", "tok")).toBe(true);
    expect(verifyTelegramToken("tok", "tok2")).toBe(false);
    expect(verifyTelegramToken("tok", null)).toBe(false);
  });

  it("reads the update type, chat, sender and bot command", () => {
    const body = JSON.stringify({ update_id: 7, message: { chat: { id: -100, type: "group" }, from: { id: 5, is_bot: false }, text: "/deploy@my_bot now" } });
    const inbound = parseTelegramRequest(new Headers({ "content-type": "application/json" }), body);
    expect(inbound).toMatchObject({ type: "message", channel: "-100", id: "7" });
    expect(inbound.data).toMatchObject({ command: "/deploy", text: "/deploy@my_bot now", from: { id: 5 } });
  });

  it("treats button presses as callback_query with their data as text", () => {
    const body = JSON.stringify({ update_id: 8, callback_query: { from: { id: 9 }, data: "approve", message: { chat: { id: 42 } } } });
    const inbound = parseTelegramRequest(new Headers(), body);
    expect(inbound).toMatchObject({ type: "callback_query", channel: "42" });
    expect(inbound.data).toMatchObject({ text: "approve", from: { id: 9 } });
  });
});

describe("any webhook", () => {
  const body = '{"event":"order.paid","total":12}';
  const check = (v: WebhookVerify, headers: Record<string, string>, url?: string) => verifyWebhook(v, SECRET, req(headers, body, url), body);

  it("checks HMAC signatures in hex with a prefix, and in base64", async () => {
    const gh: WebhookVerify = { type: "hmac", header: "x-hub-signature-256", prefix: "sha256=", encoding: "hex" };
    expect(await check(gh, { "x-hub-signature-256": `sha256=${await hmac(body, "hex")}` })).toBe(true);
    expect(await check(gh, { "x-hub-signature-256": await hmac(body, "hex") })).toBe(false);
    const shopify: WebhookVerify = { type: "hmac", header: "x-shopify-hmac-sha256", encoding: "base64" };
    expect(await check(shopify, { "x-shopify-hmac-sha256": await hmac(body, "base64") })).toBe(true);
    expect(await check(shopify, { "x-shopify-hmac-sha256": await hmac("{}", "base64") })).toBe(false);
  });

  it("checks a token in a header or in the URL", async () => {
    expect(await check({ type: "header-token", header: "x-gitlab-token" }, { "x-gitlab-token": SECRET })).toBe(true);
    expect(await check({ type: "header-token", header: "x-gitlab-token" }, { "x-gitlab-token": "nope" })).toBe(false);
    expect(await check({ type: "url-token", param: "token" }, {}, `https://gw.test/hook/x?token=${SECRET}`)).toBe(true);
    expect(await check({ type: "url-token", param: "token" }, {}, "https://gw.test/hook/x?token=nope")).toBe(false);
  });

  it("reads the event name from a header or a JSON path", () => {
    const app = (eventField?: string): AppConfig => ({ source: "webhook", signingSecret: "S", verify: { type: "header-token", header: "x-t" }, eventField, routes: [] });
    const headers = new Headers({ "content-type": "application/json", "X-Event-Type": "refund" });
    expect(parseWebhookRequest(app("event"), headers, body).type).toBe("order.paid");
    expect(parseWebhookRequest(app("header:X-Event-Type"), headers, body).type).toBe("refund");
    expect(parseWebhookRequest(app(), headers, body).type).toBe("");
  });
});

describe("conditions", () => {
  const data = { action: "opened", sender: { type: "User", login: "ana" }, labels: [{ name: "bug" }, { name: "p1" }], count: 3, draft: false };
  const lists = { team: ["ana", "ben"] };
  const fails = (c: Parameters<typeof failedCondition>[0]) => failedCondition(c, data, lists);

  it("looks up dot paths and fans out over arrays", () => {
    expect(lookup(data, "labels.name")).toEqual(["bug", "p1"]);
    expect(lookup(data, "sender.login")).toEqual(["ana"]);
    expect(lookup(data, "nope.deeper")).toEqual([]);
  });

  it("supports every operator, numbers and booleans as text, and lists", () => {
    expect(fails([{ field: "action", op: "is", value: "opened" }])).toBeUndefined();
    expect(fails([{ field: "action", op: "isNot", value: "opened" }])).toBe("match:action");
    expect(fails([{ field: "labels.name", op: "is", value: "p1" }])).toBeUndefined();
    expect(fails([{ field: "count", op: "is", value: "3" }])).toBeUndefined();
    expect(fails([{ field: "draft", op: "is", value: "false" }])).toBeUndefined();
    expect(fails([{ field: "sender.login", op: "in", value: "@team" }])).toBeUndefined();
    expect(fails([{ field: "sender.login", op: "notIn", value: ["ana"] }])).toBe("match:sender.login");
    expect(fails([{ field: "action", op: "matches", value: "^open" }])).toBeUndefined();
    expect(fails([{ field: "pull_request", op: "exists" }])).toBe("match:pull_request");
    expect(fails([{ field: "pull_request", op: "missing" }])).toBeUndefined();
  });

  it("treats a missing field as not equal and not in a list", () => {
    expect(fails([{ field: "nope", op: "isNot", value: "x" }])).toBeUndefined();
    expect(fails([{ field: "nope", op: "notIn", value: "@team" }])).toBeUndefined();
    expect(fails([{ field: "nope", op: "is", value: "x" }])).toBe("match:nope");
  });

  it("reports the first failing condition", () => {
    expect(fails([{ field: "action", op: "is", value: "opened" }, { field: "sender.type", op: "isNot", value: "User" }])).toBe("match:sender.type");
  });
});
