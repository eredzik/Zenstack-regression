import type { PrismaClient } from "@prisma/client";

/**
 * Service class with multiple read paths. Same `const db = this.db` pattern for extraction.
 */
export class UserService {
  constructor(private readonly db: PrismaClient) {}

  async findSeedUserByEmail() {
    const db = this.db;
    return db.user.findUnique({
      where: { email: "u1@example.com" },
      select: {
        id: true,
        email: true,
        _count: { select: { posts: true, comments: true } },
      },
    });
  }

  async listAllUsersOrdered() {
    const db = this.db;
    return db.user.findMany({
      orderBy: { id: "asc" },
      include: {
        posts: {
          where: { sequence: { lte: 2 } },
          take: 2,
          orderBy: { sequence: "asc" },
          select: { id: true, title: true, sequence: true },
        },
      },
    });
  }
}
