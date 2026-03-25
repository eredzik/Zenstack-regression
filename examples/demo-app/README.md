# Demo app: extract and compare

This example includes:

- **Prisma** + **SQLite** (`prisma/schema.prisma`)
- A **`schema.zmodel`** file (content mirrored for extraction demos)
- **`src/queries.ts`** — simple and more complex `db.*` call sites (actually `db: PrismaClient` parameter named `db`)
- **`enhance-identical.mjs`** — passes through the raw client so `compare` runs without installing two ZenStack versions; swap this for real v2/v3 `enhance` modules when you have them

## Prerequisites

From the **repository root**, build the CLI:

```bash
npm install
npm run build
```

## Run the full demo

```bash
cd examples/demo-app
npm install
npm run demo
```

This will: `extract` → `prisma db push` → `seed` → compile generated `queries.ts` to JS → `compare` (JSON on stdout).

Individual steps:

```bash
npm run extract
npm run db:push
npm run db:seed
npm run compare
```

## Real ZenStack v2 vs v3

Replace `enhance-identical.mjs` with two small wrappers that re-export each version’s `enhance`, then point `--enhance-v2` and `--enhance-v3` at those files in `package.json`’s `compare` script.
