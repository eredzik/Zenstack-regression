/**
 * ZenStack v2: Prisma client wrapped with runtime enhancements (policy stack uses open guards).
 * Model metadata is derived from Prisma DMMF — run `npm run zenstack:v2-meta` after schema changes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createEnhancement } from "@zenstackhq/runtime-v2/enhancements/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname);
const require = createRequire(import.meta.url);
/** CJS Prisma namespace — ZenStack v2 expects PrismaClient*Error constructors on this object. */
const prismaModule = require("@prisma/client");

function loadJson(rel) {
  const p = path.join(root, rel);
  return JSON.parse(readFileSync(p, "utf8"));
}

const modelMeta = loadJson("zenstack-generated/model-meta.json");
const policy = loadJson("zenstack-generated/policy.json");

export function enhance(prisma) {
  return createEnhancement(prisma, {
    modelMeta,
    policy,
    prismaModule,
  });
}
