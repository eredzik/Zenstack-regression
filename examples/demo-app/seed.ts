import { PrismaClient } from "@prisma/client";
import { seedDemoDataset } from "./seed-data.js";

const prisma = new PrismaClient();

seedDemoDataset(prisma)
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
