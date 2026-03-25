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
        orderBy: [{ viewCount: "desc" }, { createdAt: "asc" }],
        take: 2,
        include: {
          tags: { orderBy: [{ name: "asc" }, { id: "asc" }] },
        },
      },
    },
    orderBy: [{ email: "asc" }, { id: "asc" }],
    take: 5,
  });
}

/** Nested read: posts → author + tags, each level with explicit ordering. */
export async function nestedPostsOrderedWithRelations(db: PrismaClient) {
  return db.post.findMany({
    where: { published: true },
    orderBy: [{ viewCount: "desc" }, { title: "asc" }],
    take: 6,
    include: {
      author: {
        select: { id: true, email: true, name: true, role: true },
      },
      tags: {
        orderBy: [{ name: "desc" }],
        select: { id: true, name: true },
      },
    },
  });
}

/** Deep nesting: users → ordered posts → ordered tags (many-to-many path). */
export async function nestedUsersPostsTagsOrdered(db: PrismaClient) {
  return db.user.findMany({
    where: { email: { contains: "@" } },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    take: 8,
    include: {
      posts: {
        orderBy: [{ published: "desc" }, { viewCount: "asc" }, { title: "asc" }],
        take: 5,
        include: {
          tags: {
            orderBy: [{ name: "asc" }],
            take: 10,
          },
        },
      },
    },
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
