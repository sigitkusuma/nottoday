import { describe, expect, it } from "vitest";
import { eventTone } from "../src/web/botHealth";
import { eventsFromDecisions, mergeEvents } from "../src/web/liveMerge";
import type { RecentDecision } from "../src/web/types";
import type { LiveEvent } from "../src/web/useLive";

const row = (over: Partial<RecentDecision>): RecentDecision => ({ time: "2026-11-04 07:30:00", app: "scout", route: "", kind: "event", type: "message", channel: "C1", mode: "", filter: "", reason: "", outcome: "unrouted", status: 0, ...over });
const live = (over: Partial<LiveEvent>): LiveEvent => ({ time: "2026-11-04T07:30:00.400Z", kind: "event", app: "scout", type: "message", channel: "C1", routes: [], ...over });

describe("eventsFromDecisions", () => {
  it("puts the rows of one request back together, newest first", () => {
    const events = eventsFromDecisions([
      row({ time: "2026-11-04 07:30:05", route: "a", outcome: "forwarded", mode: "enforce", filter: "pass", status: 200 }),
      row({ time: "2026-11-04 07:30:05", route: "b", outcome: "dropped", mode: "enforce", filter: "fail", reason: "ignoreBots" }),
      row({ time: "2026-11-04 07:30:00", type: "app_mention", outcome: "unrouted" }),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ time: "2026-11-04T07:30:05.000Z", type: "message", routes: [{ route: "a", forwarded: true, status: 200 }, { route: "b", forwarded: false, reason: "ignoreBots" }] });
    expect(events[1]).toMatchObject({ type: "app_mention", routes: [] });
  });

  it("reads the same tones as the live events do", () => {
    const tone = (r: Partial<RecentDecision>) => eventTone(eventsFromDecisions([row(r)])[0]).tone;
    expect(tone({ outcome: "unrouted" })).toBe("unrouted");
    expect(tone({ outcome: "forwarded", route: "r", mode: "enforce", filter: "pass", status: 200 })).toBe("sent");
    expect(tone({ outcome: "forwarded", route: "r", mode: "shadow", filter: "fail", status: 200 })).toBe("shadow");
    expect(tone({ outcome: "forwarded", route: "r", mode: "enforce", filter: "pass", status: 502 })).toBe("error");
    expect(tone({ outcome: "dropped", route: "r", mode: "enforce", filter: "fail" })).toBe("saved");
    expect(tone({ outcome: "bad_signature", type: "", channel: "" })).toBe("bad");
    expect(tone({ outcome: "url_verification", type: "", channel: "" })).toBe("info");
  });

  it("skips rows with a time it can't read", () => {
    expect(eventsFromDecisions([row({ time: "" })])).toEqual([]);
  });
});

describe("mergeEvents", () => {
  it("keeps the live event when the stats show the same request a moment apart", () => {
    const merged = mergeEvents([live({})], eventsFromDecisions([row({})]));
    expect(merged).toHaveLength(1);
    expect(merged[0].time).toBe("2026-11-04T07:30:00.400Z");
  });

  it("adds what only the stats know, newest first", () => {
    const merged = mergeEvents(
      [live({})],
      eventsFromDecisions([row({ time: "2026-11-04 07:00:00", type: "app_mention" }), row({ time: "2026-11-04 07:30:00" }), row({ time: "2026-11-04 07:40:00", channel: "C2" })]),
    );
    expect(merged.map((e) => e.time)).toEqual(["2026-11-04T07:40:00.000Z", "2026-11-04T07:30:00.400Z", "2026-11-04T07:00:00.000Z"]);
  });

  it("treats a different app, type or channel as a different request", () => {
    expect(mergeEvents([live({})], eventsFromDecisions([row({ app: "other" })]))).toHaveLength(2);
    expect(mergeEvents([live({})], eventsFromDecisions([row({ type: "app_mention" })]))).toHaveLength(2);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => live({ time: new Date(Date.parse("2026-11-04T07:00:00Z") + i * 60_000).toISOString() }));
    expect(mergeEvents(many, [], 10)).toHaveLength(10);
  });
});
