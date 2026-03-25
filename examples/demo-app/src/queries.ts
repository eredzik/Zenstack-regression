import type { PrismaClient } from "@prisma/client";

/**
 * Example call sites for extraction. The CLI copies argument text verbatim into
 * generated runners — literals here keep generated `queries.ts` self-contained.
 */

export async function simpleFindFirst(db: PrismaClient) {
  return db.user.findFirst({
    where: { email: "alice@example.com" },
    select: { id: true, email: true, name: true, role: true },
  });
}

export async function simpleFindManyPublished(db: PrismaClient) {
  return db.post.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, title: true, viewCount: true },
  });
}

export async function complexNestedInclude(db: PrismaClient) {
  return db.user.findMany({
    where: {
      role: "admin",
      posts: { some: { published: true, viewCount: { gte: 1 } } },
    },
    include: {
      posts: {
        where: { published: true },
        orderBy: { viewCount: "desc" },
        take: 2,
        include: { tags: { orderBy: { name: "asc" } } },
      },
    },
    orderBy: { email: "asc" },
    take: 5,
  });
}

export async function complexAggregate(db: PrismaClient) {
  return db.post.aggregate({
    where: { OR: [{ published: true }, { viewCount: { gt: 10 } }] },
    _count: { id: true },
    _avg: { viewCount: true },
    _sum: { viewCount: true },
    _max: { viewCount: true },
    _min: { viewCount: true },
  });
}

export async function complexGroupBy(db: PrismaClient) {
  return db.post.groupBy({
    by: ["published"],
    where: { author: { email: { contains: "@" } } },
    _count: { _all: true },
    _avg: { viewCount: true },
    orderBy: { published: "asc" },
  });
}
