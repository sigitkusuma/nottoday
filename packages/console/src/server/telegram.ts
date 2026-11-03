/**
 * The two Telegram Bot API calls the console makes when connecting a bot. The
 * bot token is used for these calls only: it is never stored or logged.
 * https://core.telegram.org/bots/api#setwebhook
 */

export class TelegramError extends Error {}

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw new TelegramError("That doesn't look like a bot token. BotFather shows it as numbers, a colon, then letters, e.g. 123456:ABC-DEF…");
  }

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Never echo the error: some include the URL, which contains the token.
      throw new TelegramError("Couldn't reach Telegram. Check your internet connection and try again.");
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (res.status === 401 || res.status === 404) throw new TelegramError("Telegram didn't accept that bot token. Copy it again from BotFather (/mybots → your bot → API Token).");
    if (!body.ok) throw new TelegramError(`Telegram said: ${body.description ?? `HTTP ${res.status}`}`);
    return body.result as T;
  }

  getMe(): Promise<{ id: number; username?: string; first_name?: string }> {
    return this.call("getMe");
  }

  /** Points the bot at the gateway. Telegram then sends `secretToken` in X-Telegram-Bot-Api-Secret-Token with every update. */
  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call("setWebhook", { url, secret_token: secretToken });
  }
}
