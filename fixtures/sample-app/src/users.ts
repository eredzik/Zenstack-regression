import type { PrismaClient } from "@prisma/client";

declare const db: PrismaClient;

export async function example() {
  const u = await db.user.findFirst({
    where: { id: "1" },
    select: { id: true, email: true },
  });
  await db.post.findMany({ take: 5 });
  return u;
}
