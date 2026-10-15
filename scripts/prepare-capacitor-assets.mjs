import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

// Build output may land in .output/public or dist/client depending on the bundler preset.
// Copy to a temp folder first because the destination (dist) can contain the source.
const candidates = [".output/public/plotos", "dist/client/plotos", "public/plotos"].map((p) => resolve(p));
const found = candidates.find((p) => existsSync(resolve(p, "index.html"))) ?? candidates[0];
const staging = resolve("node_modules/.cache/plotos-mobile");
if (existsSync(resolve(found, "index.html"))) {
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(found, staging, { recursive: true });
}
const source = staging;
const destination = resolve("dist");
const entryPoint = resolve(source, "index.html");

if (!existsSync(entryPoint)) {
  throw new Error(`PLOTOS web assets were not found at ${source}. Run the web build first.`);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

await build({
  entryPoints: [resolve("scripts/native-app-bridge.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: resolve(destination, "native-app-bridge.js"),
});

const mobileIndex = resolve(destination, "index.html");
const indexHtml = readFileSync(mobileIndex, "utf8");
const bridgeTag = '<script src="./native-app-bridge.js"></script>';
if (!indexHtml.includes(bridgeTag)) {
  const updatedHtml = indexHtml.replace(/<\/body>/i, `${bridgeTag}\n</body>`);
  if (updatedHtml === indexHtml) {
    throw new Error(`Could not inject the mobile bridge into ${mobileIndex}.`);
  }
  writeFileSync(mobileIndex, updatedHtml);
}

console.log(`Prepared Capacitor web assets in ${destination}`);
