import { describe, expect, it } from "vitest";
import { FRESH_MS, botEventsFor, noiseHints } from "../src/web/noise";

const NOW = Date.parse("2026-11-04T08:00:00Z");
const row = (over: object) => ({ app: "scout", type: "message", count: 4210, last: "2026-11-04 07:55:00", ...over });

describe("noiseHints", () => {
  it("names the event types still arriving that no route uses, biggest first", () => {
    const hints = noiseHints([row({ type: "reaction_added", count: 50 }), row({})], "scout", NOW);
    expect(hints.map((h) => [h.type, h.count])).toEqual([["message", 4210], ["reaction_added", 50]]);
    expect(hints[0].unsubscribe).toEqual(["message.channels", "message.groups", "message.im"]);
    expect(hints[1].unsubscribe).toEqual(["reaction_added"]);
  });

  it("ignores other apps, small counts and noise that has stopped", () => {
    expect(noiseHints([row({ app: "other" })], "scout", NOW)).toEqual([]);
    expect(noiseHints([row({ count: 3 })], "scout", NOW)).toEqual([]);
    const old = new Date(NOW - FRESH_MS - 60_000).toISOString().replace("T", " ").slice(0, 19);
    expect(noiseHints([row({ last: old })], "scout", NOW)).toEqual([]);
  });

  it("maps message events to the three bot events that produce them", () => {
    expect(botEventsFor("message")).toEqual(["message.channels", "message.groups", "message.im"]);
    expect(botEventsFor("app_mention")).toEqual(["app_mention"]);
  });
});
