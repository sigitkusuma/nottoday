import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stateDir } from "../src/server/store";

describe("state folder", () => {
  const saved = { HOME: process.env.HOME, NOTTODAY_HOME: process.env.NOTTODAY_HOME, SLACK_GATEWAY_HOME: process.env.SLACK_GATEWAY_HOME };
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "nottoday-home-"));
    process.env.HOME = home;
    delete process.env.NOTTODAY_HOME;
    delete process.env.SLACK_GATEWAY_HOME;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("uses ~/.config/nottoday on a fresh machine", () => {
    expect(stateDir()).toBe(join(home, ".config", "nottoday"));
  });

  it("keeps using the folder from before the rename, so saved accounts carry over", () => {
    mkdirSync(join(home, ".config", "slack-gateway"), { recursive: true });
    expect(stateDir()).toBe(join(home, ".config", "slack-gateway"));
  });

  it("prefers the new folder once it exists", () => {
    mkdirSync(join(home, ".config", "slack-gateway"), { recursive: true });
    mkdirSync(join(home, ".config", "nottoday"), { recursive: true });
    expect(stateDir()).toBe(join(home, ".config", "nottoday"));
  });

  it("honours NOTTODAY_HOME, and the old variable name", () => {
    process.env.SLACK_GATEWAY_HOME = "/tmp/old-var";
    expect(stateDir()).toBe("/tmp/old-var");
    process.env.NOTTODAY_HOME = "/tmp/new-var";
    expect(stateDir()).toBe("/tmp/new-var");
  });
});
