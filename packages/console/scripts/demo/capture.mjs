#!/usr/bin/env node
/**
 * Captures the console's screenshots from the demo server with headless Chrome.
 * puppeteer-core is not a dependency of this repo: install it anywhere outside
 * it and point PUPPETEER_DIR there. See README.md in this folder.
 *
 *   node scripts/demo/capture.mjs readme  [baseUrl]   # docs/screenshots, 2040x1290
 *   node scripts/demo/capture.mjs launch  [baseUrl]   # docs/launch/raw, 2540x1520
 *   node scripts/demo/capture.mjs accounts [baseUrl]  # docs/launch/raw/accounts.png (run the server without DEMO_ACCOUNTS=1)
 */

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [preset = "readme", base = "http://localhost:5173"] = process.argv.slice(2);
const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PRESETS = {
  // 1360x860 CSS at 1.5x: wide enough for the route editor's side preview (it needs 1100px).
  readme: { width: 1360, height: 860, scale: 1.5, out: "docs/screenshots", shots: ["dashboard", "route-editor", "connect-wizard"] },
  launch: { width: 1270, height: 760, scale: 2, out: "docs/launch/raw", shots: ["dashboard", "route-editor", "connect-wizard", "activity", "app-page"] },
  accounts: { width: 1270, height: 760, scale: 2, out: "docs/launch/raw", shots: ["accounts"] },
};
const p = PRESETS[preset];
if (!p) throw new Error(`Unknown preset "${preset}". Use ${Object.keys(PRESETS).join(", ")}.`);

const dir = process.env.PUPPETEER_DIR;
if (!dir) throw new Error("Set PUPPETEER_DIR to a folder where `npm install puppeteer-core` was run.");
const entry = createRequire(join(resolve(dir), "noop.js")).resolve("puppeteer-core");
const { default: puppeteer } = await import(pathToFileURL(entry).href);

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--lang=en-US", "--hide-scrollbars", "--force-color-profile=srgb"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(hash) {
  const page = await browser.newPage();
  await page.setViewport({ width: p.width, height: p.height, deviceScaleFactor: p.scale });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  // The live stream never goes idle, so wait for load and then for the data to arrive.
  await page.goto(`${base}/#${hash}`, { waitUntil: "load" });
  await sleep(2500);
  return page;
}

async function clickText(page, selector, text) {
  const found = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t));
      el?.click();
      return Boolean(el);
    },
    selector,
    text,
  );
  if (!found) throw new Error(`No ${selector} containing "${text}"`);
  await sleep(500);
}

async function settle(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.activeElement?.blur();
  });
  await sleep(400);
}

const SHOTS = {
  dashboard: () => open("overview"),
  async "route-editor"() {
    const page = await open("apps/support-bot");
    await clickText(page, "button", "Add route");
    await clickText(page, "label.tile", "Messages containing a keyword");
    await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent.includes("Choose a workflow trigger")));
      const option = [...select.options].find((o) => o.textContent.includes("Support triage"));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.type('input[placeholder^="e.g. deploying"]', "checkout is down, looks like an outage");
    await settle(page);
    return page;
  },
  async "connect-wizard"() {
    const page = await open("apps/new");
    await clickText(page, "button.tile", "Slack");
    await page.type('input[type="text"]', "Release Notes");
    await clickText(page, "button", "Next");
    await settle(page);
    return page;
  },
  async activity() {
    const page = await open("live");
    // Open the first shadow-mode request: its details explain why it would be dropped.
    await page.evaluate(() => [...document.querySelectorAll("button.feed-row")].find((b) => b.querySelector(".pill.shadow"))?.click());
    await sleep(500);
    await page.evaluate(() => {
      const item = document.querySelector(".feed-item.open");
      if (item) window.scrollTo(0, Math.max(0, item.getBoundingClientRect().top + window.scrollY - 330));
      document.activeElement?.blur();
    });
    await sleep(400);
    return page;
  },
  // The Slack noise hint and the shadow route's "Switch to enforce".
  "app-page": () => open("apps/support-bot"),
  async accounts() {
    const page = await open("overview");
    await page.click(".switcher-btn");
    await sleep(500);
    return page;
  },
};

for (const name of p.shots) {
  const page = await SHOTS[name]();
  const file = join(root, p.out, `${name}.png`);
  await page.screenshot({ path: file });
  await page.close();
  console.log(`saved ${file}`);
}
await browser.close();
