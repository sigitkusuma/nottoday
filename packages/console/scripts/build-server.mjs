// Bundles the CLI + server into dist/cli.js and copies the engine next to it,
// so the published package needs nothing from the monorepo.
import { build } from "esbuild";
import { chmod, copyFile } from "node:fs/promises";

await build({
  entryPoints: ["src/server/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
await chmod("dist/cli.js", 0o755);
await copyFile("../engine/dist/engine.js", "dist/engine.js");
console.log("Built dist/cli.js and dist/engine.js");
