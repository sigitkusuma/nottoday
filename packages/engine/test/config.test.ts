import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_KEY } from "@gw/shared";
import { ConfigLoader } from "../src/config";
import example from "../examples/dev.config.json";

function fakeKv(initial: string | null) {
  const store = { value: initial, reads: 0, fail: false };
  const kv = {
    get: async (key: string) => {
      store.reads++;
      if (store.fail) throw new Error("KV unavailable");
      return key === CONFIG_KEY ? store.value : null;
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

const good = JSON.stringify(example);

beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("ConfigLoader", () => {
  it("loads and hashes the stored config", async () => {
    const { kv } = fakeKv(good);
    const loaded = await new ConfigLoader().get(kv, 0);
    expect(Object.keys(loaded!.config.apps)).toEqual(["demo"]);
    expect(loaded!.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("returns null when nothing is saved yet", async () => {
    expect(await new ConfigLoader().get(fakeKv(null).kv, 0)).toBeNull();
  });

  it("caches reads, then picks up a new save", async () => {
    const { kv, store } = fakeKv(good);
    const loader = new ConfigLoader(30_000);
    const first = await loader.get(kv, 0);
    await loader.get(kv, 10_000);
    expect(store.reads).toBe(1);

    const changed = structuredClone(example);
    changed.apps.demo.routes[0].mode = "enforce";
    store.value = JSON.stringify(changed);
    const second = await loader.get(kv, 31_000);
    expect(second!.config.apps.demo.routes[0].mode).toBe("enforce");
    expect(second!.hash).not.toBe(first!.hash);
  });

  it("keeps the last good config when a broken one is saved", async () => {
    const { kv, store } = fakeKv(good);
    const loader = new ConfigLoader(0);
    const first = await loader.get(kv, 0);

    store.value = "{ not json";
    expect(await loader.get(kv, 1)).toBe(first);

    store.value = JSON.stringify({ ...example, apps: { demo: { signingSecret: "x", routes: "oops" } } });
    expect(await loader.get(kv, 2)).toBe(first);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good config when KV can't be read", async () => {
    const { kv, store } = fakeKv(good);
    const loader = new ConfigLoader(0);
    const first = await loader.get(kv, 0);
    store.fail = true;
    expect(await loader.get(kv, 1)).toBe(first);
  });
});
