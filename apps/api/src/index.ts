import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { PrismaClient, Role, Status, PostKind } from "@prisma/client";
import { random, hash, sign, equal, rate, csv, attended } from "./security.js";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 4000),
  NODE_ENV = process.env.NODE_ENV || "development";
const CSRF = process.env.CSRF_SECRET || "dev-csrf-change-me-please-32-chars";
const ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";
const secure = process.env.COOKIE_SECURE === "true";
if (NODE_ENV === "production") {
  if (!process.env.CSRF_SECRET || CSRF.length < 32)
    throw new Error("Production requires a CSRF_SECRET of at least 32 characters");
  if (CSRF.includes("change-me"))
    throw new Error("Replace the example CSRF_SECRET with a random production secret");
}
type Authed = Request & {
  user?: {
    id: string;
    name: string;
    email: string;
    role: Role;
    prn?: string | null;
    avatar?: string | null;
  };
};
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet());
// Avatar uploads travel as inline data URLs, so the profile route gets headroom
// while every other endpoint stays tight at 32 kB.
const jsonTight = express.json({ limit: "32kb" });
const jsonProfile = express.json({ limit: "600kb" });
app.use((req, res, next) =>
  req.path === "/api/profile"
    ? jsonProfile(req, res, next)
    : jsonTight(req, res, next),
);
app.use(cookieParser());
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  // Always answer with JSON so clients never try to parse a plain-text body.
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many attempts. Please wait a few minutes and try again.",
    },
  },
});
// Only brute-forceable credential endpoints are limited. `/auth/csrf` and
// `/auth/me` are needed on every page load; limiting them locks users out of
// the sign-in screen itself.
app.use(["/api/auth/login", "/api/auth/register"], authLimiter);
const json = (res: Response, data: unknown, status = 200) =>
  res.status(status).json(data);
const fail = (res: Response, status: number, code: string, message: string) =>
  json(res, { error: { code, message } }, status);
function csrfValue(req: Request) {
  const v = req.cookies.csrf;
  if (!v) return null;
  const [raw, mac] = v.split(".");
  return raw && mac && equal(mac, sign(raw, CSRF)) ? raw : null;
}
function csrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== ORIGIN)
    return fail(res, 403, "ORIGIN", "Origin is not allowed");
  const token = req.get("x-csrf-token");
  if (!token || token !== csrfValue(req))
    return fail(res, 403, "CSRF", "CSRF token is missing or invalid");
  next();
}
async function user(req: Authed, res: Response, next: NextFunction) {
  try {
    const raw = req.cookies.attendly_session;
    if (!raw) return fail(res, 401, "AUTH_REQUIRED", "Sign in required");
    const s = await prisma.loginSession.findUnique({
      where: { hash: hash(raw) },
      include: { user: true },
    });
    if (!s || s.expiresAt < new Date()) {
      if (s)
        await prisma.loginSession
          .delete({ where: { hash: s.hash } })
          .catch(() => {});
      return fail(res, 401, "AUTH_REQUIRED", "Sign in required");
    }
    req.user = {
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      role: s.user.role,
      prn: s.user.prn ?? null,
      avatar: s.user.avatar ?? null,
    };
    next();
  } catch (e) {
    next(e);
  }
}
const role = (r: Role) => (req: Authed, res: Response, next: NextFunction) =>
  req.user?.role === r
    ? next()
    : fail(res, 403, "FORBIDDEN", "You do not have access to this resource");
function schema<T extends z.ZodTypeAny>(s: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = s.safeParse(req.body);
    if (!p.success)
      return fail(
        res,
        400,
        "VALIDATION_ERROR",
        p.error.issues.map((i) => i.message).join(", "),
      );
    req.body = p.data;
    next();
  };
}
const userOut = (u: any) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  prn: u.prn ?? null,
  avatar: u.avatar ?? null,
});
// Profile photos are cropped and compressed in the browser before they get
// here, so a hard ceiling on the payload keeps a hostile client from stuffing
// the database with base64 blobs.
const avatarSchema = z
  .string()
  .max(450_000, "That image is too large. Try a smaller photo.")
  .regex(
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    "Profile pictures must be a PNG, JPEG or WebP image",
  );
const prnSchema = z
  .string()
  .trim()
  .min(4)
  .max(20)
  .regex(
    /^[A-Za-z0-9-]+$/,
    "PRN may contain letters, numbers and dashes only",
  )
  .transform((v) => v.toUpperCase());
