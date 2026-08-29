import { readFileSync, writeFileSync } from "node:fs";

const MIRROR_BASE = "https://api.16-launcher.ru/releases";

function rewriteUpdateManifest(manifest) {
  if (!manifest?.version || !manifest?.platforms) {
    throw new Error("Invalid updater manifest: expected version and platforms");
  }

  const version = String(manifest.version).replace(/^v/i, "");
  const mirrorBase = `${MIRROR_BASE}/v${version}/`;

  for (const platform of Object.values(manifest.platforms)) {
    if (!platform?.url) continue;
    const filename = platform.url.split("/").pop();
    if (!filename) continue;
    platform.url = `${mirrorBase}${filename}`;
  }

  return manifest;
}

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? inputPath;

if (!inputPath) {
  console.error("Usage: node scripts/rewrite-update-mirror.mjs <input.json> [output.json]");
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const manifest = rewriteUpdateManifest(JSON.parse(raw));
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Rewrote updater URLs to ${MIRROR_BASE}/v${manifest.version}/`);
console.log(`Saved: ${outputPath}`);
