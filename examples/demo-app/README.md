# Demo app: ZenStack v2 (Prisma) vs v3 (`ZenStackClient`)

This example runs the query harness **twice**:

1. **v2** — `@zenstackhq/runtime-v2` `createEnhancement` wrapping **Prisma** (open policy guards + `modelMeta` derived from Prisma DMMF).
2. **v3** — `@zenstackhq/orm` **`ZenStackClient`** over **better-sqlite3** / Kysely, using the schema compiled from `zenstack/schema.zmodel`.

Both sides point at the **same SQLite file** (`prisma/dev.db`). Prisma uses backtick-quoted SQL; ZenStack v3 emits Kysely SQL with double quotes — so **SQL text will not match** even when results do. The demo runs `compare` with **`--ignore-sql-diff`** so `ok` means *same JSON results, no errors* while still printing both SQL lists for inspection.

## Prerequisites

From the **repository root**:

```bash
npm install
npm run build
```

## One-shot demo

```bash
cd examples/demo-app
npm install
npm run demo
```

## What each script does

| Script | Purpose |
|--------|---------|
| `zenstack:generate` | `zen generate` — refresh `zenstack/schema.ts` from `zenstack/schema.zmodel` |
| `zenstack:v2-meta` | Build `zenstack-generated/model-meta.json` + `policy.json` from Prisma DMMF |
| `prisma generate` | Regenerate `@prisma/client` after `schema.prisma` changes (runs inside `compare`) |
| `build-zenstack-schema` | Compile `zenstack/schema.ts` → `zenstack/out/schema.js` for Node |
| `build-queries` | Compile extracted `.zenstack-compare/queries.ts` |

## Files

- **`enhance-v2.mjs`** — `createEnhancement(prisma, { modelMeta, policy, prismaModule })`. `prismaModule` is the **CommonJS** `@prisma/client` export (ZenStack expects `Prisma.PrismaClientUnknownRequestError` etc.).
- **`enhance-v3.mjs`** — `new ZenStackClient(schema, { dialect, log })`. Optional third argument `{ sqlCapture }` is filled by the compare runner to record SQL.
- **`scripts/build-model-meta.mjs`** — Generates v2 metadata keys in **camelCase** (`user`, `post`, …) to match ZenStack’s `lowerCaseFirst` lookups.

## Package version note

`@zenstackhq/runtime-v2` is installed as an npm alias for `@zenstackhq/runtime@2.x` so it can sit next to v3 packages. The CLI may print a “multiple ZenStack versions” warning; that is expected here.

## Strict SQL comparison

Omit `--ignore-sql-diff` when both sides use the **same** query engine (e.g. two Prisma-based `enhance` wrappers) so `ok` requires identical normalized SQL strings.
