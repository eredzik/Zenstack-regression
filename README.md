# ZenStack query comparison

CLI tooling to **mine a TypeScript codebase** for calls shaped like `db.user.findFirst({ ... })`, **record matching `.zmodel` files**, and emit a **generated module** of parametrized runners. You can then execute the same runners against **two ZenStack `enhance` implementations** (for example v2 vs v3) on a **seeded database** and compare **Prisma-emitted SQL** and **stable JSON snapshots** of results.

## What it does

1. **`extract`** — Walks `*.ts` / `*.tsx`, finds member chains rooted at aliases like `db` or `prisma`, ending in known Prisma delegate methods (`findMany`, `findFirst`, `create`, …). Each site becomes `run(db) => db.<model>.<method>(<original args text>)` in `queries.ts`. All `**/*.zmodel` files under the root are listed and their contents are embedded in `extract-manifest.json` and in the generated module for audit and copy/paste into a harness repo.
2. **`compare`** — Loads your generated `queries` module, constructs one `PrismaClient` with `log: [{ level: "query", emit: "event" }]`, wraps it with `enhance` from **two different import specifiers**, runs each query twice, and prints diffs when SQL or normalized results disagree.

Bare import specifiers such as `@prisma/client` are resolved from **`--cwd`** (the target project’s `node_modules`), so you can run the CLI from the repo root while comparing an example app.

Use **`--ignore-sql-diff`** when comparing **Prisma + ZenStack v2 runtime** to **ZenStack v3 ORM** (Kysely): JSON results can match while SQL text will not. The v3 `enhance` module may accept a third argument `{ sqlCapture: string[] }` (the compare runner supplies this when present).

## Example project

See **`examples/demo-app`**: Prisma + SQLite, ZenStack v2 `createEnhancement` vs v3 `ZenStackClient`, simple and nested `db.*` queries, and `npm run demo` to extract, push schema, seed, and run `compare` with **`--ignore-sql-diff`** (still prints both SQL streams for review).

## Install

From this repository:

```bash
npm install
npm run build
```

Use the CLI via `node dist/cli.js` or `npm link` / `npx` after publishing.

## Extract

```bash
zenstack-query-compare extract --root /path/to/your/app
```

Useful options:

- **`--include` / `--exclude`** — Extra fast-glob patterns (relative to `--root`).
- **`--db-alias`** — Identifiers treated as the enhanced client (default: `db`, `prisma`).
- **`--out`** — Output directory (default: `.zenstack-compare` under the root).

Outputs:

- **`queries.ts`** — `zenstackCompareQueries`, `zenstackCompareQueryList`, `zenstackCompareZmodelContents`, `getZmodelCombinedSource()`.
- **`extract-manifest.json`** — Full manifest including `zmodelContents` and every call site with raw argument source.

### Limitations (important)

- **Lexical scope**: Argument text is copied verbatim from the source. If a query uses variables or imports from the original file, the generated `queries.ts` will not compile until you **inline literals**, **add parameters** manually, or **thin-wrap** those call sites.
- **SQL comparison** uses Prisma’s `query` log events. If a ZenStack version issues a different number of queries for the same logical operation, the normalized SQL string may differ even when results match.
- **Dynamic model names** (`db[model].findMany`) are not extracted.

## Compare

Run from a project that already has **`@prisma/client`**, a generated client, and a reachable database (set **`DATABASE_URL`** or use a `file:` URL in `schema.prisma`).

```bash
zenstack-query-compare compare \
  --cwd /path/to/harness \
  --queries-module ./.zenstack-compare/queries.ts \
  --prisma-client @prisma/client \
  --enhance-v2 /path/to/enhance-v2.mjs \
  --enhance-v3 /path/to/enhance-v3.mjs \
  --ignore-sql-diff
```

Omit **`--ignore-sql-diff`** when both sides emit comparable SQL (e.g. two Prisma-based clients).

Reports include **`recordCountV2`** / **`recordCountV3`**: for array results this is the **array length**; for a single object (e.g. `findFirst`, `aggregate`) it is **1**; for `null` it is **0**. On error, that side’s count is **`null`**. Text output prints a `records v2: …  v3: …` line per query.

Each of `--enhance-v2` / `--enhance-v3` should resolve to a module that exports **`enhance`** with the same shape you use in production (typically `enhance(prisma, userContext, options)`). If v2 and v3 live under the same package name, use **two small wrapper files** that re-export the correct build:

```javascript
// enhance-v2.mjs
export { enhance } from "@zenstackhq/runtime/v2";
```

```javascript
// enhance-v3.mjs
export { enhance } from "@zenstackhq/runtime/v3";
```

(Adjust paths to match how your stack pins ZenStack versions.)

### Programmatic API

```javascript
import { runCompare } from "zenstack-query-compare/compare";

await runCompare({
  cwd: process.cwd(),
  queriesModule: new URL("./.zenstack-compare/queries.ts", import.meta.url).href,
  prismaClientSpecifier: "@prisma/client",
  enhanceV2Module: "./enhance-v2.mjs",
  enhanceV3Module: "./enhance-v3.mjs",
  json: true,
});
```

## Suggested workflow for regression testing

1. Run **`extract`** on your app; commit `extract-manifest.json` for review.
2. Fix or delete queries that don’t compile in isolation (unresolved identifiers).
3. In CI or locally, migrate/seed a database, then run **`compare`** with your v2 vs v3 `enhance` entrypoints.
4. Treat mismatches as regressions; use `--query-id` to bisect.

## Fixtures

See `fixtures/sample-app` for a minimal tree used to sanity-check extraction (no database).
