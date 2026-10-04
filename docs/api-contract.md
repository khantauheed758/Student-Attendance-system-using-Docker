# Attendly API contract

All endpoints are relative to `/api`; the Next.js server proxies this prefix to Express. JSON dates are ISO-8601 UTC; the UI formats them in the user's locale. Success responses are JSON (except CSV); failures are `{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": optional } }`. List results are bounded. Never return password hashes or session tokens in JSON.

## Authentication and security

- `GET /health`: `{ status: "ok", database: "connected" }`, readiness check including PostgreSQL.
- `GET /auth/csrf`: `{ csrfToken: string }`; establishes/returns a signed double-submit CSRF cookie. Every POST/PATCH/DELETE sends `X-CSRF-Token`. Validate signature and equality server-side, also validate Origin when present.
- `POST /auth/login`: `{ email, password }` -> `{ user: User }`, opaque random HttpOnly cookie, SHA-256 hashed session token stored in PostgreSQL, expiry and revocation enforced.
- `POST /auth/register`: `{ name, email, prn, password }` -> `{ user: User }`, creates STUDENT only and signs in. Minimum 12-character password. `prn` is required and unique (4-20 characters of letters, numbers or dashes; stored upper-cased); a clash returns 409 `PRN_EXISTS` and a duplicate email returns 409 `EMAIL_EXISTS`. Teacher accounts are provisioned, not publicly self-assigned: run `npx tsx prisma/create-teacher.ts <name> <email> <password>` (or `npm run db:create-teacher`) on the host that reaches the database. Re-running promotes an existing account to TEACHER and resets its password.
- `GET /auth/me`: `{ user: User }` or 401.
- `POST /auth/logout`: `{ ok: true }`, revokes session and clears cookie.
- `PATCH /profile` (any signed-in user): `{ name?, avatar? }` -> `{ user: User }`. Display name is 2-80 characters. `avatar` is a cropped square image as a `data:image/(png|jpeg|webp);base64,...` URL, or `null` to clear it and fall back to initials; anything else (remote URL, SVG, oversize payload) is rejected with `VALIDATION_ERROR`. This route accepts a 600 kB body because the image travels inline; every other endpoint stays capped at 32 kB.
- `User`: `{ id: string, name: string, email: string, role: "TEACHER" | "STUDENT", prn: string | null, avatar: string | null }`. `prn` (Permanent Registration Number) is set for students and null for teachers or legacy accounts. `avatar` is a data URL or null.

Cookie path `/`, SameSite=Lax, Secure controlled by `COOKIE_SECURE` (true for HTTPS deployment, false only for localhost HTTP). Mutations are JSON except empty POSTs; require CSRF. Frontend fetch uses credentials same-origin. Credential endpoints (`POST /auth/login` and `POST /auth/register`) are rate limited and always answer 429 with a JSON error body; `GET /auth/csrf` and `GET /auth/me` are deliberately not limited, because every page load calls them and limiting them would lock users out of the sign-in screen. Password hashing uses scrypt or bcrypt with secure parameters. User role and resource ownership come only from the authenticated database user.

## Shared data types

- `AttendanceStatus`: `PRESENT | LATE | ABSENT | EXCUSED`.
- `Course`: `{ id, name, code, color, teacherName, studentCount, sessionCount, joinCode?: string }`; only the owning teacher sees joinCode. Color is a validated hex color, default `#8b5cf6`.
- `SessionSummary`: `{ id, courseId, courseName, courseCode, title, startedAt, endsAt, closedAt: string | null, lateAfterMinutes: number, isActive: boolean, isScheduled: boolean, isCompleted: boolean, presentCount, studentCount, attendanceRate: number }`. `isActive` is true only between `startedAt` and `endsAt` while open; `isScheduled` is a future, unclosed lecture; `isCompleted` is a closed or ended session.
- `Post`: `{ id, courseId, courseCode, courseName, courseColor, kind: "NOTICE" | "MATERIAL", title, body, url: string | null, pinned: boolean, createdAt, authorName }`.
- `TrendPoint`: `{ date: "YYYY-MM-DD", label: string, rate: number, present: number, total: number }`.

Attendance rules: eligible sessions start on/after the student's enrollment date. Missing records count ABSENT only for ended/closed sessions. Active missing records count UNMARKED, not absent. PRESENT and LATE count attended; EXCUSED excludes the student/session from the denominator. Metrics return 0 for empty denominators, not NaN. Student streak is consecutive attended eligible completed sessions (excused sessions skipped). Never award attendance based on client timestamps. Manual teacher changes are audited with the actor, previous status, new status and a reason.