// Roll-call order: students with a PRN first (ascending), then those without,
// then alphabetically. Null handling is explicit because locale collation does
// not rank punctuation after digits.
const byPrnThenName = (a: any, b: any) => {
  const ap = a.prn ? String(a.prn) : null;
  const bp = b.prn ? String(b.prn) : null;
  if (ap && bp) {
    const c = ap.localeCompare(bp);
    if (c) return c;
  } else if (ap) return -1;
  else if (bp) return 1;
  return String(a.name).localeCompare(String(b.name));
};
async function courseOut(c: any, owner = false) {
  const count =
    c.enrollments?.length ??
    (await prisma.enrollment.count({ where: { courseId: c.id } }));
  const sessions =
    c.sessions?.length ??
    (await prisma.classSession.count({ where: { courseId: c.id } }));
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    color: c.color,
    teacherName: c.teacher?.name || "",
    studentCount: count,
    sessionCount: sessions,
    ...(owner ? { joinCode: c.joinCode } : {}),
  };
}
async function sessionOut(s: any) {
  const total = await prisma.enrollment.count({
    where: { courseId: s.courseId },
  });
  const rows = await prisma.attendance.findMany({ where: { sessionId: s.id } });
  const present = rows.filter((r: any) => attended(r.status)).length;
  const now = new Date();
  const isActive = !s.closedAt && s.startedAt <= now && s.endsAt > now;
  const isScheduled = !s.closedAt && s.startedAt > now;
  const isCompleted = Boolean(s.closedAt) || s.endsAt <= now;
  return {
    id: s.id,
    courseId: s.courseId,
    courseName: s.course?.name || "",
    courseCode: s.course?.code || "",
    title: s.title,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    closedAt: s.closedAt,
    lateAfterMinutes: s.lateAfterMinutes,
    isActive,
    isScheduled,
    isCompleted,
    presentCount: present,
    studentCount: total,
    attendanceRate: rate(present, total),
  };
}
async function ownSession(req: Authed, res: Response, id: string) {
  const s = await prisma.classSession.findUnique({
    where: { id },
    include: { course: true },
  });
  if (!s || s.course.teacherId !== req.user!.id) {
    fail(res, 404, "NOT_FOUND", "Session not found");
    return null;
  }
  return s;
}
async function ownCourse(req: Authed, res: Response, id: string) {
  const c = await prisma.course.findUnique({ where: { id } });
  if (!c || c.teacherId !== req.user!.id) {
    fail(res, 404, "NOT_FOUND", "Course not found");
    return null;
  }
  return c;
}
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json(res, { status: "ok", database: "connected" });
  } catch {
    return json(res, { status: "degraded", database: "disconnected" }, 503);
  }
});
app.use("/api", csrf);
app.get("/api/auth/csrf", (req, res) => {
  const raw = random();
  res.cookie("csrf", `${raw}.${sign(raw, CSRF)}`, {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
  });
  json(res, { csrfToken: raw });
});
app.post(
  "/api/auth/login",
  schema(
    z.object({
      email: z
        .string()
        .email()
        .transform((v) => v.toLowerCase()),
      password: z.string().min(1),
    }),
  ),
  async (req, res, next) => {
    try {
      const u = await prisma.user.findUnique({
        where: { email: req.body.email },
      });
      if (!u || !(await bcrypt.compare(req.body.password, u.password)))
        return fail(
          res,
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect",
        );
      const raw = random();
      await prisma.loginSession.create({
        data: {
          hash: hash(raw),
          userId: u.id,
          expiresAt: new Date(Date.now() + 7 * 864e5),
        },
      });
      res.cookie("attendly_session", raw, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 7 * 864e5,
      });
      json(res, { user: userOut(u) });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/auth/register",
  schema(
    z.object({
      name: z.string().trim().min(2).max(80),
      email: z
        .string()
        .email()
        .transform((v) => v.toLowerCase()),
      prn: prnSchema,
      password: z.string().min(12).max(100),
    }),
  ),
  async (req, res, next) => {
    try {
      const u = await prisma.user.create({
        data: {
          name: req.body.name,
          email: req.body.email,
          prn: req.body.prn,
          password: await bcrypt.hash(req.body.password, 12),
          role: Role.STUDENT,
        },
      });
      const raw = random();
      await prisma.loginSession.create({
        data: {
          hash: hash(raw),
          userId: u.id,
          expiresAt: new Date(Date.now() + 7 * 864e5),
        },
      });
      res.cookie("attendly_session", raw, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 7 * 864e5,
      });
      json(res, { user: userOut(u) }, 201);
    } catch (e: any) {
      if (e.code === "P2002") {
        const target = Array.isArray(e.meta?.target)
          ? e.meta.target.join(",")
          : String(e.meta?.target ?? "");
        if (target.includes("prn"))
          return fail(
            res,
            409,
            "PRN_EXISTS",
            "That PRN is already registered. Sign in instead, or check the number.",
          );
        return fail(
          res,
          409,
          "EMAIL_EXISTS",
          "An account with that email already exists",
        );
      }
      next(e);
    }
  },
);
app.get("/api/auth/me", user, (req: Authed, res) =>
  json(res, { user: req.user }),
);
// Students who registered before PRN was required can add or correct it later.
app.patch(
  "/api/student/profile",
  user,
  role(Role.STUDENT),
  schema(z.object({ prn: prnSchema })),
  async (req: Authed, res, next) => {
    try {
      const u = await prisma.user.update({
        where: { id: req.user!.id },
        data: { prn: req.body.prn },
      });
      json(res, { user: userOut(u) });
    } catch (e: any) {
      if (e.code === "P2002")
        return fail(
          res,
          409,
          "PRN_EXISTS",
          "That PRN is already registered to another account",
        );
      next(e);
    }
  },
);
// Profile self-service for both roles: display name and profile photo. The
// photo arrives as a data URL, so the whole feature ships without any object
// storage or upload volume to run alongside the app.
app.patch(
  "/api/profile",
  user,
  schema(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      avatar: avatarSchema.nullable().optional(),
    }),
  ),
  async (req: Authed, res, next) => {
    try {
      if (req.body.name === undefined && req.body.avatar === undefined)
        return fail(res, 400, "NOTHING_TO_UPDATE", "Nothing to update");
      const u = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.avatar !== undefined ? { avatar: req.body.avatar } : {}),
        },
      });
      json(res, { user: userOut(u) });
    } catch (e) {
      next(e);
    }
  },
);
app.post("/api/auth/logout", user, async (req: Authed, res, next) => {
  try {
    const raw = req.cookies.attendly_session;
    if (raw)
      await prisma.loginSession
        .delete({ where: { hash: hash(raw) } })
        .catch(() => {});
    res.clearCookie("attendly_session", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    });
    json(res, { ok: true });
  } catch (e) {
    next(e);
  }
});

