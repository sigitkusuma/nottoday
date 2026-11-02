import { describe, expect, it } from "vitest";
import { mentionedUsers, parseSlackRequest, verifySlackSignature } from "../src/slack";
import { SECRET, sign } from "./helpers";

describe("verifySlackSignature", () => {
  const now = 1_800_000_000;
  const body = '{"type":"event_callback"}';

  it("accepts a correct signature", async () => {
    expect(await verifySlackSignature(SECRET, String(now), await sign(body, now), body, now)).toBe(true);
  });

  it("rejects a signature made with another secret", async () => {
    expect(await verifySlackSignature(SECRET, String(now), await sign(body, now, "other"), body, now)).toBe(false);
  });

  it("rejects a changed body", async () => {
    expect(await verifySlackSignature(SECRET, String(now), await sign(body, now), body + " ", now)).toBe(false);
  });

  it("rejects requests older than 5 minutes", async () => {
    const old = now - 301;
    expect(await verifySlackSignature(SECRET, String(old), await sign(body, old), body, now)).toBe(false);
  });

  it("rejects missing or malformed headers", async () => {
    expect(await verifySlackSignature(SECRET, null, "v0=00", body, now)).toBe(false);
    expect(await verifySlackSignature(SECRET, String(now), "v1=00", body, now)).toBe(false);
    expect(await verifySlackSignature(SECRET, String(now), "v0=zz", body, now)).toBe(false);
  });
});

describe("parseSlackRequest", () => {
  it("parses url_verification", () => {
    expect(parseSlackRequest("application/json", '{"type":"url_verification","challenge":"abc"}')).toEqual({
      kind: "url_verification",
      challenge: "abc",
    });
  });

  it("parses an event callback", () => {
    const r = parseSlackRequest("application/json; charset=utf-8", '{"type":"event_callback","event_id":"Ev9","event":{"type":"message","text":"hi"}}');
    expect(r).toEqual({ kind: "event", eventId: "Ev9", event: { type: "message", text: "hi" } });
  });

  it("parses interactivity and slash commands", () => {
    const payload = encodeURIComponent(JSON.stringify({ type: "block_actions", actions: [{ action_id: "claim" }] }));
    expect(parseSlackRequest("application/x-www-form-urlencoded", `payload=${payload}`).kind).toBe("interactivity");
    expect(parseSlackRequest("application/x-www-form-urlencoded", "command=%2Fask&text=hello")).toEqual({
      kind: "command",
      command: "/ask",
    });
  });

  it("returns unknown for anything else", () => {
    expect(parseSlackRequest("text/plain", "x").kind).toBe("unknown");
    expect(parseSlackRequest("application/json", "{not json").kind).toBe("unknown");
  });
});

describe("mentionedUsers", () => {
  it("finds plain and labelled mentions in order", () => {
    expect(mentionedUsers("hey <@U111> and <@W222|sam>, also <#C1> <!here>")).toEqual(["U111", "W222"]);
  });
});
