#!/usr/bin/env node
/**
 * Run strict compare and print a human-readable issue summary (stdout).
 * Uses DATABASE_URL from the environment (same as prisma / enhance-v3).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");

const manifestPath = path.join(appRoot, ".zenstack-compare", "extract-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const idToFile = new Map(
  manifest.queries.map((q) => [q.id, `${q.file}:${q.line}`])
);

const { runCompare } = await import(
  pathToFileURL(path.join(repoRoot, "dist", "compare.js")).href
);

const fixturesPath =
  process.env.ZS_FIXTURES ??
  (fs.existsSync(path.join(appRoot, ".zenstack-compare", "query-fixtures.json"))
    ? ".zenstack-compare/query-fixtures.json"
    : undefined);
let queryFixtures;
if (fixturesPath) {
  const abs = path.isAbsolute(fixturesPath)
    ? fixturesPath
    : path.join(appRoot, fixturesPath);
  const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  queryFixtures = doc.queries;
}

const rows = await runCompare({
  cwd: appRoot,
  queriesDir: path.join(appRoot, ".zenstack-compare", "queries"),
  enhanceV2Module: pathToFileURL(
    path.join(appRoot, ".zenstack-compare", "enhance-v2.mjs")
  ).href,
  enhanceV3Module: pathToFileURL(
    path.join(appRoot, ".zenstack-compare", "enhance-v3.mjs")
  ).href,
  prismaClientSpecifier: "@prisma/client",
  json: false,
  silent: true,
  queryFixtures,
});

const issues = [];
for (const r of rows) {
  const parts = [];
  if (r.errorV2) parts.push(`v2 error: ${r.errorV2}`);
  if (r.errorV3) parts.push(`v3 error: ${r.errorV3}`);
  if (!r.resultsMatch && !r.errorV2 && !r.errorV3) {
    parts.push("JSON payload mismatch");
  }
  if (!r.sqlMatch && !r.errorV2 && !r.errorV3) {
    parts.push("SQL text mismatch");
  }
  if (!r.recordCountsMatch && !r.errorV2 && !r.errorV3) {
    parts.push(
      `record counts differ (v2=${r.recordCountV2} v3=${r.recordCountV3})`
    );
  }
  if (parts.length) {
    issues.push({ id: r.id, details: parts.join("; ") });
  }
}

console.log("");
console.log("=== Compare issue summary (strict: SQL + JSON) ===");
console.log(`Total queries: ${rows.length}`);
console.log(`Rows with any issue: ${issues.length}`);
if (issues.length === 0) {
  console.log("No issues — all SQL and JSON match.");
  process.exit(0);
}

const mismatchJson = rows.filter((r) => !r.resultsMatch && !r.errorV2 && !r.errorV3);
const sqlOnly = rows.filter(
  (r) =>
    r.resultsMatch &&
    !r.sqlMatch &&
    !r.errorV2 &&
    !r.errorV3
);

if (mismatchJson.length) {
  console.log("");
  console.log("--- JSON payload mismatch (v2 vs v3) — highest priority ---");
  for (const r of mismatchJson) {
    const loc = idToFile.get(r.id) ?? "?";
    console.log(`- ${r.id}  (${loc})`);
  }
}

console.log("");
console.log("--- All issues (id + location + detail) ---");
for (const { id, details } of issues) {
  const loc = idToFile.get(id) ?? "?";
  console.log(`- ${id}  (${loc})`);
  console.log(`  ${details}`);
}

console.log("");
console.log("--- Breakdown ---");
console.log(`JSON mismatch (both ran): ${mismatchJson.length}`);
console.log(`SQL-only mismatch (JSON OK): ${sqlOnly.length}`);
console.log(`Errors on either side: ${rows.filter((r) => r.errorV2 || r.errorV3).length}`);

process.exit(issues.length > 0 ? 1 : 0);
