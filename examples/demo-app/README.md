# Demo app: ZenStack v2 (Prisma) vs v3 (`ZenStackClient`)

This example runs the query harness **twice**:

1. **v2** — `@zenstackhq/runtime-v2` `createEnhancement` wrapping **Prisma** (open policy guards + `modelMeta` derived from Prisma DMMF).
2. **v3** — `@zenstackhq/orm` **`ZenStackClient`** over **better-sqlite3** / Kysely, using the schema compiled from `zenstack/schema.zmodel`.

Both sides use the **same SQLite file** (`prisma/dev.db`).

## Regression dataset (nested includes + orderBy)

The schema matches the **User / Post / Comment** shape used in ZenStack’s **client-api relation / order-by nested includes** tests:

- Fixed ids: user `u1`, posts `p1`…`pN`, comments `c1`…`cN` (see `seed.ts`).
- `Comment.author` is **optional**; `authorId` is **null** when `sequence % 11 === 0` (e.g. `c11`, `c22`) to stress nullable nested includes.
- Extracted query **`regressionNestedIncludesOrderBy`** in `src/queries.ts`: `findUnique` with nested `posts` / `comments`, multiple `orderBy` arrays, and `include: { author: true }` on post comments.

With current pinned versions, **JSON results may still match** while **SQL text does not** — so `npm run compare` marks rows **`ok: false`** until SQL is ignored. Use **`npm run compare:results`** for **`--ignore-sql-diff`** (parity on stable JSON + record counts only).

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

If `prisma db push` fails because the old `dev.db` layout differs, delete `prisma/dev.db` and run `npm run db:push` again (local SQLite only).

## Scripts

| Script | Purpose |
|--------|---------|
| `zenstack:generate` | `zen generate` — refresh `zenstack/schema.ts` from `zenstack/schema.zmodel` |
| `zenstack:v2-meta` | Build `zenstack-generated/model-meta.json` + `policy.json` from Prisma DMMF |
| `compare` | Full diff: SQL + results (`ok` requires both) |
| `compare:results` | Same as compare but `--ignore-sql-diff` |

## Files

- **`enhance-v2.mjs`** — `createEnhancement` + open policy; `prismaModule` from CJS `@prisma/client`.
- **`enhance-v3.mjs`** — `ZenStackClient` + optional `sqlCapture` from compare runner.
- **`scripts/build-model-meta.mjs`** — v2 metadata keys in **camelCase** (`user`, `post`, …).

## Package version note

`@zenstackhq/runtime-v2` is an alias for `@zenstackhq/runtime@2.x`. The CLI may warn about multiple ZenStack versions; that is expected.
