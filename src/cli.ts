#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { buildManifest, defaultPrismaQueryMethods } from "./extract.js";
import { writeQueriesTs } from "./codegen.js";
import { runCompare } from "./compare.js";
import { runBenchmark } from "./benchmark.js";
import { loadQueryFixtures, writeFixturesTemplate } from "./fixtures.js";
import {
  generateFakerSeedScriptFromDmmf,
  loadDmmfModels,
} from "./seed-faker.js";
import type { ExtractOptions } from "./types.js";

function toImportUrl(spec: string, cwd: string): string {
  if (spec.startsWith("file:")) return spec;
  if (spec.startsWith(".") || path.isAbsolute(spec)) {
    const abs = path.isAbsolute(spec) ? spec : path.resolve(cwd, spec);
    return pathToFileURL(abs).href;
  }
  return spec;
}

const program = new Command();

program
  .name("zenstack-query-compare")
  .description(
    "Extract db.model.method(...) calls from TypeScript, emit a runnable query harness, and compare ZenStack v2 vs v3 SQL/results."
  );

program
  .command("extract")
  .description("Scan a codebase and write queries.ts + extract-manifest.json")
  .requiredOption("--root <dir>", "Project root to scan")
  .option(
    "--include <globs...>",
    "Glob patterns (relative to root)",
    ["**/*.{ts,tsx}", "!**/node_modules/**", "!**/dist/**"]
  )
  .option("--exclude <globs...>", "Extra ignore globs", [])
  .option(
    "--db-alias <names...>",
    "Identifier(s) treated as the enhanced client (default: db prisma)",
    ["db", "prisma"]
  )
  .option(
    "--this-prop <names...>",
    "`this.<name>` treated as client when name is listed (default: db prisma)",
    ["db", "prisma"]
  )
  .option(
    "--tx-alias <names...>",
    "Identifier(s) treated as transaction client, e.g. tx in $transaction (default: tx)",
    ["tx"]
  )
  .option(
    "--out <dir>",
    "Output directory for generated files",
    ".zenstack-compare"
  )
  .action(async (opts: {
    root: string;
    include: string[];
    exclude: string[];
    dbAlias: string[];
    thisProp: string[];
    txAlias: string[];
    out: string;
  }) => {
    const root = path.resolve(opts.root);
    const extractOpts: ExtractOptions = {
      root,
      include: opts.include,
      exclude: opts.exclude,
      dbAliases: opts.dbAlias,
      thisPropertyNames: opts.thisProp,
      transactionAliases: opts.txAlias,
      prismaQueryMethods: defaultPrismaQueryMethods(),
    };
    const manifest = await buildManifest(extractOpts);
    const outDir = path.isAbsolute(opts.out)
      ? opts.out
      : path.join(root, opts.out);
    const tsPath = writeQueriesTs(outDir, manifest, {
      transactionAliases: opts.txAlias,
    });
    console.log(`Wrote ${tsPath}`);
    console.log(`Wrote ${path.join(outDir, "extract-manifest.json")}`);
    console.log(`Extracted ${manifest.queries.length} query call sites.`);
    if (manifest.zmodelFiles.length) {
      console.log(
        `Found ${manifest.zmodelFiles.length} .zmodel file(s) (embedded in manifest).`
      );
    } else {
      console.log(
        "No .zmodel files found under root (optional). Add schema.zmodel to capture it."
      );
    }
  });

