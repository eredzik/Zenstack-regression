import type { PrismaClient } from "@prisma/client";

/** Service class — `this.db.user.findUnique` is extracted. */
export class UserService {
  constructor(private readonly db: PrismaClient) {}

  async findSeedUserByEmail() {
    return this.db.user.findUnique({
      where: { email: "u1@example.com" },
      select: {
        id: true,
        email: true,
        _count: { select: { posts: true, comments: true } },
      },
    });
  }

  async listAllUsersOrdered() {
    return this.db.user.findMany({
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
