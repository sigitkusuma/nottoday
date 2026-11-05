import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostAllowed, localHosts, savedSessionToken, splitHost, tokenMatches } from "../src/server/access";
import { createApp } from "../src/server/app";
import { parseArgs, type CliOptions } from "../src/server/options";
import { tailscaleName, TailscaleError } from "../src/server/tailscale";
import { savedSelfSigned, selfSignedCertificate } from "../src/server/tls";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "gw-server-"));
  process.env.NOTTODAY_HOME = home;
});
afterEach(async () => {
  delete process.env.NOTTODAY_HOME;
  await rm(home, { recursive: true, force: true });
});

const options = (argv: string[]) => parseArgs(argv) as CliOptions;

describe("options", () => {
  it("defaults to the local console", () => {
    expect(options([])).toMatchObject({ mode: "local", host: "127.0.0.1", port: 4870, open: true, insecureHttp: false, allowHosts: [] });
    expect(options(["--no-open", "--port=5000"])).toMatchObject({ open: false, port: 5000 });
  });

  it("--host on another address is direct mode, and doesn't open a browser", () => {
    expect(options(["--host", "0.0.0.0"])).toMatchObject({ mode: "direct", open: false });
    expect(options(["--host", "0.0.0.0", "--cert", "c.pem", "--key", "k.pem"]).tls).toEqual({ cert: "c.pem", key: "k.pem" });
    expect(options(["--host", "0.0.0.0", "--allow-host", "Console.Example.com,other.example", "--allow-host", "third.example"]).allowHosts).toEqual([
      "console.example.com",
      "other.example",
      "third.example",
    ]);
  });

  it("--tailscale keeps the console on 127.0.0.1", () => {
    expect(options(["--tailscale"])).toMatchObject({ mode: "tailscale", host: "127.0.0.1", open: false });
  });

  it("rejects combinations that can't work", () => {
    for (const argv of [
      ["--tailscale", "--host", "0.0.0.0"],
      ["--tailscale", "--cert", "c", "--key", "k"],
      ["--host", "0.0.0.0", "--cert", "c"],
      ["--host", "0.0.0.0", "--insecure-http", "--cert", "c", "--key", "k"],
      ["--insecure-http"],
      ["--port", "80"],
      ["--port"],
      ["--host", "not a host"],
      ["--allow-host", "bad_name!"],
      ["--bogus"],
    ]) {
      expect(parseArgs(argv), argv.join(" ")).toHaveProperty("error");
    }
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs(["--version"])).toEqual({ version: true });
    expect(parseArgs(["-v"])).toEqual({ version: true });
  });
});

