import fs from "node:fs";
import path from "node:path";
import type { ExtractManifest } from "./types.js";

export type QueryFixturesFile = {
  /** Optional seed for @faker-js/faker (integer). */
  fakerSeed?: number;
  /** Per extracted query id: deep-merge patch for the Prisma call's first argument. */
  queries: Record<string, Record<string, unknown>>;
};

export function loadQueryFixtures(
  filePath: string | undefined
): Record<string, Record<string, unknown>> | undefined {
  if (!filePath) return undefined;
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, "utf8");
  const data = JSON.parse(raw) as QueryFixturesFile;
  return data.queries ?? {};
}

export function writeFixturesTemplate(
  manifestPath: string,
  outPath: string
): void {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(manifestPath), "utf8")
  ) as ExtractManifest;
  const queries: Record<string, Record<string, unknown> | null> = {};
  for (const q of manifest.queries) {
    queries[q.id] = null;
  }
  const doc: QueryFixturesFile = {
    fakerSeed: 42,
    queries: queries as Record<string, Record<string, unknown>>,
  };
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outPath),
    JSON.stringify(doc, null, 2) + "\n",
    "utf8"
  );
}
