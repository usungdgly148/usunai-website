import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const skippedDirectories = new Set([".git", "node_modules", "coverage", "logs"]);
const textExtensions = new Set([
  ".conf", ".css", ".example", ".html", ".js", ".json", ".md", ".mjs",
  ".service", ".txt", ".yaml", ".yml",
]);
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\\n|\r?\n)[A-Za-z0-9+/]{32,}/],
  ["tencent-secret-id", /AKID[A-Za-z0-9]{12,}/],
  ["aliyun-access-id", /LTAI[A-Za-z0-9]{12,}/],
  ["api-key-literal", /(?<![A-Za-z0-9])(?:sk|pat)[-_.][A-Za-z0-9_.-]{16,}/],
  ["jwt-literal", /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/],
  ["secret-assignment", /(?:password|secret(?:key)?|api[_-]?key|token)\s*[:=]\s*["'][A-Za-z0-9_.+/=-]{24,}["']/i],
];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const findings = [];
for (const file of walk(root)) {
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  if (statSync(file).size > 3_000_000) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [name, pattern] of rules) {
      if (pattern.test(line)) {
        findings.push(`${relative(root, file)}:${index + 1} [${name}]`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error("Potential secrets detected (values intentionally hidden):");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Secret pattern scan passed.");
