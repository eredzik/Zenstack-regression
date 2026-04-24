# ZenStack query comparison

CLI tooling to **mine a TypeScript codebase** for calls shaped like `db.user.findFirst({ ... })`, **record matching `.zmodel` files**, and emit a **generated module** of parametrized runners. You can then execute the same runners against **two ZenStack `enhance` implementations** (for example v2 vs v3) on a **seeded database** and compare **Prisma-emitted SQL** and **stable JSON snapshots** of results.

## What it does

1. `**extract`** — Walks `*.ts` / `*.tsx`, finds member chains rooted at `**db` / `prisma**` (configurable), `**this.db` / `this.prisma**` (via `--this-prop`), or **transaction clients** like `**tx`** (via `--tx-alias`). Chains must end in known Prisma delegate methods (`findMany`, `findFirst`, `create`, …). Each site becomes its own TypeScript module under `.zenstack-compare/queries/<id>.ts` with a default-export `runQuery(db, params)`. `this.*` calls are rewritten to use harness `db`; `**tx.***` calls are wrapped in `**db.$transaction(async (tx) => …)**`. Extraction also tracks external identifiers used by call arguments and emits typed `params` signatures (fallback `unknown` when a type cannot be emitted safely). All `**/*.zmodel` files under the root are listed and embedded in `extract-manifest.json`.
2. `**compare**` — Loads your generated `queries` module, constructs one `PrismaClient` with `log: [{ level: "query", emit: "event" }]`, wraps it with `enhance` from **two different import specifiers**, runs each query twice, and prints diffs when SQL or normalized results disagree.

Bare import specifiers such as `@prisma/client` are resolved from `**--cwd`** (the target project’s `node_modules`), so you can run the CLI from the repo root while comparing an example app.

Use `--ignore-sql-diff` when comparing **Prisma + ZenStack v2 runtime** to **ZenStack v3 ORM** (Kysely): JSON results can match while SQL text will not. The v3 `enhance` module may accept a third argument `{ sqlCapture: string[] }` (the compare runner supplies this when present).

## Example project

See `**examples/demo-app`**: Prisma + SQLite, ZenStack v2 `createEnhancement` vs v3 `ZenStackClient`, including a **User/Post/Comment** regression shape (nested includes + `orderBy`, nullable comment authors). Run `npm run demo` to extract, push, seed, and compare. Default `**compare`** requires matching SQL and results; use `**compare:results**` in the example for `**--ignore-sql-diff**` when only JSON parity matters.

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

`**fixtures-template**` — build a JSON skeleton from `**extract-manifest.json**` for per-query `params`.

`**seed-faker**` — emit `**seed-faker.generated.ts**` in the target project from Prisma DMMF + `**@faker-js/faker**` (run with `**npx tsx**` after `**npm i -D @faker-js/faker**`).

Useful options:

- `**--include` / `--exclude**` — Extra fast-glob patterns (relative to `--root`).
- `**--db-alias**` — Top-level identifiers treated as the client (default: `db`, `prisma`).
- `**--this-prop**` — Property names so `**this.<name>.model.method**` is extracted (default: `db`, `prisma`).
- `**--tx-alias**` — Names for interactive transaction clients; `**tx.model.method**` becomes `**db.$transaction(async (tx) => tx.model.method(...))**` in the harness (default: `tx`).
- `**--out**` — Output directory (default: `.zenstack-compare` under the root).

Outputs:

- `**queries/_shared.ts**` — Shared helper/type definitions for generated query files.
- `**queries/<query-id>.ts**` — One query file per extracted call site (default export + `queryMeta`).
- `**extract-manifest.json**` — Full manifest including `zmodelContents` and every call site with raw argument source.

### Limitations (important)

- **Lexical scope**: External identifiers used inside extracted args become generated function `params` so query files remain compilable in isolation. Parameter type inference uses TypeScript checker and falls back to `unknown` when needed.
- **SQL comparison** uses Prisma’s `query` log events. If a ZenStack version issues a different number of queries for the same logical operation, the normalized SQL string may differ even when results match.
- **Dynamic model names** (`db[model].findMany`) are not extracted.

## Compare

Run from a project that already has `**@prisma/client`**, a generated client, and a reachable database (set `**DATABASE_URL**` or use a `file:` URL in `schema.prisma`).

```bash
zenstack-query-compare compare \
  --cwd /path/to/harness \
  --queries-dir ./.zenstack-compare/queries \
  --prisma-client @prisma/client \
  --enhance-v2 /path/to/enhance-v2.mjs \
  --enhance-v3 /path/to/enhance-v3.mjs \
  --fixtures ./query-fixtures.json \
  --md-out ./.zenstack-compare/compare-sql-report.md \
  --ignore-sql-diff
```

`**--fixtures**` — JSON file `**{ "queries": { "<id>": { ...params } } }**` passed as the second argument of each generated `runQuery(db, params)`.
`**--md-out**` — write a markdown report containing query metadata + SQL from both runners (no JSON result payloads).
`**--query-id <ids...>**` — run only selected query IDs. Useful when only a subset should be analyzed.

Omit `**--ignore-sql-diff**` when both sides emit comparable SQL (e.g. two Prisma-based clients).

Reports include `**recordCountV2**` / `**recordCountV3**`: for array results this is the **array length**; for a single object (e.g. `findFirst`, `aggregate`) it is **1**; for `null` it is **0**. On error, that side’s count is `**null`**. Text output prints a `records v2: …  v3: …` line per query.

Each of `--enhance-v2` / `--enhance-v3` should resolve to a module that exports `**enhance**` with the same shape you use in production (typically `enhance(prisma, userContext, options)`). If v2 and v3 live under the same package name, use **two small wrapper files** that re-export the correct build:

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
  queriesDir: "./.zenstack-compare/queries",
  prismaClientSpecifier: "@prisma/client",
  enhanceV2Module: "./enhance-v2.mjs",
  enhanceV3Module: "./enhance-v3.mjs",
  json: true,
});
```

## Suggested workflow for regression testing

1. Run `**extract**` on your app; commit `extract-manifest.json` for review.
2. Fix or delete queries that don’t compile in isolation (unresolved identifiers).
3. In CI or locally, migrate/seed a database, then run `**compare**` with your v2 vs v3 `enhance` entrypoints.
4. Treat mismatches as regressions; use `--query-id` to bisect.

## Fixtures

See `fixtures/sample-app` for a minimal tree used to sanity-check extraction (no database).