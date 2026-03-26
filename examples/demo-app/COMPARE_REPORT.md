# Compare report

Run after **`npm run extract`**, **`db push`**, **`db seed`**:

```bash
export DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/zenstack_compare_demo"
npm run compare:report
```

## Seed scale (current)

- **8 users** (`u1`–`u8`), including no-posts, high-only, and mixed-post users.
- **`u1`:** **120** posts `p1`…`p120` + matching comments `C1`…`C120` (nullable authors on `sequence % 11 === 0`) + **extra** comments on `p1`, `p5`, `p99`, `p100` for ordering stress (`alpha`/`zebra`/`C100` vs `C9`).
- **`u2`:** **40** posts `q1`…`q40` + comments `qc1`…`qc15`.
- **`u4`:** posts only with **sequence ≥ 10** (for `none: { sequence: { lt: 5 } }` tests).
- **`u5`:** low + high sequences (fails that `none` filter).
- **`u6`/`u7`:** small post sets for `groupBy` diversity.

## Last run snapshot (PostgreSQL, strict compare)

After scaling seed (representative):

| Category | Count |
|----------|------:|
| **JSON mismatch** | **2** — nested user queries that **`orderBy: { content }`** on comments (`src/queries.ts` regression + `nestedUserCommentsOrderByContent` in `regression-surface.ts`). Typical cause: **string sort** of `C1`…`C100` vs lexicographic ordering. |
| **SQL-only mismatch** | **19** — same stable JSON, different SQL text (Prisma vs ZenStack v3 ORM). |
| **Errors** | **0** |

Re-run **`npm run compare:report`** after changing versions or seed; exit code **1** if any issue row exists.