## Teacher endpoints (TEACHER only; all resources ownership-scoped)

- `GET /teacher/overview` -> `{ metrics: { totalCourses, totalStudents, totalSessions, averageAttendance, activeSessions, scheduledSessions }, courses: Course[], trend: TrendPoint[], recentSessions: SessionSummary[], upcomingSessions: SessionSummary[] }`. `upcomingSessions` are future-dated lectures ordered soonest-first.
- `GET /teacher/analytics` -> `{ subjects: SubjectAnalytics[], generatedAt: string }`. Attendance aggregated per subject (course). `SubjectAnalytics`: `{ courseId, courseName, courseCode, color, studentCount, completedSessions, averageRate, students: StudentStat[] }`; `StudentStat`: `{ studentId, name, email, prn: string | null, avatar: string | null, enrolledAt, present, late, absent, excused, eligible, rate }`. Only completed lectures count; excused records are excluded from the denominator; students are sorted lowest attendance first.
- `POST /courses`: `{ name, code, color? }` -> `{ course: Course }`. Generate an unguessable enrollment join code.
- `POST /courses/:courseId/sessions`: `{ title, durationMinutes: number, startsAt?: string, lateAfterMinutes?: number }` -> `{ session: SessionSummary }`. Omit `startsAt` to open a session starting now, or pass an ISO-8601 instant to schedule a future lecture (manual scheduler). Duration 5..240 min, lateAfterMinutes >= 1 and <= durationMinutes (defaults to 15). At most one *live* session per course; future lectures can be scheduled freely.
- `PATCH /sessions/:sessionId`: `{ title?, startsAt?, durationMinutes?, lateAfterMinutes? }` -> `{ session: SessionSummary }`. Reschedules or retitles an owned lecture; `endsAt` is recomputed from the start and duration.
- `DELETE /sessions/:sessionId`: `{ ok: true }`. Deletes an owned lecture; rejected with 409 `SESSION_HAS_ATTENDANCE` once any attendance has been recorded.
- `POST /sessions/:sessionId/close`: `{}` -> `{ session: SessionSummary }`. Finalizes the session.
- `POST /sessions/:sessionId/reopen`: `{}` -> `{ session: SessionSummary }`. Clears closedAt and extends the window so the teacher can correct a finalized session.
- `GET /sessions/:sessionId/attendance` -> `{ session: SessionSummary, records: AttendanceRow[] }`.
- `AttendanceRow`: `{ studentId, name, email, prn: string | null, status: AttendanceStatus | "UNMARKED", checkedInAt: string | null, source: "MANUAL" | null }`. Rows are ordered for roll call: students with a PRN first (ascending), then those without, then by name.
- `PATCH /sessions/:sessionId/attendance/:studentId`: `{ status: AttendanceStatus, reason?: string }` -> `{ record: AttendanceRow }`. Marks one student. A reason is recorded (a sensible default is stored when omitted).
- `POST /sessions/:sessionId/attendance/bulk`: `{ status: AttendanceStatus, studentIds?: string[], reason?: string }` -> `{ updated: number, status }`. Marks every enrolled student (or the listed subset) in one call.
- `GET /courses/:courseId/students` -> `{ students: { studentId, name, email, prn: string | null, enrolledAt }[] }`. Teacher roster view, in roll-call order.
- `POST /courses/:courseId/students`: `{ email }` -> `{ student }`. Enroll a registered student directly by email; 404 when no student account matches.
- `DELETE /courses/:courseId/students/:studentId` -> `{ ok: true }`. Remove a student from the course.
- `GET /courses/:courseId/export`: downloadable CSV (`Student, PRN, Email, Session, Date, Status`) with safe quoted fields (spreadsheet formula injection escaped), sessions and enrolled students, effective attendance statuses. Only the owning teacher can export.
- `GET /courses/:courseId/posts` -> `{ posts: Post[] }`. Noticeboard for one owned course, pinned first.
- `POST /courses/:courseId/posts`: `{ kind: "NOTICE" | "MATERIAL", title, body?, url?, pinned? }` -> `{ post: Post }`. A MATERIAL requires a valid `url`; a NOTICE requires a non-empty `body`.
- `PATCH /courses/:courseId/posts/:postId`: `{ title?, body?, url?, pinned? }` -> `{ post: Post }`. Edit or pin an owned post.
- `DELETE /courses/:courseId/posts/:postId` -> `{ ok: true }`. Delete an owned post.

