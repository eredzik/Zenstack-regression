import type { PrismaClient } from "@prisma/client";

/** Large enough for string sort edge cases (e.g. "C100" vs "C9" in ORDER BY content). */
const U1_POST_COUNT = 120;

function makePostsForUser(
  count: number,
  authorId: string,
  idPrefix: string
): Array<{
  id: string;
  sequence: number;
  title: string;
  published: boolean;
  authorId: string;
}> {
  return Array.from({ length: count }, (_, i) => {
    const sequence = count - i;
    return {
      id: `${idPrefix}${sequence}`,
      sequence,
      title: `T-${authorId}-${sequence}`,
      published: sequence % 3 === 0,
      authorId,
    };
  });
}

function makeOneToOneComments(
  count: number,
  idPrefix: string,
  postIdOf: (seq: number) => string
) {
  return Array.from({ length: count }, (_, i) => {
    const sequence = count - i;
    const postId = postIdOf(sequence);
    return {
      id: `${idPrefix}${sequence}`,
      postId,
      content: `C${sequence}`,
      authorId: sequence % 11 === 0 ? null : "u1",
    };
  });
}

/** Same dataset as the original `seed.ts` CLI (used by PGlite benchmark and `npm run db:seed`). */
export async function seedDemoDataset(prisma: PrismaClient): Promise<void> {
  await prisma.taskLabel.deleteMany();
  await prisma.workLog.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.post.updateMany({ data: { projectId: null } });
  await prisma.project.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.org.deleteMany();
  await prisma.label.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();

  const users = [
    { id: "u1", email: "u1@example.com" },
    { id: "u2", email: "u2@example.org" },
    { id: "u3", email: "u3@no-posts.dev" },
    { id: "u4", email: "u4@high-only.dev" },
    { id: "u5", email: "u5@mixed.dev" },
    { id: "u6", email: "alice@company.test" },
    { id: "u7", email: "bob@company.test" },
    { id: "u8", email: "u8@edge.case" },
  ];

  await prisma.user.createMany({ data: users });

  const u1Posts = makePostsForUser(U1_POST_COUNT, "u1", "p");
  await prisma.post.createMany({ data: u1Posts });

  const u1Comments = makeOneToOneComments(U1_POST_COUNT, "c", (seq) => `p${seq}`);
  await prisma.comment.createMany({ data: u1Comments });

  await prisma.comment.createMany({
    data: [
      { id: "cx1", postId: "p5", content: "alpha-first", authorId: "u2" },
      { id: "cx2", postId: "p5", content: "zebra-last", authorId: null },
      { id: "cx3", postId: "p99", content: "C099", authorId: "u6" },
      { id: "cx4", postId: "p100", content: "C100", authorId: "u7" },
      { id: "cx5", postId: "p1", content: "C01-dup", authorId: null },
    ],
  });

  const u2Posts = Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    return {
      id: `q${n}`,
      sequence: n,
      title: n % 7 === 0 ? `Special-${n}` : `Q${n}`,
      published: n % 2 === 0,
      authorId: "u2",
    };
  });
  await prisma.post.createMany({ data: u2Posts });

  await prisma.comment.createMany({
    data: Array.from({ length: 15 }, (_, i) => {
      const n = i + 1;
      return {
        id: `qc${n}`,
        postId: `q${n}`,
        content: `QC${String(n).padStart(3, "0")}`,
        authorId: n % 5 === 0 ? null : "u2",
      };
    }),
  });

  await prisma.post.createMany({
    data: [
      {
        id: "h10",
        sequence: 10,
        title: "High-10",
        published: true,
        authorId: "u4",
      },
      {
        id: "h20",
        sequence: 20,
        title: "High-20",
        published: false,
        authorId: "u4",
      },
      {
        id: "h30",
        sequence: 30,
        title: "High-30",
        published: true,
        authorId: "u4",
      },
    ],
  });

  await prisma.post.createMany({
    data: [
      {
        id: "m1",
        sequence: 1,
        title: "Mix-low",
        published: false,
        authorId: "u5",
      },
      {
        id: "m50",
        sequence: 50,
        title: "Mix-high",
        published: true,
        authorId: "u5",
      },
    ],
  });

  await prisma.post.createMany({
    data: [
      {
        id: "a1",
        sequence: 1,
        title: "Alice-1",
        published: true,
        authorId: "u6",
      },
      {
        id: "a2",
        sequence: 2,
        title: "Alice-2",
        published: false,
        authorId: "u6",
      },
      {
        id: "b1",
        sequence: 1,
        title: "Bob-1",
        published: true,
        authorId: "u7",
      },
    ],
  });

  // ----- Extended org / project / task graph (for schema-scale benchmarks) -----
  await prisma.org.createMany({
    data: [
      { id: "org-1", name: "Acme Corp" },
      { id: "org-2", name: "Beta LLC" },
    ],
  });
  await prisma.team.createMany({
    data: [
      { id: "team-alpha", name: "Alpha Squad", orgId: "org-1" },
      { id: "team-beta", name: "Beta Unit", orgId: "org-2" },
    ],
  });
  await prisma.teamMember.createMany({
    data: [
      { id: "tm-1", teamId: "team-alpha", userId: "u1", role: "lead" },
      { id: "tm-2", teamId: "team-alpha", userId: "u2", role: "member" },
      { id: "tm-3", teamId: "team-beta", userId: "u6", role: "lead" },
    ],
  });
  await prisma.project.createMany({
    data: [
      { id: "proj-alpha", teamId: "team-alpha", name: "Phoenix", weight: 10 },
      { id: "proj-beta", teamId: "team-alpha", name: "Atlas", weight: 5 },
    ],
  });

  await prisma.post.updateMany({
    where: { id: { in: Array.from({ length: 30 }, (_, i) => `p${i + 1}`) } },
    data: { projectId: "proj-alpha" },
  });

  await prisma.label.createMany({
    data: [
      { id: "lab-bug", name: "bug" },
      { id: "lab-feature", name: "feature" },
      { id: "lab-chore", name: "chore" },
    ],
  });

  const taskRows = Array.from({ length: 24 }, (_, i) => {
    const n = i + 1;
    return {
      id: `task-a${String(n).padStart(2, "0")}`,
      projectId: "proj-alpha",
      title: `Task ${n}`,
      status: n % 4 === 0 ? "done" : "open",
      assigneeId: n % 2 === 0 ? "u1" : "u2",
    };
  });
  await prisma.task.createMany({ data: taskRows });

  const taskLabels: Array<{ taskId: string; labelId: string }> = [];
  for (let i = 1; i <= 24; i++) {
    const taskId = `task-a${String(i).padStart(2, "0")}`;
    taskLabels.push({ taskId, labelId: "lab-bug" });
    taskLabels.push({
      taskId,
      labelId: i % 3 === 0 ? "lab-chore" : "lab-feature",
    });
  }
  await prisma.taskLabel.createMany({ data: taskLabels });

  const workLogs: Array<{
    id: string;
    taskId: string;
    userId: string;
    minutes: number;
  }> = [];
  for (let i = 1; i <= 12; i++) {
    const taskId = `task-a${String(i).padStart(2, "0")}`;
    workLogs.push({
      id: `wl-${taskId}-1`,
      taskId,
      userId: "u1",
      minutes: 15 + i,
    });
    workLogs.push({
      id: `wl-${taskId}-2`,
      taskId,
      userId: "u2",
      minutes: 10 + (i % 7),
    });
  }
  await prisma.workLog.createMany({ data: workLogs });

  await prisma.document.createMany({
    data: [
      {
        id: "doc-1",
        projectId: "proj-alpha",
        title: "RFC-001",
        bodyMd: "# Design\n...",
      },
      {
        id: "doc-2",
        projectId: "proj-alpha",
        title: "Runbook",
        bodyMd: "## Ops\n",
      },
      {
        id: "doc-3",
        projectId: "proj-beta",
        title: "Notes",
        bodyMd: "",
      },
    ],
  });

  console.log(
    "Seeded: users",
    users.length,
    "| u1 posts",
    U1_POST_COUNT,
    "+ extras | u2 posts 40 | org graph (2 orgs, 2 projects, 24 tasks, labels, work logs)"
  );
}
