/**
 * HTTPS for direct mode. Without a certificate of its own, the console makes a
 * self-signed one (ECDSA P-256) and keeps it in the state folder, so the
 * browser's "not private" exception survives restarts. Node can't create
 * certificates, so the DER is written here; it's small and fixed in shape.
 */

import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { stateDir } from "./store";

export interface TlsFiles {
  cert: string;
  key: string;
}

// --- DER encoding, just what a certificate needs ---

function der(tag: number, content: Buffer): Buffer {
  const n = content.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...items: Buffer[]) => der(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => der(0x31, Buffer.concat(items));
const explicit = (n: number, content: Buffer) => der(0xa0 + n, content);
const octets = (b: Buffer) => der(0x04, b);
const bits = (b: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s: string) => der(0x0c, Buffer.from(s, "utf8"));
const bool = (v: boolean) => der(0x01, Buffer.from([v ? 0xff : 0]));

function integer(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const trimmed = b.subarray(i);
  return der(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return der(0x06, Buffer.from(out));
}

/** UTCTime, valid until 2049, which is far beyond any certificate made here. */
function time(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(s, "ascii"));
}

function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split(".").map(Number));
  const [head, tail] = ip.split("::");
  const groups = (s?: string) => (s ? s.split(":").filter(Boolean) : []);
  const h = groups(head);
  const t = groups(tail);
  const all = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return Buffer.from(all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]));
}

const VALID_DAYS = 825;

/** A self-signed certificate for these host names and IP addresses. */
export function selfSignedCertificate(names: string[], now = new Date()): TlsFiles {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const subject = seq(set(seq(oid("2.5.4.3"), utf8("Not Today console"))));
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000);

  const altNames = [...new Set(names)].map((n) => (isIP(n) ? der(0x87, ipBytes(n)) : der(0x82, Buffer.from(n, "ascii"))));
  const extensions = seq(
    seq(oid("2.5.29.19"), bool(true), octets(seq())), // basicConstraints: not a CA
    seq(oid("2.5.29.15"), bool(true), octets(bits(Buffer.from([0x80])))), // keyUsage: digitalSignature
    seq(oid("2.5.29.37"), octets(seq(oid("1.3.6.1.5.5.7.3.1")))), // extKeyUsage: serverAuth
    seq(oid("2.5.29.17"), octets(seq(...altNames))), // subjectAltName
  );

  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    ecdsaSha256,
    subject,
    seq(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: "spki", format: "der" }),
    explicit(3, extensions),
  );
  const certDer = seq(tbs, ecdsaSha256, bits(sign("sha256", tbs, privateKey)));
  const b64 = certDer.toString("base64").replace(/.{64}/g, "$&\n").trimEnd();
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** This machine's own addresses, for the certificate and the printed links. */
export function machineAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && !a.internal && !(a.family === "IPv6" && a.address.startsWith("fe80")))
    .map((a) => a!.address);
}

/**
 * The self-signed certificate in the state folder, made on first use and again
 * when it's within a month of expiring or doesn't cover a name it's asked for.
 */
export async function savedSelfSigned(names: string[]): Promise<TlsFiles & { created: boolean }> {
  const dir = join(stateDir(), "tls");
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const wanted = [...new Set(["localhost", "127.0.0.1", ...names])];
  try {
    const files = { cert: await readFile(certPath, "utf8"), key: await readFile(keyPath, "utf8") };
    const x509 = new X509Certificate(files.cert);
    const fresh = new Date(x509.validTo).getTime() - Date.now() > 30 * 24 * 60 * 60 * 1000;
    const covers = wanted.every((n) => (isIP(n) ? x509.checkIP(n) : x509.checkHost(n)) !== undefined);
    if (fresh && covers) return { ...files, created: false };
  } catch {
    // Missing, unreadable or damaged: make a new one below.
  }
  const files = selfSignedCertificate(wanted);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(stateDir(), 0o700);
  await writeFile(certPath, files.cert, { mode: 0o600 });
  await writeFile(keyPath, files.key, { mode: 0o600 });
  return { ...files, created: true };
}

export const fingerprint = (cert: string) => new X509Certificate(cert).fingerprint256;
