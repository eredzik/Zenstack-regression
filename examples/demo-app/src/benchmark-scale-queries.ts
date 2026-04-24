import type { PrismaClient } from "@prisma/client";

/**
 * Heavy includes across the extended org/team/project/task graph.
 * Used to probe whether ZenStack v3 overhead grows with schema shape (many models + joins).
 * Seed: `seed-data.ts` (proj-alpha, 24 tasks, labels, work logs, linked posts).
 */

/** Deep single-row graph: project → team → org, tasks → assignee/labels/workLogs/user, posts → comments. */
export async function benchScaleDeepProjectGraph(db: PrismaClient) {
  return db.project.findUnique({
    where: { id: "proj-alpha" },
    include: {
      team: {
        include: {
          org: true,
          members: {
            include: {
              user: { select: { id: true, email: true } },
            },
          },
        },
      },
      tasks: {
        take: 20,
        orderBy: { id: "asc" },
        include: {
          assignee: { select: { id: true, email: true } },
          labels: { include: { label: true } },
          workLogs: {
            take: 5,
            orderBy: { id: "asc" },
            include: { user: { select: { id: true, email: true } } },
          },
        },
      },
      documents: { take: 5, orderBy: { id: "asc" } },
      posts: {
        take: 15,
        orderBy: { sequence: "desc" },
        include: {
          author: { select: { id: true, email: true } },
          comments: {
            take: 5,
            orderBy: { id: "asc" },
            include: { author: { select: { id: true, email: true } } },
          },
        },
      },
    },
  });
}

/** Wide many-row read: all proj-alpha tasks with nested project→team→org and M2M labels. */
export async function benchScaleWideTaskFanout(db: PrismaClient) {
  return db.task.findMany({
    where: { projectId: "proj-alpha" },
    orderBy: { id: "asc" },
    include: {
      assignee: true,
      project: {
        include: {
          team: { include: { org: true } },
        },
      },
      labels: { include: { label: true } },
      workLogs: {
        take: 4,
        orderBy: { id: "asc" },
        include: { user: { select: { id: true, email: true } } },
      },
    },
  });
}

/** User-centric slice: memberships → teams → org + nested projects/tasks, plus assigned tasks. */
export async function benchScaleUserOrgSlice(db: PrismaClient) {
  return db.user.findUnique({
    where: { id: "u1" },
    include: {
      teamMembers: {
        include: {
          team: {
            include: {
              org: { select: { id: true, name: true } },
              projects: {
                take: 2,
                orderBy: { weight: "desc" },
                include: {
                  tasks: {
                    take: 8,
                    orderBy: { id: "asc" },
                    include: {
                      labels: { include: { label: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      tasksAssigned: {
        take: 12,
        orderBy: { id: "asc" },
        include: {
          project: { include: { team: { include: { org: true } } } },
          workLogs: { take: 3, orderBy: { id: "asc" } },
        },
      },
    },
  });
}

/** Org root: two teams, nested members, projects with tasks and documents. */
export async function benchScaleOrgFullTree(db: PrismaClient) {
  return db.org.findUnique({
    where: { id: "org-1" },
    include: {
      teams: {
        include: {
          members: {
            include: { user: { select: { id: true, email: true } } },
          },
          projects: {
            include: {
              tasks: {
                take: 15,
                orderBy: { id: "asc" },
                include: {
                  assignee: { select: { id: true, email: true } },
                  labels: { include: { label: true } },
                },
              },
              documents: true,
            },
          },
        },
      },
    },
  });
}
