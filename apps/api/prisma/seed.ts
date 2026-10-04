import { PrismaClient, PostKind, Role, Status } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === "production" || process.env.SEED_DEMO !== "true")
    throw new Error(
      "Seed requires SEED_DEMO=true and is blocked in production",
    );
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12)
    throw new Error("DEMO_PASSWORD must be at least 12 characters");
  const hp = await bcrypt.hash(password, 12);
  const teacher = await db.user.upsert({
    where: { email: "teacher@attendly.local" },
    update: { password: hp, role: Role.TEACHER },
    create: {
      name: "Aarav Mehta",
      email: "teacher@attendly.local",
      password: hp,
      role: Role.TEACHER,
    },
  });
  const student = await db.user.upsert({
    where: { email: "student@attendly.local" },
    update: { password: hp, prn: "2023CS001" },
    create: {
      name: "Maya Sharma",
      email: "student@attendly.local",
      prn: "2023CS001",
      password: hp,
      role: Role.STUDENT,
    },
  });
  const c = await db.course.upsert({
    where: { teacherId_code: { teacherId: teacher.id, code: "CS701" } },
    update: {},
    create: {
      name: "Advanced Web Engineering",
      code: "CS701",
      teacherId: teacher.id,
      joinCode: "WEB701",
      color: "#8b5cf6",
    },
  });
  await db.enrollment.upsert({
    where: { courseId_studentId: { courseId: c.id, studentId: student.id } },
    update: { createdAt: new Date(Date.now() - 30 * 864e5) },
    create: { courseId: c.id, studentId: student.id, createdAt: new Date(Date.now() - 30 * 864e5) },
  });
  for (let i = 1; i <= 8; i++) {
    const start = new Date(Date.now() - (9 - i) * 864e5 - 3600000),
      s = await db.classSession.upsert({
        where: { id: `demo-session-${i}` },
        update: {},
        create: {
          id: `demo-session-${i}`,
          courseId: c.id,
          title: `Architecture studio ${i}`,
          startedAt: start,
          endsAt: new Date(start.getTime() + 90 * 60000),
          closedAt: new Date(start.getTime() + 90 * 60000),
          lateAfterMinutes: 15,
        },
      });
    if (i !== 3)
      await db.attendance.upsert({
        where: { sessionId_studentId: { sessionId: s.id, studentId: student.id } },
        update: {},
        create: {
          sessionId: s.id,
          studentId: student.id,
          status: Status.PRESENT,
          source: "MANUAL",
          checkedInAt: new Date(start.getTime() + 10 * 60000),
        },
      });
  }
  // Noticeboard & study materials (idempotent per post title).
  const demoPosts = [
        {
          courseId: c.id,
          authorId: teacher.id,
          kind: PostKind.NOTICE,
          title: "Mid-term review this Friday",
          body: "We will review architecture patterns and the deployment checklist. Bring your project questions.",
          pinned: true,
        },
        {
          courseId: c.id,
          authorId: teacher.id,
          kind: PostKind.MATERIAL,
          title: "Lecture 6 slides — architecture patterns",
          body: "Slides and code samples from today's lecture.",
          url: "https://nextjs.org/docs/app/building-your-application",
        },
        {
          courseId: c.id,
          authorId: teacher.id,
          kind: PostKind.NOTICE,
          title: "Assignment 3 due next week",
          body: "Submit your containerised API by Friday 23:59. Late submissions lose 10%.",
        },
  ];
  for (const p of demoPosts) {
    const exists = await db.post.findFirst({
      where: { courseId: c.id, title: p.title },
    });
    if (!exists) await db.post.create({ data: p });
  }
  console.log("Demo data ready:", teacher.email, student.email);
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
