/**
 * `--tailscale`: the console stays on 127.0.0.1 and `tailscale serve` shares it
 * at https://<machine>.<tailnet>.ts.net, with a real certificate, inside the
 * tailnet only. It runs in the foreground, so the share ends with the console.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";

export class TailscaleError extends Error {}

export type Run = (args: string[]) => Promise<string>;

const runTailscale: Run = (args) =>
  new Promise((resolve, reject) => {
    execFile("tailscale", args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        reject(new TailscaleError("Tailscale isn't installed on this machine. Install it from https://tailscale.com/download, run `tailscale up`, then try again."));
      } else if (err) reject(new TailscaleError(`tailscale ${args[0]} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });

/** This machine's name on the tailnet, e.g. "vps.tail1234.ts.net". */
export async function tailscaleName(run: Run = runTailscale): Promise<string> {
  let status: { BackendState?: string; Self?: { DNSName?: string } };
  try {
    status = JSON.parse(await run(["status", "--json"]));
  } catch (err) {
    if (err instanceof TailscaleError) throw err;
    throw new TailscaleError("Couldn't read `tailscale status`. Check that Tailscale is running.");
  }
  if (status.BackendState !== "Running") {
    throw new TailscaleError(`Tailscale isn't connected (it says "${status.BackendState ?? "unknown"}"). Run \`tailscale up\`, then try again.`);
  }
  const name = status.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
  if (!name) {
    throw new TailscaleError("This machine has no tailnet name. Turn on MagicDNS and HTTPS certificates in the Tailscale admin console (DNS page), then try again.");
  }
  return name;
}

/**
 * Starts `tailscale serve` for the console's port. Its output is passed
 * through: the first time, it may print a link to turn Serve on for the tailnet.
 */
export function startServe(port: number, onExit: (code: number | null) => void): ChildProcess {
  const child = spawn("tailscale", ["serve", "--https=443", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      // Its own "Press Ctrl+C" line would be confusing next to ours.
      if (line.trim() && !/ctrl\+c/i.test(line)) console.log(`  tailscale: ${line.trimEnd()}`);
    }
  };
  child.stdout.on("data", relay);
  child.stderr.on("data", relay);
  child.on("error", () => onExit(null));
  child.on("exit", (code) => onExit(code));
  return child;
}

/** Shown when `tailscale serve` stops on its own. */
export const SERVE_HINT =
  "tailscale serve stopped. If it said access denied, let your user manage it once with `sudo tailscale set --operator=$USER`. If HTTPS isn't on for the tailnet, turn it on in the Tailscale admin console (DNS page).";