## Student endpoints (STUDENT only)

Students have no way to mark their own attendance. They can join courses and read their own analytics only; every attendance record is written by the course teacher.

- `PATCH /student/profile`: `{ prn }` -> `{ user: User }`. Lets a student add or correct their PRN after signing up. Same validation as registration; a clash returns 409 `PRN_EXISTS`. Profile photos and display names are shared with teachers and go through `PATCH /profile`.
- `POST /courses/join`: `{ joinCode: string }` -> `{ course: Course }`. Idempotent enrollment, no retroactive absences.
- `GET /student/overview?month=YYYY-MM` -> `{ metrics: { attendanceRate, attendedSessions, totalSessions, streak, lateSessions, missedSessions }, courses: StudentCourse[], calendar: CalendarDay[], recentAttendance: StudentAttendance[], activeSessions: SessionSummary[] }`.
- `StudentCourse`: `Course & { attendanceRate: number, attendedSessions: number, totalSessions: number }`.
- `CalendarDay`: `{ date: "YYYY-MM-DD", status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED", sessions: { title, courseCode, status: AttendanceStatus }[] }`. One row per date with completed eligible sessions (worst status wins: absent > late > present > excused); empty dates omitted. Month affects calendar only.
- `StudentAttendance`: `{ sessionId, title, courseName, courseCode, date: string, endsAt: string, status: AttendanceStatus, checkedInAt: string | null }`. Includes inferred absences from ended sessions, plus active checked-in records.
- `GET /student/courses/:courseId` -> `{ course: Course, summary: { present, late, absent, excused, eligible, rate, upcoming }, lectures: LectureRow[], active: LectureRow[], upcoming: LectureRow[] }`. Per-subject drill-down for the signed-in student; 404 when not enrolled. `LectureRow`: `{ sessionId, title, startedAt, endsAt, status: AttendanceStatus | "UNMARKED" | "SCHEDULED", checkedInAt: string | null, isUpcoming: boolean }`. `lectures` covers completed/ended lectures newest-first with inferred absences; `upcoming` are future scheduled lectures; only lectures starting on/after the student's enrollment date are included. The UI renders each lecture as a time window plus date (e.g. `9–10 am · 03/10/2026`).
- `GET /student/feed` -> `{ posts: Post[], courses: { id, code, name, color }[] }`. Every notice and study material published to the student's enrolled courses, pinned first and newest first. Read-only; students cannot create, edit or delete posts.

## Integration and development

- Brand: Attendly. Monorepo `apps/api` and `apps/web`, independent npm package-lock.json files, no root workspaces required.
- API port 4000, web port 3000, PostgreSQL 5432 (database not published by Compose). Next.js runtime uses `API_INTERNAL_URL` to proxy `/api/*`; browser never needs API secrets.
- API environment: `DATABASE_URL`, `PORT=4000`, `NODE_ENV`, `WEB_ORIGIN=http://localhost:3000`, `CSRF_SECRET`, `COOKIE_SECURE=false`, optional `TRUST_PROXY=1` only behind the trusted frontend proxy. Validate secrets >=32 characters. Session TTL 7 days, auth rate limits, bounded input schemas, structured logging without credentials.
- API scripts: `dev`, `build`, `start`, `test`, `prisma:generate`, `db:migrate` (`prisma migrate deploy`), `db:seed` (explicit development demo only).
- Web scripts: `dev`, `build`, `start`, `typecheck`, `lint` if configured.
- Production deployment: `docker-compose.prod.yml` (own Compose project `attendly-prod`) runs the same two images behind Caddy, which owns TLS and the `Origin`-checked public origin. `scripts/deploy.sh` releases and self-rolls-back, `scripts/backup.sh` + `scripts/restore.sh` cover PostgreSQL, and `scripts/rollback.sh` repoints `RELEASE` at an earlier image tag. See `DEPLOYMENT.md`.
- Demo seed environment: `SEED_DEMO=true`, `DEMO_PASSWORD` required >=12 chars. Accounts `teacher@attendly.local`, `student@attendly.local`. No hard-coded passwords. Idempotent seed with real, historical enrollment, sessions and attendance plus a few classmates/courses. Seeding never runs automatically on production startup.
- Frontend uses Next App Router + TypeScript + Tailwind + shadcn-style Radix components and Lucide icons. Dark mode via next-themes. Attendance is marked manually by teachers; there is no QR code, camera scanning or student check-in. Poll metrics/roster every 10 seconds. Show loading, empty, validation and error states; no fake dashboard data or dead controls.
