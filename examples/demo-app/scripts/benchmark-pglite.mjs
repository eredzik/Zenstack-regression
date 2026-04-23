/**
 * ZenStack v2 vs v3 benchmark on in-memory PGlite (no Docker).
 * - Prisma via pglite-prisma-adapter + query logging
 * - ZenStack v3 via kysely-pglite-dialect (enhance-v3.mjs when ZS_PGLITE_MODE=1)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { seedDemoDataset } from "../seed-data.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
const repoRoot = path.join(appRoot, "..", "..");

const { runBenchmark, printBenchmarkSummary } = await import(
  pathToFileURL(path.join(repoRoot, "dist", "benchmark.js")).href
);

const WARMUP = parseInt(process.env.ZS_BENCH_WARMUP ?? "3", 10) || 0;
const ITERATIONS = parseInt(process.env.ZS_BENCH_ITERATIONS ?? "15", 10) || 1;

async function createBenchmarkPrisma() {
  const pglite = new PGlite("memory://");
  await pglite.waitReady;
  const sqlPath = path.join(appRoot, "prisma", "pglite-init.sql");
  await pglite.exec(readFileSync(sqlPath, "utf8"));

  const adapter = new PrismaPGlite(pglite);
  const prisma = new PrismaClient({
    adapter,
    log: [{ level: "query", emit: "event" }],
  });

  globalThis.__zenstackBenchPglite = pglite;

  await prisma.$connect();
  await seedDemoDataset(prisma);

  return prisma;
}

async function main() {
  process.env.ZS_PGLITE_MODE = "1";

  const cwd = appRoot;
  const queriesModule = path.join(cwd, ".zenstack-compare", "out", "queries.js");
  const enhanceV2 = path.join(cwd, "enhance-v2.mjs");
  const enhanceV3 = path.join(cwd, "enhance-v3.mjs");

  const rounds = await runBenchmark({
    cwd,
    queriesModule: pathToFileURL(queriesModule).href,
    enhanceV2Module: pathToFileURL(enhanceV2).href,
    enhanceV3Module: pathToFileURL(enhanceV3).href,
    prismaClientSpecifier: "@prisma/client",
    prismaFactory: createBenchmarkPrisma,
    queryIds: [],
    queryIdFilePathSubstring: "benchmark-queries",
    queryFixtures: {},
    warmups: WARMUP,
    iterations: ITERATIONS,
  });

  const json = process.argv.includes("--json");
  printBenchmarkSummary(rounds, json);

  if (!json) {
    const benchPath = path.join(appRoot, "src", "benchmark-queries.ts");
    const benchLines = readFileSync(benchPath, "utf8").split("\n");
    const fnAtLine = [];
    for (let i = 0; i < benchLines.length; i++) {
      const m = benchLines[i].match(
        /^\s*export\s+async\s+function\s+(\w+)\s*\(/
      );
      if (m) fnAtLine.push({ name: m[1], line: i + 1 });
    }
    function fnForExtractLine(line) {
      let name = null;
      for (const e of fnAtLine) {
        if (e.line <= line) name = e.name;
        else break;
      }
      return name;
    }

    const manifest = JSON.parse(
      readFileSync(path.join(cwd, ".zenstack-compare", "extract-manifest.json"), "utf8")
    );
    const idToFn = new Map();
    for (const q of manifest.queries ?? []) {
      if (typeof q.file === "string" && q.file.includes("benchmark-queries")) {
        idToFn.set(q.id, fnForExtractLine(q.line));
      }
    }

    console.log("");
    console.log("# queryId → benchmark function (src/benchmark-queries.ts)");
    const seen = new Set();
    for (const r of rounds) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const name = idToFn.get(r.id);
      if (name) console.log(`${r.id}\t${name}`);
    }
  }

  const pg = globalThis.__zenstackBenchPglite;
  if (pg && typeof pg.close === "function") {
    await pg.close();
  }
  delete globalThis.__zenstackBenchPglite;
  process.env.ZS_PGLITE_MODE = "";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
