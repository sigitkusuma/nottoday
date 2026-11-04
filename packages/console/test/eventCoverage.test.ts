import { describe, expect, it } from "vitest";
import { eventNames, unforwardedEvents } from "../src/web/eventCoverage";
import { SOURCES } from "../src/web/sources";

describe("unforwardedEvents", () => {
  it("finds the events the workflow listens to that the route doesn't forward", () => {
    expect(unforwardedEvents(["app_mention", "message"], ["message"])).toEqual(["app_mention"]);
    expect(unforwardedEvents(["app_mention", "message"], ["app_mention"])).toEqual(["message"]);
    expect(unforwardedEvents(["app_mention", "message"], ["message", "app_mention"])).toEqual([]);
  });

  it("says nothing when either side means any event, or the trigger isn't known", () => {
    expect(unforwardedEvents(["*"], ["message"])).toEqual([]);
    expect(unforwardedEvents(["message"], ["*"])).toEqual([]);
    expect(unforwardedEvents(["message"], [])).toEqual([]);
    expect(unforwardedEvents(undefined, ["message"])).toEqual([]);
    expect(unforwardedEvents([], ["message"])).toEqual([]);
  });

  it("names them in a sentence", () => {
    expect(eventNames(["app_mention"])).toBe("app_mention");
    expect(eventNames(["app_mention", "reaction_added"])).toBe("app_mention and reaction_added");
    expect(eventNames(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("event choices", () => {
  it("Slack offers its common events, including the @mention that arrives next to a message", () => {
    const values = SOURCES.slack.events.map((e) => e.value);
    expect(values).toEqual(expect.arrayContaining(["message", "app_mention"]));
    expect(new Set(values).size).toBe(values.length);
  });
});
