/**
 * How to create the Cloudflare API token the console needs. Used wherever a
 * token is asked for. The permission rows come from the shared list the token
 * link is built from, so the guide and the link always match.
 */

import { CLOUDFLARE_TOKEN_PERMISSIONS } from "@gw/shared";
import { Icon } from "./icons";

export function TokenGuide({ tokenUrl, accountHint }: { tokenUrl: string; accountHint?: string }) {
  return (
    <div className="token-guide">
      <ol className="howto">
        <li>
          <span>
            <b>Sign in to the Cloudflare account you want to connect</b>
            {accountHint ? <> ({accountHint})</> : null}. Its name is at the top left of the dashboard. A token only works for the accounts it is created in.
          </span>
        </li>
        <li>
          <span>
            <a className="btn primary" href={tokenUrl} target="_blank" rel="noreferrer">
              Open Cloudflare's "create token" page <Icon name="external" size={15} />
            </a>
            <span className="muted small token-note">It opens with the permissions below already ticked.</span>
          </span>
        </li>
        <li>
          <span>
            Check that <b>Permissions</b> lists all four rows below. If the page left one out, use <em>Add more</em> and choose it.
          </span>
        </li>
        <li>
          <span>
            Under <b>Account Resources</b>, choose <em>Include</em> and the account you're connecting (or <em>All accounts</em>). Zone Resources can stay as they are: the gateway doesn't use any domain.
          </span>
        </li>
        <li>
          <span>
            Click <b>Continue to summary</b>, then <b>Create Token</b>, and copy the token. Cloudflare shows it only once.
          </span>
        </li>
        <li>
          <span>Paste it below.</span>
        </li>
      </ol>

      <h4 className="tune-title">Permissions the token needs</h4>
      <ul className="perms">
        {CLOUDFLARE_TOKEN_PERMISSIONS.map((p) => (
          <li key={p.key}>
            <code className="code-chip">
              Account › {p.area} › {p.level}
            </code>
            <span className="small muted">{p.why}</span>
          </li>
        ))}
      </ul>

      <details className="disclosure">
        <summary>
          <span>If the link doesn't pre-fill anything, or you'd rather do it by hand</span>
          <span className="chev">
            <Icon name="chevron" size={16} />
          </span>
        </summary>
        <div className="disclosure-body small">
          <ol className="steps">
            <li>
              In Cloudflare, open <strong>My Profile → API Tokens → Create Token</strong>.
            </li>
            <li>
              Choose <strong>Create Custom Token</strong>, name it, and add the four permission rows above (each is "Account", then the area, then Edit or Read).
            </li>
            <li>Set Account Resources as in step 4, then create the token.</li>
          </ol>
        </div>
      </details>

      <details className="disclosure">
        <summary>
          <span>Two things each Cloudflare account needs once (the console tells you when)</span>
          <span className="chev">
            <Icon name="chevron" size={16} />
          </span>
        </summary>
        <div className="disclosure-body small">
          <ul>
            <li>
              <strong>A workers.dev address.</strong> A brand-new account has none until you open <em>Workers & Pages</em> in the dashboard once and choose a subdomain. It's free. Without it, the install stops and says so.
            </li>
            <li>
              <strong>Analytics Engine,</strong> only if you want the stats on the Dashboard. Creating one dataset turns it on; the setup checklist shows the exact name to use. Routing works without it.
            </li>
          </ul>
        </div>
      </details>
    </div>
  );
}
