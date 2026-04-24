import { PrismaClient } from "@prisma/client";
import { seedDemoDataset } from "./seed-data.js";

const prisma = new PrismaClient();

function parseArgInt(flag: string): number | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const raw = process.argv[idx + 1];
  if (!raw || raw.startsWith("--")) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

const rowsArg = parseArgInt("--rows");
const taskRowsArg = parseArgInt("--task-rows");

const u1PostCount = rowsArg ?? Number.parseInt(process.env.SEED_U1_POSTS ?? "", 10);
const u2PostCount = rowsArg ?? Number.parseInt(process.env.SEED_U2_POSTS ?? "", 10);
const taskCount = taskRowsArg ?? Number.parseInt(process.env.SEED_TASKS ?? "", 10);

seedDemoDataset(prisma, {
  u1PostCount: Number.isFinite(u1PostCount) ? u1PostCount : undefined,
  u2PostCount: Number.isFinite(u2PostCount) ? u2PostCount : undefined,
  taskCount: Number.isFinite(taskCount) ? taskCount : undefined,
})
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