function summarizeMs(values: number[]): {
  n: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { n: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const p95Idx = Math.min(n - 1, Math.ceil(n * 0.95) - 1);
  const p95 = sorted[p95Idx]!;
  return {
    n,
    mean,
    median,
    p95,
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

program
  .command("compare")
  .description(
    "Run extracted queries against Prisma with two enhance() implementations and diff SQL + results"
  )
  .requiredOption(
    "--queries-module <spec>",
    "Path or URL to generated queries module (e.g. ./.zenstack-compare/queries.ts)"
  )
  .option(
    "--cwd <dir>",
    "Working directory for resolving relative paths",
    process.cwd()
  )
  .option(
    "--prisma-client <spec>",
    "Import specifier for PrismaClient (default: @prisma/client)",
    "@prisma/client"
  )
  .option(
    "--enhance-v2 <spec>",
    "Import specifier for ZenStack v2 enhance (e.g. path to wrapper or package)",
    "@zenstackhq/runtime"
  )
  .option(
    "--enhance-v3 <spec>",
    "Import specifier for ZenStack v3 enhance",
    "@zenstackhq/runtime"
  )
  .option("--query-id <ids...>", "Only run specific extracted query id(s)")
  .option(
    "--ignore-sql-diff",
    "Treat rows as OK when results match and both sides have no errors, even if SQL text differs",
    false
  )
  .option(
    "--fixtures <file>",
    "JSON file: { queries: { [queryId]: { where: {...} } }, fakerSeed? } merged into each extracted call"
  )
  .option("--json", "Print machine-readable JSON", false)
  .action(async (opts: {
    queriesModule: string;
    cwd: string;
    prismaClient: string;
    enhanceV2: string;
    enhanceV3: string;
    queryId?: string[];
    ignoreSqlDiff: boolean;
    fixtures?: string;
    json: boolean;
  }) => {
    const cwd = path.resolve(opts.cwd);
    const queriesModule = toImportUrl(opts.queriesModule, cwd);
    const enhanceV2 = toImportUrl(opts.enhanceV2, cwd);
    const enhanceV3 = toImportUrl(opts.enhanceV3, cwd);
    const prismaClientSpecifier = opts.prismaClient.startsWith(".")
      ? toImportUrl(opts.prismaClient, cwd)
      : opts.prismaClient;
    const queryFixtures = loadQueryFixtures(opts.fixtures);

    await runCompare({
      cwd,
      queriesModule,
      enhanceV2Module: enhanceV2,
      enhanceV3Module: enhanceV3,
      prismaClientSpecifier,
      queryIds: opts.queryId,
      ignoreSqlDiff: opts.ignoreSqlDiff,
      json: opts.json,
      queryFixtures,
    });
  });

program
  .command("benchmark")
  .description(
    "Time ZenStack v2 vs v3 for each query (interleaved rounds; wall-clock per side)"
  )
  .requiredOption(
    "--queries-module <spec>",
    "Path or URL to generated queries module (e.g. ./.zenstack-compare/out/queries.js)"
  )
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--prisma-client <spec>", "PrismaClient import", "@prisma/client")
  .option("--enhance-v2 <spec>", "ZenStack v2 enhance module", "@zenstackhq/runtime")
  .option("--enhance-v3 <spec>", "ZenStack v3 enhance module", "@zenstackhq/runtime")
  .option("--query-id <ids...>", "Only benchmark these query id(s)")
  .option(
    "--query-id-prefix <prefix>",
    "Only benchmark query ids whose extract file path contains this substring (e.g. benchmark-queries)"
  )
  .option("--fixtures <file>", "JSON fixtures merged into each query (same as compare)")
  .option("--warmup <n>", "Warmup rounds per query per side", "2")
  .option("--iterations <n>", "Timed iterations per query", "30")
  .option("--json", "Print machine-readable JSON", false)
  .action(async (opts: {
    queriesModule: string;
    cwd: string;
    prismaClient: string;
    enhanceV2: string;
    enhanceV3: string;
    queryId?: string[];
    queryIdPrefix?: string;
    fixtures?: string;
    warmup: string;
    iterations: string;
    json: boolean;
  }) => {
    const cwd = path.resolve(opts.cwd);
    const queriesModule = toImportUrl(opts.queriesModule, cwd);
    const enhanceV2 = toImportUrl(opts.enhanceV2, cwd);
    const enhanceV3 = toImportUrl(opts.enhanceV3, cwd);
    const prismaClientSpecifier = opts.prismaClient.startsWith(".")
      ? toImportUrl(opts.prismaClient, cwd)
      : opts.prismaClient;
    const queryFixtures = loadQueryFixtures(opts.fixtures);

    const rounds = await runBenchmark({
      cwd,
      queriesModule,
      enhanceV2Module: enhanceV2,
      enhanceV3Module: enhanceV3,
      prismaClientSpecifier,
      queryIds: opts.queryId ?? [],
      queryIdFilePathSubstring: opts.queryIdPrefix,
      queryFixtures,
      warmups: parseInt(opts.warmup, 10) || 0,
      iterations: parseInt(opts.iterations, 10) || 1,
    });

    if (opts.json) {
      console.log(JSON.stringify(rounds, null, 2));
      return;
    }

    const byId = new Map<string, typeof rounds>();
    for (const r of rounds) {
      const arr = byId.get(r.id) ?? [];
      arr.push(r);
      byId.set(r.id, arr);
    }

    console.log(
      "queryId\tv2_median_ms\tv3_median_ms\tratio_v3/v2\tv2_sql_n\tv3_sql_n\terrors"
    );
    for (const [id, rs] of [...byId.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      const v2ok = rs.filter((x) => !x.errorV2).map((x) => x.v2Ms);
      const v3ok = rs.filter((x) => !x.errorV3).map((x) => x.v3Ms);
      const s2 = summarizeMs(v2ok);
      const s3 = summarizeMs(v3ok);
      const ratio =
        s2.median > 0 && s3.median > 0
          ? (s3.median / s2.median).toFixed(3)
          : "n/a";
      const err = rs.some((x) => x.errorV2 || x.errorV3) ? "yes" : "no";
      const sql2Row = rs.find((x) => !x.errorV2);
      const sql3Row = rs.find((x) => !x.errorV3);
      const sql2 = sql2Row?.v2SqlCount ?? 0;
      const sql3 = sql3Row?.v3SqlCount ?? 0;
      console.log(
        `${id}\t${s2.median.toFixed(3)}\t${s3.median.toFixed(3)}\t${ratio}\t${sql2}\t${sql3}\t${err}`
      );
    }
  });

program
  .command("fixtures-template")
  .description(
    "Write query-fixtures.template.json from extract-manifest.json (null placeholders per query id)"
  )
  .requiredOption("--manifest <file>", "Path to extract-manifest.json")
  .option(
    "--out <file>",
    "Output JSON path",
    "query-fixtures.template.json"
  )
  .action((opts: { manifest: string; out: string }) => {
    writeFixturesTemplate(opts.manifest, opts.out);
    console.log(`Wrote ${path.resolve(opts.out)}`);
  });

program
  .command("seed-faker")
  .description(
    "Emit .zenstack-compare/seed-faker.generated.ts from Prisma DMMF (run with npx tsx in target project; requires @faker-js/faker)"
  )
  .requiredOption("--cwd <dir>", "Project with prisma generate and @prisma/client")
  .option(
    "--out <file>",
    "Output path",
    ".zenstack-compare/seed-faker.generated.ts"
  )
  .option("--records <n>", "Rows per model", "5")
  .option("--seed <n>", "faker.seed()", "42")
  .action(async (opts: {
    cwd: string;
    out: string;
    records: string;
    seed: string;
  }) => {
    const cwd = path.resolve(opts.cwd);
    const models = loadDmmfModels(cwd);
    const src = generateFakerSeedScriptFromDmmf({
      models,
      recordsPerModel: parseInt(opts.records, 10) || 5,
      fakerSeed: parseInt(opts.seed, 10) || 42,
    });
    const outAbs = path.isAbsolute(opts.out)
      ? opts.out
      : path.join(cwd, opts.out);
    const fs = await import("node:fs");
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, src, "utf8");
    console.log(`Wrote ${outAbs}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
