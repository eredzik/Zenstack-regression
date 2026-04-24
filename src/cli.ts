#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { buildManifest, defaultPrismaQueryMethods } from "./extract.js";
import { writeQueriesDir } from "./codegen.js";
import { runCompare } from "./compare.js";
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
  .description("Scan a codebase and write query files + extract-manifest.json")
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
    const queriesDir = writeQueriesDir(outDir, manifest, {
      transactionAliases: opts.txAlias,
    });
    console.log(`Wrote ${queriesDir}`);
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
    "--queries-dir <dir>",
    "Path to generated query module directory (e.g. ./.zenstack-compare/queries)"
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
    "JSON file: { queries: { [queryId]: { ...params } }, fakerSeed? } passed as `params` to runQuery(db, params)"
  )
  .option("--json", "Print machine-readable JSON", false)
  .option(
    "--md-out <file>",
    "Write markdown report with metadata + SQL only (omits JSON results/errors payloads)"
  )
  .action(async (opts: {
    queriesDir: string;
    cwd: string;
    prismaClient: string;
    enhanceV2: string;
    enhanceV3: string;
    queryId?: string[];
    ignoreSqlDiff: boolean;
    fixtures?: string;
    json: boolean;
    mdOut?: string;
  }) => {
    const cwd = path.resolve(opts.cwd);
    const enhanceV2 = toImportUrl(opts.enhanceV2, cwd);
    const enhanceV3 = toImportUrl(opts.enhanceV3, cwd);
    const prismaClientSpecifier = opts.prismaClient.startsWith(".")
      ? toImportUrl(opts.prismaClient, cwd)
      : opts.prismaClient;
    const queryFixtures = loadQueryFixtures(opts.fixtures);

    await runCompare({
      cwd,
      queriesDir: opts.queriesDir,
      enhanceV2Module: enhanceV2,
      enhanceV3Module: enhanceV3,
      prismaClientSpecifier,
      queryIds: opts.queryId,
      ignoreSqlDiff: opts.ignoreSqlDiff,
      json: opts.json,
      queryFixtures,
      markdownOutputFile: opts.mdOut,
    });
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