app.get(
  "/api/teacher/overview",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const courses = await prisma.course.findMany({
        where: { teacherId: req.user!.id },
        include: {
          enrollments: true,
          sessions: {
            orderBy: { startedAt: "desc" },
            take: 20,
            include: { course: true },
          },
        },
      });
      const ids = courses.map((c) => c.id);
      const ss = await prisma.classSession.findMany({
        where: { courseId: { in: ids } },
        include: { course: true },
        orderBy: { startedAt: "desc" },
        take: 30,
      });
      let total = 0,
        present = 0;
      for (const s of ss.filter(s => s.closedAt || s.endsAt <= new Date())) {
        // Only students enrolled before the session started are eligible.
        const es = await prisma.enrollment.findMany({
          where: { courseId: s.courseId, createdAt: { lte: s.startedAt } },
          select: { studentId: true },
        });
        const eligibleIds = es.map((e) => e.studentId);
        const a = await prisma.attendance.findMany({
          where: { sessionId: s.id, studentId: { in: eligibleIds } },
        });
        total +=
          eligibleIds.length - a.filter((x) => x.status === "EXCUSED").length;
        present += a.filter((x) => attended(x.status)).length;
      }
      const completedSessions = ss.filter(
        (s) => s.closedAt || s.endsAt <= new Date(),
      );
      const trend = await Promise.all(
        completedSessions
          .slice(0, 7)
          .reverse()
          .map(async (s) => {
            const es = await prisma.enrollment.findMany({
              where: { courseId: s.courseId, createdAt: { lte: s.startedAt } },
              select: { studentId: true },
            });
            const eligibleIds = es.map((e) => e.studentId);
            const a = await prisma.attendance.count({
              where: {
                sessionId: s.id,
                studentId: { in: eligibleIds },
                status: { in: [Status.PRESENT, Status.LATE] },
              },
            });
            return {
              date: s.startedAt.toISOString().slice(0, 10),
              label: s.startedAt.toLocaleDateString("en", { weekday: "short" }),
              rate: rate(a, eligibleIds.length),
              present: a,
              total: eligibleIds.length,
            };
          }),
      );
      const active = ss.filter(
        (s) => !s.closedAt && s.startedAt <= new Date() && s.endsAt > new Date(),
      );
      const upcoming = await prisma.classSession.findMany({
        where: {
          courseId: { in: ids },
          closedAt: null,
          startedAt: { gt: new Date() },
        },
        include: { course: true },
        orderBy: { startedAt: "asc" },
        take: 50,
      });
      json(res, {
        metrics: {
          totalCourses: courses.length,
          totalStudents: await prisma.enrollment.count({
            where: { courseId: { in: ids } },
          }),
          totalSessions: completedSessions.length,
          averageAttendance: rate(present, total),
          activeSessions: active.length,
          scheduledSessions: upcoming.length,
        },
        courses: await Promise.all(courses.map((c) => courseOut(c, true))),
        trend,
        recentSessions: await Promise.all(ss.slice(0, 8).map(sessionOut)),
        upcomingSessions: await Promise.all(upcoming.map(sessionOut)),
      });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/courses",
  user,
  role(Role.TEACHER),
  schema(
    z.object({
      name: z.string().trim().min(2).max(80),
      code: z
        .string()
        .trim()
        .min(2)
        .max(16)
        .transform((v) => v.toUpperCase()),
      color: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
    }),
  ),
  async (req: Authed, res, next) => {
    try {
      const c = await prisma.course.create({
        data: {
          ...req.body,
          color: req.body.color || "#8b5cf6",
          teacherId: req.user!.id,
          joinCode: random().slice(0, 8).toUpperCase(),
        },
      });
      json(res, { course: await courseOut(c, true) }, 201);
    } catch (e: any) {
      if (e.code === "P2002")
        return fail(
          res,
          409,
          "COURSE_EXISTS",
          "That course code already exists",
        );
      next(e);
    }
  },
);
app.post(
  "/api/courses/join",
  user,
  role(Role.STUDENT),
  schema(z.object({ joinCode: z.string().trim().min(4).max(20) })),
  async (req: Authed, res, next) => {
    try {
      const c = await prisma.course.findUnique({
        where: { joinCode: req.body.joinCode.toUpperCase() },
        include: { teacher: true },
      });
      if (!c)
        return fail(res, 404, "INVALID_CODE", "Enrollment code not found");
      await prisma.enrollment.upsert({
        where: {
          courseId_studentId: { courseId: c.id, studentId: req.user!.id },
        },
        create: { courseId: c.id, studentId: req.user!.id },
        update: {},
      });
      json(res, { course: await courseOut(c) });
    } catch (e) {
      next(e);
    }
  },
);
app.get(
  "/api/courses/:courseId/students",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const es: any[] = await prisma.enrollment.findMany({
        where: { courseId: c.id },
        include: { student: true },
      });
      json(res, {
        students: es
          .map((e) => ({
            studentId: e.studentId,
            name: e.student.name,
            email: e.student.email,
            prn: e.student.prn ?? null,
            avatar: e.student.avatar ?? null,
            enrolledAt: e.createdAt,
          }))
          .sort(byPrnThenName),
      });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/courses/:courseId/students",
  user,
  role(Role.TEACHER),
  schema(
    z.object({
      email: z
        .string()
        .email()
        .transform((v) => v.toLowerCase()),
    }),
  ),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const student = await prisma.user.findUnique({
        where: { email: req.body.email },
      });
      if (!student || student.role !== Role.STUDENT)
        return fail(
          res,
          404,
          "STUDENT_NOT_FOUND",
          "No student account matches that email",
        );
      await prisma.enrollment.upsert({
        where: {
          courseId_studentId: { courseId: c.id, studentId: student.id },
        },
        create: { courseId: c.id, studentId: student.id },
        update: {},
      });
      json(
        res,
        {
          student: {
            studentId: student.id,
            name: student.name,
            email: student.email,
            prn: student.prn ?? null,
          },
        },
        201,
      );
    } catch (e) {
      next(e);
    }
  },
);
app.delete(
  "/api/courses/:courseId/students/:studentId",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      await prisma.enrollment.deleteMany({
        where: { courseId: c.id, studentId: String(req.params.studentId) },
      });
      json(res, { ok: true });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/courses/:courseId/sessions",
  user,
  role(Role.TEACHER),
  schema(
    z
      .object({
        title: z.string().trim().min(2).max(100),
        durationMinutes: z.coerce.number().int().min(5).max(240),
        // Optional explicit start; omit to open a session starting now.
        startsAt: z.string().datetime().optional(),
        lateAfterMinutes: z.coerce.number().int().min(1).optional(),
      })
      .refine(
        (d) =>
          d.lateAfterMinutes === undefined ||
          d.lateAfterMinutes <= d.durationMinutes,
        { message: "lateAfterMinutes must not exceed the session duration" },
      ),
  ),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const start = req.body.startsAt
        ? new Date(req.body.startsAt)
        : new Date();
      const now = new Date();
      // Only a session that is live right now blocks another live session;
      // future-dated lectures can be scheduled freely.
      if (start <= now) {
        const active = await prisma.classSession.findFirst({
          where: {
            courseId: c.id,
            closedAt: null,
            startedAt: { lte: now },
            endsAt: { gt: now },
          },
        });
        if (active)
          return fail(
            res,
            409,
            "ACTIVE_SESSION",
            "Close the current live session first",
          );
      }
      const s = await prisma.classSession.create({
        data: {
          courseId: c.id,
          title: req.body.title,
          startedAt: start,
          lateAfterMinutes:
            req.body.lateAfterMinutes ?? Math.min(15, req.body.durationMinutes),
          endsAt: new Date(start.getTime() + req.body.durationMinutes * 60000),
        },
        include: { course: true },
      });
      json(res, { session: await sessionOut(s) }, 201);
    } catch (e) {
      next(e);
    }
  },
);
app.patch(
  "/api/sessions/:sessionId",
  user,
  role(Role.TEACHER),
  schema(
    z
      .object({
        title: z.string().trim().min(2).max(100).optional(),
        durationMinutes: z.coerce.number().int().min(5).max(240).optional(),
        startsAt: z.string().datetime().optional(),
        lateAfterMinutes: z.coerce.number().int().min(1).optional(),
      })
      .refine((d) => Object.keys(d).length > 0, {
        message: "Provide at least one field to update",
      }),
  ),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const duration =
        req.body.durationMinutes ??
        Math.round((s.endsAt.getTime() - s.startedAt.getTime()) / 60000);
      const start = req.body.startsAt
        ? new Date(req.body.startsAt)
        : s.startedAt;
      const lateAfter =
        req.body.lateAfterMinutes ?? s.lateAfterMinutes;
      if (lateAfter > duration)
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "lateAfterMinutes must not exceed the session duration",
        );
      const updated = await prisma.classSession.update({
        where: { id: s.id },
        data: {
          title: req.body.title ?? s.title,
          startedAt: start,
          endsAt: new Date(start.getTime() + duration * 60000),
          lateAfterMinutes: lateAfter,
        },
        include: { course: true },
      });
      json(res, { session: await sessionOut(updated) });
    } catch (e) {
      next(e);
    }
  },
);
app.delete(
  "/api/sessions/:sessionId",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const marked = await prisma.attendance.count({
        where: { sessionId: s.id },
      });
      if (marked)
        return fail(
          res,
          409,
          "SESSION_HAS_ATTENDANCE",
          "Remove the recorded attendance before deleting this lecture",
        );
      await prisma.classSession.delete({ where: { id: s.id } });
      json(res, { ok: true });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/sessions/:sessionId/close",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const updated = await prisma.classSession.update({
        where: { id: s.id },
        data: { closedAt: new Date() },
        include: { course: true },
      });
      json(res, { session: await sessionOut(updated) });
    } catch (e) {
      next(e);
    }
  },
);
app.get(
  "/api/sessions/:sessionId/attendance",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const es: any[] = await prisma.enrollment.findMany({
        where: { courseId: s.courseId },
        include: { student: true },
      });
      const rows = await Promise.all(
        es.map(async (e) => {
          const a = await prisma.attendance.findUnique({
            where: {
              sessionId_studentId: { sessionId: s.id, studentId: e.studentId },
            },
          });
          return {
            studentId: e.studentId,
            name: e.student.name,
            email: e.student.email,
            prn: e.student.prn ?? null,
            avatar: e.student.avatar ?? null,
            status: a?.status || "UNMARKED",
            checkedInAt: a?.checkedInAt || null,
            source: a?.source || null,
          };
        }),
      );
      rows.sort(byPrnThenName);
      json(res, { session: await sessionOut(s), records: rows });
    } catch (e) {
      next(e);
    }
  },
);
app.patch(
  "/api/sessions/:sessionId/attendance/:studentId",
  user,
  role(Role.TEACHER),
  schema(
    z.object({
      status: z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]),
      reason: z.string().trim().max(300).optional(),
    }),
  ),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const studentId = String(req.params.studentId);
      const enrolled: any = await prisma.enrollment.findUnique({
        where: { courseId_studentId: { courseId: s.courseId, studentId } },
        include: { student: true },
      });
      if (!enrolled)
        return fail(
          res,
          404,
          "NOT_ENROLLED",
          "Student is not enrolled in this course",
        );
      const old = await prisma.attendance.findUnique({
        where: { sessionId_studentId: { sessionId: s.id, studentId } },
      });
      const a = await prisma.attendance.upsert({
        where: { sessionId_studentId: { sessionId: s.id, studentId } },
        create: {
          sessionId: s.id,
          studentId,
          status: req.body.status,
          source: "MANUAL",
          checkedInAt: new Date(),
        },
        update: { status: req.body.status, source: "MANUAL", checkedInAt: new Date() },
      });
      await prisma.audit.create({
        data: {
          actorId: req.user!.id,
          sessionId: s.id,
          studentId,
          before: old?.status,
          after: req.body.status,
          reason:
            req.body.reason || (old ? "Teacher override" : "Teacher marking"),
        },
      });
      json(res, {
        record: {
          studentId: a.studentId,
          name: enrolled.student.name,
          email: enrolled.student.email,
          prn: enrolled.student.prn ?? null,
          status: a.status,
          checkedInAt: a.checkedInAt,
          source: a.source,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/sessions/:sessionId/attendance/bulk",
  user,
  role(Role.TEACHER),
  schema(
    z.object({
      status: z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]),
      studentIds: z.array(z.string().min(1)).max(500).optional(),
      reason: z.string().trim().max(300).optional(),
    }),
  ),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const enrolled: any[] = await prisma.enrollment.findMany({
        where: { courseId: s.courseId },
      });
      const wanted: string[] | undefined = req.body.studentIds;
      const ids = (
        wanted?.length
          ? enrolled.filter((e) => wanted.includes(e.studentId))
          : enrolled
      ).map((e) => e.studentId);
      if (!ids.length)
        return fail(res, 400, "NO_STUDENTS", "No enrolled students to mark");
      const reason = req.body.reason || "Bulk teacher marking";
      const now = new Date();
      for (const studentId of ids) {
        const old = await prisma.attendance.findUnique({
          where: { sessionId_studentId: { sessionId: s.id, studentId } },
        });
        await prisma.attendance.upsert({
          where: { sessionId_studentId: { sessionId: s.id, studentId } },
          create: {
            sessionId: s.id,
            studentId,
            status: req.body.status,
            source: "MANUAL",
            checkedInAt: now,
          },
          update: { status: req.body.status, source: "MANUAL", checkedInAt: now },
        });
        await prisma.audit.create({
          data: {
            actorId: req.user!.id,
            sessionId: s.id,
            studentId,
            before: old?.status,
            after: req.body.status,
            reason,
          },
        });
      }
      json(res, { updated: ids.length, status: req.body.status });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/sessions/:sessionId/reopen",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const s = await ownSession(req, res, String(req.params.sessionId));
      if (!s) return;
      const reopened = await prisma.classSession.update({
        where: { id: s.id },
        data: { closedAt: null, endsAt: new Date(Date.now() + 30 * 60000) },
        include: { course: true },
      });
      json(res, { session: await sessionOut(reopened) });
    } catch (e) {
      next(e);
    }
  },
);
app.get(
  "/api/courses/:courseId/export",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const es: any[] = await prisma.enrollment.findMany({
        where: { courseId: c.id },
        include: { student: true },
      });
      const ss = await prisma.classSession.findMany({
        where: { courseId: c.id },
        orderBy: { startedAt: "asc" },
      });
      let out = "Student,PRN,Email,Session,Date,Status\n";
      for (const e of es)
        for (const s of ss) {
          const a = await prisma.attendance.findUnique({
            where: {
              sessionId_studentId: { sessionId: s.id, studentId: e.studentId },
            },
          });
          out +=
            [
              e.student.name,
              e.student.prn,
              e.student.email,
              s.title,
              s.startedAt.toISOString(),
              a?.status || "ABSENT",
            ]
              .map(csv)
              .join(",") + "\n";
        }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${c.code}-attendance.csv"`,
      );
      res.send(out);
    } catch (e) {
      next(e);
    }
  },
);

