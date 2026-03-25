# Demo app: ZenStack v2 (Prisma) vs v3 (`ZenStackClient`)

This example runs the query harness **twice**:

1. **v2** — `@zenstackhq/runtime-v2` `createEnhancement` wrapping **Prisma** (open policy guards + `modelMeta` derived from Prisma DMMF).
2. **v3** — `@zenstackhq/orm` **`ZenStackClient`** over **better-sqlite3** / Kysely, using the schema compiled from `zenstack/schema.zmodel`.

Both sides use the same **`DATABASE_URL`**. The default workflow uses **PostgreSQL in Docker** (`docker compose`); set `DATABASE_URL` (see `.env.example`). If `DATABASE_URL` is a `file:` URL or unset, v3 falls back to **SQLite** in `enhance-v3.mjs` while Prisma still follows `schema.prisma` — use Postgres for the full demo.

## Source layout for extraction

- **`src/queries.ts`** — top-level functions with a `db` parameter.
- **`src/query-functions.ts`** — functions taking `db` plus extra parameters; includes **`db.$transaction(async (tx) => tx.user.count())`** so **`tx`** is extracted (default `--tx-alias`).
- **`src/post-repository.ts`**, **`src/user-service.ts`** — classes using **`this.db.post.findMany(...)`** (default **`--this-prop db prisma`**).

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

## One-shot demo (PostgreSQL + Docker)

```bash
cd examples/demo-app
cp .env.example .env   # or export DATABASE_URL from .env.example
npm install
npm run demo:postgres  # compose up, wait, extract, db push, seed, compare
```

Or manually:

```bash
docker compose up -d
export DATABASE_URL="postgresql://demo:demo@127.0.0.1:5433/zenstack_compare_demo"
npm run postgres:wait
npm run extract && npm run db:push && npm run db:seed && npm run compare
```

Port **5433** avoids clashing with a local Postgres on 5432.

If **`docker` is not installed**, use any PostgreSQL 16 instance and set `DATABASE_URL` (for example local `postgresql://demo:demo@127.0.0.1:5432/zenstack_compare_demo` after creating user/db).

## Scripts

| Script | Purpose |
|--------|---------|
| `zenstack:generate` | `zen generate` — refresh `zenstack/schema.ts` from `zenstack/schema.zmodel` |
| `zenstack:v2-meta` | Build `zenstack-generated/model-meta.json` + `policy.json` from Prisma DMMF |
| `compare` | Full diff: SQL + results (`ok` requires both) |
| `compare:results` | Same as compare but `--ignore-sql-diff` |
| `compare:report` | Strict compare + human summary with file:line per query id |

Extra regression-style queries (nested orderBy, **AND**/**OR**/**NOT**, relation filters, aggregates) are in **`src/regression-surface.ts`**. See **`COMPARE_REPORT.md`** for how to regenerate a summary.

## Files

- **`enhance-v2.mjs`** — `createEnhancement` + open policy; `prismaModule` from CJS `@prisma/client`.
- **`enhance-v3.mjs`** — `ZenStackClient` + optional `sqlCapture` from compare runner.
- **`scripts/build-model-meta.mjs`** — v2 metadata keys in **camelCase** (`user`, `post`, …).

## Package version note

`@zenstackhq/runtime-v2` is an alias for `@zenstackhq/runtime@2.x`. The CLI may warn about multiple ZenStack versions; that is expected.
