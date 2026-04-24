#!/usr/bin/env bash
set -euo pipefail

QUERY_REF="${1:-}"
MODE="${2:-postgres}"   # postgres | pglite
CONCURRENCY="${CONCURRENCY:-1}"
WARMUP="${WARMUP:-3}"
ITERATIONS="${ITERATIONS:-25}"
QUERY_KIND="${QUERY_KIND:-auto}"  # auto | id | name

if [[ -z "$QUERY_REF" ]]; then
  echo "Usage: $0 <query-name-or-id> [postgres|pglite]"
  exit 1
fi

FILTER_FLAG="--query-name"
if [[ "$QUERY_KIND" == "id" ]]; then
  FILTER_FLAG="--query-id"
elif [[ "$QUERY_KIND" == "name" ]]; then
  FILTER_FLAG="--query-name"
elif [[ "$QUERY_REF" =~ ^[0-9a-f]{16}$ ]]; then
  FILTER_FLAG="--query-id"
fi

cd examples/demo-app

# Common prep
npm run zenstack:generate
npm run zenstack:v2-meta
npx prisma generate
npm run build-zenstack-schema
npm run extract
npm run build-queries

# Needed in this repo state for benchmark paths
ln -sf .zenstack-compare/enhance-v2.mjs enhance-v2.mjs

if [[ "$MODE" == "postgres" ]]; then
  docker compose up -d postgres
  DATABASE_URL=postgresql://demo:demo@127.0.0.1:5434/zenstack_compare_demo npm run postgres:wait
  DATABASE_URL=postgresql://demo:demo@127.0.0.1:5434/zenstack_compare_demo npm run db:push
  DATABASE_URL=postgresql://demo:demo@127.0.0.1:5434/zenstack_compare_demo npm run db:seed

  DATABASE_URL=postgresql://demo:demo@127.0.0.1:5434/zenstack_compare_demo \
  node ../../dist/cli.js benchmark \
    --cwd . \
    --queries-module ./.zenstack-compare/out/queries.js \
    --enhance-v2 ./.zenstack-compare/enhance-v2.mjs \
    --enhance-v3 ./enhance-v3.mjs \
    "$FILTER_FLAG" "$QUERY_REF" \
    --warmup "$WARMUP" \
    --iterations "$ITERATIONS" \
    --concurrency "$CONCURRENCY"
else
  ZS_BENCH_WARMUP="$WARMUP" \
  ZS_BENCH_ITERATIONS="$ITERATIONS" \
  ZS_BENCH_CONCURRENCY="$CONCURRENCY" \
  npx tsx scripts/benchmark-pglite.mjs "$FILTER_FLAG" "$QUERY_REF"
fi