app.get(
  "/api/teacher/analytics",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const now = new Date();
      const courses = await prisma.course.findMany({
        where: { teacherId: req.user!.id },
        include: { enrollments: { include: { student: true } } },
        orderBy: { code: "asc" },
      });
      const subjects = [];
      for (const c of courses) {
        // Only completed lectures count toward attendance statistics.
        const sessions = (
          await prisma.classSession.findMany({ where: { courseId: c.id } })
        ).filter((s) => s.closedAt || s.endsAt <= now);
        const att = await prisma.attendance.findMany({
          where: { session: { courseId: c.id } },
        });
        const rows = c.enrollments.map((e) => {
          let present = 0,
            late = 0,
            absent = 0,
            excused = 0;
          for (const s of sessions) {
            if (e.createdAt > s.startedAt) continue;
            const a = att.find(
              (x) => x.sessionId === s.id && x.studentId === e.studentId,
            );
            const st = a?.status ?? "ABSENT";
            if (st === "EXCUSED") excused++;
            else if (st === "PRESENT") present++;
            else if (st === "LATE") late++;
            else absent++;
          }
          const eligible = present + late + absent;
          return {
            studentId: e.studentId,
            name: e.student.name,
            email: e.student.email,
            prn: e.student.prn ?? null,
            avatar: e.student.avatar ?? null,
            enrolledAt: e.createdAt,
            present,
            late,
            absent,
            excused,
            eligible,
            rate: rate(present + late, eligible),
          };
        });
        // Surface the least-attending students first.
        rows.sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
        const totalEligible = rows.reduce((n, r) => n + r.eligible, 0);
        const totalAttended = rows.reduce(
          (n, r) => n + r.present + r.late,
          0,
        );
        subjects.push({
          courseId: c.id,
          courseName: c.name,
          courseCode: c.code,
          color: c.color,
          studentCount: c.enrollments.length,
          completedSessions: sessions.length,
          averageRate: rate(totalAttended, totalEligible),
          students: rows,
        });
      }
      json(res, { subjects, generatedAt: now.toISOString() });
    } catch (e) {
      next(e);
    }
  },
);
const postOut = (p: any) => ({
  id: p.id,
  courseId: p.courseId,
  courseCode: p.course?.code || "",
  courseName: p.course?.name || "",
  courseColor: p.course?.color || "#8b5cf6",
  kind: p.kind,
  title: p.title,
  body: p.body,
  url: p.url || null,
  pinned: p.pinned,
  createdAt: p.createdAt,
  authorName: p.author?.name || "",
});
app.get(
  "/api/courses/:courseId/posts",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const posts = await prisma.post.findMany({
        where: { courseId: c.id },
        include: { course: true, author: true },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      });
      json(res, { posts: posts.map(postOut) });
    } catch (e) {
      next(e);
    }
  },
);
app.post(
  "/api/courses/:courseId/posts",
  user,
  role(Role.TEACHER),
  schema(
    z
      .object({
        kind: z.enum(["NOTICE", "MATERIAL"]).default("NOTICE"),
        title: z.string().trim().min(2).max(120),
        body: z.string().trim().max(4000).default(""),
        url: z.string().trim().url().max(500).optional(),
        pinned: z.boolean().optional(),
      })
      .refine((d) => d.kind !== "MATERIAL" || Boolean(d.url), {
        message: "A study material needs a downloadable link",
      })
      .refine((d) => d.kind !== "NOTICE" || d.body.length > 0, {
        message: "A notice needs a message",
      }),
  ),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const p = await prisma.post.create({
        data: {
          courseId: c.id,
          authorId: req.user!.id,
          kind: req.body.kind as PostKind,
          title: req.body.title,
          body: req.body.body,
          url: req.body.url || null,
          pinned: req.body.pinned ?? false,
        },
        include: { course: true, author: true },
      });
      json(res, { post: postOut(p) }, 201);
    } catch (e) {
      next(e);
    }
  },
);
app.patch(
  "/api/courses/:courseId/posts/:postId",
  user,
  role(Role.TEACHER),
  schema(
    z
      .object({
        title: z.string().trim().min(2).max(120).optional(),
        body: z.string().trim().max(4000).optional(),
        url: z.string().trim().url().max(500).optional(),
        pinned: z.boolean().optional(),
      })
      .refine((d) => Object.keys(d).length > 0, {
        message: "Provide at least one field to update",
      }),
  ),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const existing = await prisma.post.findUnique({
        where: { id: String(req.params.postId) },
      });
      if (!existing || existing.courseId !== c.id)
        return fail(res, 404, "NOT_FOUND", "Post not found");
      const p = await prisma.post.update({
        where: { id: existing.id },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.body !== undefined ? { body: req.body.body } : {}),
          ...(req.body.url !== undefined ? { url: req.body.url } : {}),
          ...(req.body.pinned !== undefined
            ? { pinned: req.body.pinned }
            : {}),
        },
        include: { course: true, author: true },
      });
      json(res, { post: postOut(p) });
    } catch (e) {
      next(e);
    }
  },
);
app.delete(
  "/api/courses/:courseId/posts/:postId",
  user,
  role(Role.TEACHER),
  async (req: Authed, res, next) => {
    try {
      const c = await ownCourse(req, res, String(req.params.courseId));
      if (!c) return;
      const existing = await prisma.post.findUnique({
        where: { id: String(req.params.postId) },
      });
      if (!existing || existing.courseId !== c.id)
        return fail(res, 404, "NOT_FOUND", "Post not found");
      await prisma.post.delete({ where: { id: existing.id } });
      json(res, { ok: true });
    } catch (e) {
      next(e);
    }
  },
);
app.get(
  "/api/student/feed",
  user,
  role(Role.STUDENT),
  async (req: Authed, res, next) => {
    try {
      const en = await prisma.enrollment.findMany({
        where: { studentId: req.user!.id },
        include: { course: true },
      });
      const ids = en.map((e) => e.courseId);
      const posts = await prisma.post.findMany({
        where: { courseId: { in: ids } },
        include: { course: true, author: true },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 100,
      });
      json(res, {
        posts: posts.map(postOut),
        courses: en.map((e) => ({
          id: e.course.id,
          code: e.course.code,
          name: e.course.name,
          color: e.course.color,
        })),
      });
    } catch (e) {
      next(e);
    }
  },
);

