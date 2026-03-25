#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { buildManifest, defaultPrismaQueryMethods } from "./extract.js";
import { writeQueriesTs } from "./codegen.js";
import { runCompare } from "./compare.js";
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
    "--out <dir>",
    "Output directory for generated files",
    ".zenstack-compare"
  )
  .action(async (opts: {
    root: string;
    include: string[];
    exclude: string[];
    dbAlias: string[];
    out: string;
  }) => {
    const root = path.resolve(opts.root);
    const extractOpts: ExtractOptions = {
      root,
      include: opts.include,
      exclude: opts.exclude,
      dbAliases: opts.dbAlias,
      prismaQueryMethods: defaultPrismaQueryMethods(),
    };
    const manifest = await buildManifest(extractOpts);
    const outDir = path.isAbsolute(opts.out)
      ? opts.out
      : path.join(root, opts.out);
    const tsPath = writeQueriesTs(outDir, manifest);
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
  .option("--json", "Print machine-readable JSON", false)
  .action(async (opts: {
    queriesModule: string;
    cwd: string;
    prismaClient: string;
    enhanceV2: string;
    enhanceV3: string;
    queryId?: string[];
    ignoreSqlDiff: boolean;
    json: boolean;
  }) => {
    const cwd = path.resolve(opts.cwd);
    const queriesModule = toImportUrl(opts.queriesModule, cwd);
    const enhanceV2 = toImportUrl(opts.enhanceV2, cwd);
    const enhanceV3 = toImportUrl(opts.enhanceV3, cwd);
    const prismaClientSpecifier = opts.prismaClient.startsWith(".")
      ? toImportUrl(opts.prismaClient, cwd)
      : opts.prismaClient;

    await runCompare({
      cwd,
      queriesModule,
      enhanceV2Module: enhanceV2,
      enhanceV3Module: enhanceV3,
      prismaClientSpecifier,
      queryIds: opts.queryId,
      ignoreSqlDiff: opts.ignoreSqlDiff,
      json: opts.json,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
