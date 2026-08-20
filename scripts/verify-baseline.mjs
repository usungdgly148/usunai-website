import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const requiredFiles = [
  "server/index.mjs",
  "server/billing.js",
  "server/kv-local.js",
  "server/rag.mjs",
  "server/package.json",
  "server/package-lock.json",
  "dist/index.html",
  "deploy/usun.service",
  "deploy/usun.nginx.conf",
];
const forbiddenSegments = new Set([
  "backups", "deploy-backups", "image-variants", "knowledge-files", "node_modules",
  "qdrant-snapshots", "qdrant-storage", "uploads",
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const errors = [];
for (const required of requiredFiles) {
  if (!existsSync(join(root, required))) errors.push(`Missing required file: ${required}`);
}

for (const file of walk(root)) {
  const path = relative(root, file).replaceAll("\\", "/");
  const segments = path.split("/");
  const name = segments.at(-1);
  if (segments.some((segment) => forbiddenSegments.has(segment))) errors.push(`Forbidden runtime path: ${path}`);
  if (name === ".env" || (/^\.env\./.test(name) && name !== ".env.example")) errors.push(`Forbidden environment file: ${path}`);
  if (/\.(?:db|sqlite|sqlite3)(?:-|$)/i.test(name)) errors.push(`Forbidden database file: ${path}`);
  if (/\.bak(?:[-.]|$)|\.pre[-.]/i.test(name)) errors.push(`Forbidden backup file: ${path}`);
}

const indexPath = join(root, "dist/index.html");
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf8");
  const assetReferences = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)].map((match) => match[1]);
  for (const reference of new Set(assetReferences)) {
    const localPath = join(root, "dist", reference.replace(/^\/assets\//, "assets/"));
    if (!existsSync(localPath)) errors.push(`Missing referenced asset: ${reference}`);
  }
}

const syntaxFiles = walk(join(root, "server"))
  .filter((file) => [".js", ".mjs"].includes(extname(file).toLowerCase()));
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf8");
  for (const match of html.matchAll(/src="(\/assets\/[^"?]+\.js)(?:\?[^"]*)?"/g)) {
    syntaxFiles.push(join(root, "dist", match[1].replace(/^\/assets\//, "assets/")));
  }
}

for (const file of new Set(syntaxFiles)) {
  if (!existsSync(file) || statSync(file).size === 0) {
    errors.push(`Missing or empty JavaScript file: ${relative(root, file)}`);
    continue;
  }
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) errors.push(`JavaScript syntax check failed: ${relative(root, file)}`);
}

if (errors.length > 0) {
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Repository boundary, asset references and JavaScript syntax checks passed.");
