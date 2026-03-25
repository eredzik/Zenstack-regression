# Compare report (how to reproduce)

This file is not auto-updated. Run the report locally and paste output into issues or CI logs.

```bash
cd examples/demo-app
export DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/zenstack_compare_demo"  # or docker :5433
npm install
cd ../.. && npm run build && cd examples/demo-app
npm run extract && npm run db:push && npm run db:seed
npm run compare:report
```

- **Strict** — fails if SQL or JSON differs (`ok` requires both).
- **Payload-only** — `npm run compare:results` adds `--ignore-sql-diff`.

Query inventory lives in **`src/regression-surface.ts`** (AND/OR/NOT, relations, aggregates) plus existing **`queries.ts`**, **`query-functions.ts`**, repositories.