// Per-subject lecture detail for a student: every lecture with its own
// present/absent/late/excused status, start-end times and scheduled lectures.
app.get(
  "/api/student/courses/:courseId",
  user,
  role(Role.STUDENT),
  async (req: Authed, res, next) => {
    try {
      const courseId = String(req.params.courseId);
      const en = await prisma.enrollment.findUnique({
        where: { courseId_studentId: { courseId, studentId: req.user!.id } },
        include: { course: { include: { teacher: true } } },
      });
      if (!en) return fail(res, 404, "NOT_FOUND", "Course not found");
      const now = new Date();
      const sessions = await prisma.classSession.findMany({
        where: { courseId },
        orderBy: { startedAt: "asc" },
      });
      const att = await prisma.attendance.findMany({
        where: { studentId: req.user!.id, session: { courseId } },
      });
      const studentCount = await prisma.enrollment.count({
        where: { courseId },
      });
      // Only lectures that started on/after enrollment count for this student.
      const rows = sessions
        .filter((s) => en.createdAt <= s.startedAt)
        .map((s) => {
          const a = att.find((x) => x.sessionId === s.id);
          const isCompleted = Boolean(s.closedAt) || s.endsAt <= now;
          const isActive =
            !s.closedAt && s.startedAt <= now && s.endsAt > now;
          const status =
            a?.status ??
            (isCompleted ? "ABSENT" : isActive ? "UNMARKED" : "SCHEDULED");
          return {
            sessionId: s.id,
            title: s.title,
            startedAt: s.startedAt,
            endsAt: s.endsAt,
            status,
            checkedInAt: a?.checkedInAt ?? null,
            isUpcoming: !isCompleted && !isActive,
          };
        });
      const past = rows.filter((r) => r.status !== "UNMARKED");
      const present = past.filter((r) => r.status === "PRESENT").length;
      const late = past.filter((r) => r.status === "LATE").length;
      const absent = past.filter((r) => r.status === "ABSENT").length;
      const excused = past.filter((r) => r.status === "EXCUSED").length;
      json(res, {
        course: {
          id: en.course.id,
          name: en.course.name,
          code: en.course.code,
          color: en.course.color,
          teacherName: en.course.teacher?.name || "",
          studentCount,
          sessionCount: sessions.length,
        },
        summary: {
          present,
          late,
          absent,
          excused,
          eligible: present + late + absent,
          rate: rate(present + late, present + late + absent),
          upcoming: rows.filter((r) => r.isUpcoming).length,
        },
        lectures: past
          .filter((r) => !r.isUpcoming)
          .sort(
            (a, b) => +new Date(b.startedAt) - +new Date(a.startedAt),
          ),
        upcoming: rows
          .filter((r) => r.isUpcoming)
          .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt)),
      });
    } catch (e) {
      next(e);
    }
  },
);

