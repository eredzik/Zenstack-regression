#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { buildManifest, defaultPrismaQueryMethods } from "./extract.js";
import { writeQueriesTs } from "./codegen.js";
import { runCompare } from "./compare.js";
import { printBenchmarkSummary, runBenchmark } from "./benchmark.js";
import { loadQueryFixtures, writeFixturesTemplate } from "./fixtures.js";
import {
  generateFakerSeedScriptFromDmmf,
  loadDmmfModels,
} from "./seed-faker.js";
import type { BenchmarkOptions, ExtractOptions } from "./types.js";

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
    "Only benchmark queries whose extract file path contains this substring (repeat flag for multiple)",
    (val: string, prev: string[] | undefined) => {
      const arr = prev ?? [];
      arr.push(val);
      return arr;
    },
    []
  )
  .option("--fixtures <file>", "JSON fixtures merged into each query (same as compare)")
  .option("--warmup <n>", "Warmup rounds per query per side", "2")
  .option("--iterations <n>", "Timed iterations per query", "30")
  .option(
    "--prisma-factory-module <spec>",
    "ESM module URL exporting createBenchmarkPrisma(): Promise<PrismaClient-like> (skips default PrismaClient ctor)"
  )
  .option("--json", "Print machine-readable JSON", false)
  .action(async (opts: {
    queriesModule: string;
    cwd: string;
    prismaClient: string;
    enhanceV2: string;
    enhanceV3: string;
    queryId?: string[];
    queryIdPrefix?: string[];
    fixtures?: string;
    warmup: string;
    iterations: string;
    prismaFactoryModule?: string;
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

    let prismaFactory: BenchmarkOptions["prismaFactory"];
    if (opts.prismaFactoryModule) {
      const factoryUrl = toImportUrl(opts.prismaFactoryModule, cwd);
      const mod = (await import(factoryUrl)) as {
        createBenchmarkPrisma?: () => Promise<{
          $connect: () => Promise<void>;
          $disconnect: () => Promise<void>;
          $on: (event: string, cb: (e: unknown) => void) => void;
        }>;
      };
      if (typeof mod.createBenchmarkPrisma !== "function") {
        throw new Error(
          `${factoryUrl} must export async function createBenchmarkPrisma()`
        );
      }
      prismaFactory = mod.createBenchmarkPrisma;
    }

    const rounds = await runBenchmark({
      cwd,
      queriesModule,
      enhanceV2Module: enhanceV2,
      enhanceV3Module: enhanceV3,
      prismaClientSpecifier,
      prismaFactory,
      queryIds: opts.queryId ?? [],
      queryIdFilePathSubstrings:
        opts.queryIdPrefix && opts.queryIdPrefix.length ?
          opts.queryIdPrefix
        : undefined,
      queryFixtures,
      warmups: parseInt(opts.warmup, 10) || 0,
      iterations: parseInt(opts.iterations, 10) || 1,
    });

    printBenchmarkSummary(rounds, opts.json);
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