describe("host check", () => {
  it("splits host headers, IPv6 included", () => {
    expect(splitHost("127.0.0.1:4870")).toEqual({ name: "127.0.0.1", port: 4870 });
    expect(splitHost("[::1]:4870")).toEqual({ name: "::1", port: 4870 });
    expect(splitHost("Vps.Tail1.ts.net")).toEqual({ name: "vps.tail1.ts.net" });
  });

  it("local mode answers to 127.0.0.1 and localhost on its port only", () => {
    const local = localHosts(4870);
    expect(hostAllowed("127.0.0.1:4870", local)).toBe(true);
    expect(hostAllowed("localhost:4870", local)).toBe(true);
    expect(hostAllowed("127.0.0.1:4871", local)).toBe(false);
    expect(hostAllowed("203.0.113.5:4870", local)).toBe(false);
    expect(hostAllowed(undefined, local)).toBe(false);
  });

  it("direct mode also answers to any IP and the allowed names, never other names", () => {
    const direct = { port: 4870, names: ["127.0.0.1", "localhost", "console.example.com"], anyIp: true };
    expect(hostAllowed("203.0.113.5:4870", direct)).toBe(true);
    expect(hostAllowed("[2001:db8::1]:4870", direct)).toBe(true);
    expect(hostAllowed("console.example.com:4870", direct)).toBe(true);
    expect(hostAllowed("evil.example:4870", direct)).toBe(false);
    expect(hostAllowed("203.0.113.5", direct)).toBe(false);
  });

  it("tailscale mode answers to the tailnet name without a port", () => {
    const ts = { ...localHosts(4870), bareNames: ["vps.tail1.ts.net"] };
    expect(hostAllowed("vps.tail1.ts.net", ts)).toBe(true);
    expect(hostAllowed("vps.tail1.ts.net:443", ts)).toBe(true);
    expect(hostAllowed("other.tail1.ts.net", ts)).toBe(false);
    expect(hostAllowed("127.0.0.1:4870", ts)).toBe(true);
  });

  it("the app refuses other hosts and wrong tokens", async () => {
    const app = createApp({ sessionToken: "s".repeat(32), port: 4870, hosts: { port: 4870, names: ["127.0.0.1"], anyIp: true }, loadEngine: async () => "" });
    const get = (host: string, token: string) => app.request("/api/status", { headers: { host, "x-session-token": token } });
    expect((await get("evil.example:4870", "s".repeat(32))).status).toBe(403);
    expect((await get("203.0.113.5:4870", "wrong")).status).toBe(401);
    const ok = await get("203.0.113.5:4870", "s".repeat(32));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("session token", () => {
  it("matches only the exact token", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches(undefined, "abc")).toBe(false);
  });

  it("server modes keep the token between starts, readable only by the user", async () => {
    const first = await savedSessionToken(false);
    expect(first.created).toBe(true);
    expect(await savedSessionToken(false)).toEqual({ token: first.token, created: false });
    expect((await stat(join(home, "console-token"))).mode & 0o777).toBe(0o600);
    const replaced = await savedSessionToken(true);
    expect(replaced.token).not.toBe(first.token);
    expect((await savedSessionToken(false)).token).toBe(replaced.token);
  });
});

describe("self-signed certificate", () => {
  it("is a valid, self-signed server certificate for the given names", () => {
    const { cert, key } = selfSignedCertificate(["localhost", "127.0.0.1", "203.0.113.5", "2001:db8::1", "console.example.com"]);
    const x509 = new X509Certificate(cert);
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.checkPrivateKey(createPrivateKey(key))).toBe(true);
    expect(x509.checkHost("console.example.com")).toBe("console.example.com");
    expect(x509.checkIP("203.0.113.5")).toBe("203.0.113.5");
    expect(x509.checkIP("2001:db8::1")).toBe("2001:db8::1");
    expect(x509.checkHost("evil.example")).toBeUndefined();
    expect(x509.ca).toBe(false);
    expect(x509.keyUsage).toContain("1.3.6.1.5.5.7.3.1");
    const days = (new Date(x509.validTo).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(800);
  });

  it("is saved and reused, and replaced when it doesn't cover a new name", async () => {
    const first = await savedSelfSigned(["203.0.113.5"]);
    expect(first.created).toBe(true);
    expect((await stat(join(home, "tls", "key.pem"))).mode & 0o777).toBe(0o600);
    const again = await savedSelfSigned(["203.0.113.5"]);
    expect(again).toMatchObject({ created: false, cert: first.cert });
    const wider = await savedSelfSigned(["203.0.113.5", "console.example.com"]);
    expect(wider.created).toBe(true);
  });
});

describe("tailscale", () => {
  const status = (s: object) => async () => JSON.stringify(s);

  it("reads the machine's tailnet name", async () => {
    expect(await tailscaleName(status({ BackendState: "Running", Self: { DNSName: "VPS.tail1234.ts.net." } }))).toBe("vps.tail1234.ts.net");
  });

  it("explains why it can't be used", async () => {
    await expect(tailscaleName(status({ BackendState: "Stopped" }))).rejects.toThrow(/tailscale up/);
    await expect(tailscaleName(status({ BackendState: "Running", Self: { DNSName: "" } }))).rejects.toThrow(/MagicDNS/);
    await expect(tailscaleName(async () => "not json")).rejects.toBeInstanceOf(TailscaleError);
  });
});