async function studentOverview(req: Authed) {
  const en = await prisma.enrollment.findMany({
    where: { studentId: req.user!.id },
    include: { course: { include: { teacher: true } } },
  });
  const ids = en.map((e) => e.courseId);
  const ss = await prisma.classSession.findMany({
    where: { courseId: { in: ids } },
    include: { course: true },
    orderBy: { startedAt: "desc" },
  });
  const as = await prisma.attendance.findMany({
    where: { studentId: req.user!.id, session: { courseId: { in: ids } } },
  });
  const enrollmentByCourse = new Map(en.map((e) => [e.courseId, e.createdAt]));
  const completed = ss.filter(
    (s) =>
      (s.closedAt || s.endsAt <= new Date()) &&
      enrollmentByCourse.get(s.courseId)! <= s.startedAt,
  );
  let denom = 0,
    present = 0;
  for (const s of completed) {
    const a = as.find((x) => x.sessionId === s.id);
    if (a?.status === "EXCUSED") continue;
    denom++;
    if (a && attended(a.status)) present++;
  }
  let streak = 0;
  for (const s of completed) {
    const a = as.find((x) => x.sessionId === s.id);
    if (a?.status === "EXCUSED") continue;
    if (a && attended(a.status)) streak++;
    else break;
  }
  const month =
    typeof req.query.month === "string"
      ? req.query.month
      : new Date().toISOString().slice(0, 7);
  const calendar: any = {};
  for (const s of completed.filter((x) =>
    x.startedAt.toISOString().startsWith(month),
  )) {
    const a = as.find((x) => x.sessionId === s.id);
    const status = a?.status || "ABSENT";
    const d = s.startedAt.toISOString().slice(0, 10);
    calendar[d] ??= [];
    calendar[d].push({ title: s.title, courseCode: s.course.code, status });
  }
  return {
    metrics: {
      attendanceRate: rate(present, denom),
      attendedSessions: present,
      totalSessions: denom,
      streak,
      lateSessions: completed.filter(
        (s) => as.find((x) => x.sessionId === s.id)?.status === "LATE",
      ).length,
      missedSessions: denom - present,
    },
    courses: await Promise.all(
      en.map(async (e) => {
        const cs = completed.filter((s) => s.courseId === e.courseId);
        const ca = as.filter((a) => cs.some((s) => s.id === a.sessionId));
        return {
          ...(await courseOut(e.course)),
          attendanceRate: rate(
            ca.filter((a) => attended(a.status)).length,
            cs.length - ca.filter(a => a.status === "EXCUSED").length,
          ),
          attendedSessions: ca.filter((a) => attended(a.status)).length,
          totalSessions: cs.length - ca.filter(a => a.status === "EXCUSED").length,
        };
      }),
    ),
    calendar: Object.entries(calendar).map(([date, sessions]) => ({
      date,
      status: (sessions as any[]).some((x) => x.status === "ABSENT")
        ? "ABSENT"
        : (sessions as any[]).some((x) => x.status === "LATE")
          ? "LATE"
          : (sessions as any[]).some(x => x.status === "PRESENT") ? "PRESENT" : "EXCUSED",
      sessions,
    })),
    recentAttendance: ss
      .filter((s) => {
        const a = as.find((x) => x.sessionId === s.id);
        return (
          enrollmentByCourse.get(s.courseId)! <= s.startedAt &&
          (s.closedAt || s.endsAt <= new Date() || Boolean(a))
        );
      })
      .slice(0, 12)
      .map((s) => {
        const a = as.find((x) => x.sessionId === s.id);
        return {
          sessionId: s.id,
          title: s.title,
          courseName: s.course.name,
          courseCode: s.course.code,
          date: s.startedAt,
          endsAt: s.endsAt,
          status: a?.status || "ABSENT",
          checkedInAt: a?.checkedInAt || null,
        };
      }),
    activeSessions: await Promise.all(
      ss.filter((s) => !s.closedAt && s.endsAt > new Date()).map(sessionOut),
    ),
  };
}
app.get(
  "/api/student/overview",
  user,
  role(Role.STUDENT),
  async (req: Authed, res, next) => {
    try {
      json(res, await studentOverview(req));
    } catch (e) {
      next(e);
    }
  },
);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err?.code || err?.message || err);
  if (!res.headersSent)
    fail(
      res,
      500,
      "SERVER_ERROR",
      NODE_ENV === "production"
        ? "Something went wrong"
        : "Unexpected server error",
    );
});
app.listen(PORT, () => console.log(`Attendly API listening on ${PORT}`));
export { app, prisma };
