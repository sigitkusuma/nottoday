/**
 * Command-line options. Three ways to run the console:
 * - local (default): http://127.0.0.1, a new session token on every start.
 * - direct (`--host 0.0.0.0`): reachable from other machines over HTTPS, with
 *   a self-signed certificate unless `--cert`/`--key` are given.
 * - tailscale (`--tailscale`): stays on 127.0.0.1; `tailscale serve` makes it
 *   reachable at https://<machine>.<tailnet>.ts.net, inside the tailnet only.
 * The two server modes keep the session token between starts, so a saved link
 * keeps working.
 */

import { isIP } from "node:net";

export type Mode = "local" | "direct" | "tailscale";

export interface CliOptions {
  mode: Mode;
  port: number;
  /** The address to listen on. */
  host: string;
  open: boolean;
  tls?: { cert: string; key: string };
  /** Direct mode without HTTPS. */
  insecureHttp: boolean;
  /** Host names (besides IP addresses) the console answers to in direct mode. */
  allowHosts: string[];
  newToken: boolean;
}

export type ParsedArgs = CliOptions | { help: true } | { error: string };

export const USAGE = `Usage: nottoday [options]

Starts the gateway console and opens it in your browser.

  --port <n>           Port to listen on (default 4870)
  --no-open            Don't open the browser

Running it on a server:
  --host <address>     Listen on this address, e.g. 0.0.0.0 for every network
                       interface. Uses HTTPS with a self-signed certificate.
  --cert <file>        Use this certificate instead (PEM); needs --key
  --key <file>         The certificate's private key (PEM)
  --allow-host <name>  Also answer to this host name (comma-separated, or repeat)
  --insecure-http      Plain HTTP on --host. Anyone on the network path can
                       read the session token; use only on a trusted network.
  --tailscale          Share the console on your tailnet with tailscale serve,
                       at https://<machine>.<tailnet>.ts.net. Nothing is
                       opened to the internet.
  --new-token          Replace the saved session token (server modes keep it
                       between starts so a saved link keeps working)`;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
export const isLoopback = (host: string) => LOOPBACK.has(host);

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values: Record<string, string[]> = {};
  const takesValue = new Set(["--port", "--host", "--cert", "--key", "--allow-host"]);
  const known = new Set([...takesValue, "--no-open", "--insecure-http", "--tailscale", "--new-token", "--help", "-h"]);
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].startsWith("--") && argv[i].includes("=") ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)] : [argv[i], undefined];
    if (!known.has(name)) return { error: `Unknown option ${name}. Run nottoday --help for the list.` };
    if (takesValue.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith("--")) return { error: `${name} needs a value.` };
      (values[name] ??= []).push(value);
    } else flags.add(name);
  }
  if (flags.has("--help") || flags.has("-h")) return { help: true };

  const last = (name: string) => values[name]?.at(-1);
  const port = last("--port") === undefined ? 4870 : Number(last("--port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { error: "--port must be a number between 1024 and 65535." };

  const host = last("--host") ?? "127.0.0.1";
  if (!isLoopback(host) && !isIP(host) && !HOSTNAME.test(host)) return { error: `--host ${host} isn't an IP address or host name.` };

  const allowHosts = (values["--allow-host"] ?? []).flatMap((v) => v.split(",")).map((h) => h.trim().toLowerCase()).filter(Boolean);
  const badHost = allowHosts.find((h) => !HOSTNAME.test(h) && !isIP(h));
  if (badHost) return { error: `--allow-host ${badHost} isn't a host name.` };

  const cert = last("--cert");
  const key = last("--key");
  if (Boolean(cert) !== Boolean(key)) return { error: "--cert and --key go together." };

  const tailscale = flags.has("--tailscale");
  const insecureHttp = flags.has("--insecure-http");
  if (tailscale && !isLoopback(host)) return { error: "--tailscale keeps the console on 127.0.0.1 and shares it through Tailscale. Leave out --host." };
  if (tailscale && cert) return { error: "--tailscale gets its certificate from Tailscale. Leave out --cert and --key." };
  if (insecureHttp && cert) return { error: "--insecure-http turns HTTPS off, so --cert and --key would be unused." };
  if (insecureHttp && isLoopback(host)) return { error: "--insecure-http is for --host. On 127.0.0.1 the console uses plain HTTP already." };

  const mode: Mode = tailscale ? "tailscale" : isLoopback(host) ? "local" : "direct";
  return {
    mode,
    port,
    host,
    // A server has nobody at its screen; open the browser only on your own machine.
    open: mode === "local" && !flags.has("--no-open"),
    tls: cert && key ? { cert, key } : undefined,
    insecureHttp,
    allowHosts,
    newToken: flags.has("--new-token"),
  };
}
