/** First 12 hex chars of the SHA-256 of the stored config JSON. The engine shows it on /health; the console compares it to tell whether a save is live. */
export async function configHash(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
