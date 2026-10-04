"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Moon,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sun,
  Trash2,
  Upload,
  UserRound,
  Users,
  Video,
  X,
  ZoomIn,
} from "lucide-react";
type User = {
  id: string;
  name: string;
  email: string;
  role: "TEACHER" | "STUDENT";
  prn?: string | null;
  avatar?: string | null;
};
type Any = any;
// Product ownership. Attendly is created and managed by Tauheed Khan.
const CREATOR = {
  name: "Tauheed Khan",
  institute: "JNEC Aurangabad",
  email: "khantauheed759@gmail.com",
  role: "Creator & manager",
};
let csrfToken = "";
// Read a response defensively: proxies and rate limiters can answer with plain
// text or HTML, which must never surface as a raw JSON parse error.
async function readBody(r: Response) {
  const text = await r.text().catch(() => "");
  if (!text) return {} as Any;
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: {
        code: "BAD_RESPONSE",
        message:
          r.status === 429
            ? "Too many attempts. Please wait a few minutes and try again."
            : `The server returned an unexpected response (${r.status}).`,
      },
    };
  }
}
async function getCsrf() {
  const r = await fetch("/api/auth/csrf", {
    credentials: "include",
    cache: "no-store",
  });
  const d = await readBody(r);
  if (!r.ok || !d?.csrfToken)
    throw new Error(
      d?.error?.message || "Could not start a secure session. Please reload.",
    );
  csrfToken = d.csrfToken;
}
async function api(path: string, init: RequestInit = {}) {
  const method = init.method || "GET";
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes(method)) {
    if (!csrfToken) await getCsrf();
    headers.set("x-csrf-token", csrfToken);
  }
  const r = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const d = await readBody(r);
  if (!r.ok)
    throw new Error(
      d?.error?.message || `Request failed (${r.status})`,
    );
  return d;
}
const initials = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
// Renders the uploaded photo when there is one and falls back to a gradient
// initials badge otherwise, so a missing image never looks like a broken state.
function Avatar({
  user,
  size = 34,
  radius,
  busy,
}: {
  user: { name: string; avatar?: string | null };
  size?: number;
  radius?: number;
  busy?: boolean;
}) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size / 2.7)),
        ...(radius !== undefined
          ? { borderRadius: radius }
          : size >= 56
            ? { borderRadius: "50%" }
            : {}),
      }}
    >
      {user.avatar ? (
        // The photo is already a cropped data URL, so it needs no optimizer.
        <img src={user.avatar} alt="" />
      ) : (
        initials(user.name)
      )}
      {busy && (
        <span className="avatar-busy" role="status" aria-label="Uploading">
          <RefreshCw size={Math.max(11, Math.round(size / 3.2))} />
        </span>
      )}
    </span>
  );
}
// Tiny module-level toast bus. Any component can call toast("...") without
// threading state down the whole dashboard tree.
type Toast = { id: number; text: string; kind: "ok" | "error" };
let toastSeq = 0;
let toastListeners: ((t: Toast) => void)[] = [];
function toast(text: string, kind: "ok" | "error" = "ok") {
  const t = { id: ++toastSeq, text, kind };
  toastListeners.forEach((l) => l(t));
}
function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const listener = (t: Toast) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3400);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);
  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id}>
          {t.kind === "ok" ? <Check size={15} /> : <X size={15} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
function Logo() {
  return (
    <div className="brand">
      <div className="logo">
        <ClipboardCheck size={19} />
      </div>
      <span>Attendly</span>
    </div>
  );
}
function Auth({ onLogin }: { onLogin: (u: User) => void }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    prn: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const d = await api(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      onLogin(d.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div className="auth-stack">
      <div className="card auth-card">
        <div className="auth-brand">
          <Logo />
        </div>
        <div className="eyebrow">
          {register ? "Join the classroom" : "Welcome back"}
        </div>
        <h1>
          {register ? "Create your student account" : "Sign in to your space"}
        </h1>
        <p className="muted">
          {register
            ? "Track every class. Own your progress."
            : "Your classroom pulse, in one calm view."}
        </p>
        <form onSubmit={submit} style={{ marginTop: 25 }}>
          {register && (
            <div className="field">
              <label>Full name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Maya Sharma"
              />
            </div>
          )}
          <div className="field">
            <label>Email address</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@university.edu"
            />
          </div>
          {register && (
            <div className="field">
              <label>PRN number</label>
              <input
                required
                value={form.prn}
                onChange={(e) =>
                  setForm({ ...form, prn: e.target.value.toUpperCase() })
                }
                placeholder="2023CS001"
                maxLength={20}
              />
              <span className="hint">
                Your Permanent Registration Number. Teachers use it for roll
                call.
              </span>
            </div>
          )}
          <div className="field">
            <label>Password {register && <span>(12+ characters)</span>}</label>
            <input
              required
              type="password"
              minLength={register ? 12 : 1}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••••••"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button
            className="primary"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={busy}
          >
            {busy ? "Checking…" : register ? "Create account" : "Continue"}{" "}
            <ArrowUpRight size={16} />
          </button>
        </form>
        <div className="auth-switch">
          {register ? "Already have an account?" : "New to Attendly?"}{" "}
          <button
            className="link"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "Sign in" : "Create a student account"}
          </button>
        </div>
      </div>
        <div className="auth-credit">
          Attendly — created &amp; managed by <b>{CREATOR.name}</b>
          <br />
          {CREATOR.institute} ·{" "}
          <a href={`mailto:${CREATOR.email}`}>{CREATOR.email}</a>
        </div>
      </div>
    </main>
  );
}
function Sidebar({
  user,
  view,
  setView,
  logout,
  dark,
  setDark,
  openAvatar,
  openSettings,
}: {
  user: User;
  view: string;
  setView: (v: string) => void;
  logout: () => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  openAvatar: () => void;
  openSettings: () => void;
}) {
  const teacher = user.role === "TEACHER";
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // The popover closes on outside click and on Escape so it never traps the
  // keyboard user inside the sidebar.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  return (
    <aside className="sidebar">
      <Logo />
      <nav className="nav">
        <button
          className={view === "overview" ? "active" : ""}
          onClick={() => setView("overview")}
        >
          <LayoutDashboard size={18} />
          <span>Overview</span>
        </button>
        {!teacher && (
          <button
            className={
              view === "subjects" || view === "subject" ? "active" : ""
            }
            onClick={() => setView("subjects")}
          >
            <BookOpen size={18} />
            <span>My subjects</span>
          </button>
        )}
        {teacher && (
          <button
            className={view === "courses" ? "active" : ""}
            onClick={() => setView("courses")}
          >
            <BookOpen size={18} />
            <span>My courses</span>
          </button>
        )}
        {teacher && (
          <button
            className={view === "schedule" ? "active" : ""}
            onClick={() => setView("schedule")}
          >
            <CalendarPlus size={18} />
            <span>Schedule</span>
          </button>
        )}
        {teacher && (
          <button
            className={view === "attendance" ? "active" : ""}
            onClick={() => setView("attendance")}
          >
            <ClipboardCheck size={18} />
            <span>Mark attendance</span>
          </button>
        )}
        {teacher && (
          <button
            className={view === "analytics" ? "active" : ""}
            onClick={() => setView("analytics")}
          >
            <BarChart3 size={18} />
            <span>Live analytics</span>
          </button>
        )}
        <button
          className={view === "noticeboard" ? "active" : ""}
          onClick={() => setView("noticeboard")}
        >
          <Megaphone size={18} />
          <span>Noticeboard</span>
        </button>
        <button
          className={view === "history" ? "active" : ""}
          onClick={() => setView("history")}
        >
          <CalendarDays size={18} />
          <span>History</span>
        </button>
      </nav>
      <div className="sidebar-bottom" ref={wrap}>
        <div className="profile-wrap">
          {menu && (
            <div className="popover" role="menu" aria-label="Account menu">
              <div className="popover-head">
                <b>{user.name}</b>
                <span className="muted">{user.email}</span>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  openAvatar();
                }}
              >
                <UserRound size={16} />
                <span>View profile</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  openSettings();
                }}
              >
                <Settings size={16} />
                <span>Account settings</span>
              </button>
              <button role="menuitem" onClick={() => setDark(!dark)}>
                {dark ? <Sun size={16} /> : <Moon size={16} />}
                <span>Appearance</span>
                <span className="popover-tag">{dark ? "Dark" : "Light"}</span>
              </button>
              <div className="popover-sep" />
              <button
                role="menuitem"
                className="popover-danger"
                onClick={() => {
                  setMenu(false);
                  logout();
                }}
              >
                <LogOut size={16} />
                <span>Log out</span>
              </button>
            </div>
          )}
          <button
            className={`profile ${menu ? "open" : ""}`}
            onClick={() => setMenu((m) => !m)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label="Account menu"
            title={`${user.name} — account menu`}
          >
            <Avatar user={user} />
            <div className="grow">
              <div style={{ fontWeight: 700, fontSize: 12 }}>{user.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {teacher ? "Teacher" : user.prn ? `PRN ${user.prn}` : "Student"}
              </div>
            </div>
            <ChevronUp size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
function Top({
  user,
  title,
  subtitle,
  action,
}: {
  user: User;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="top">
      <div>
        <div className="eyebrow">
          {user.role === "TEACHER" ? "Faculty workspace" : "Student workspace"}
        </div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="actions">{action}</div>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  foot,
  color,
}: {
  icon: any;
  label: string;
  value: any;
  foot: string;
  color?: string;
}) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="metric-label">{label}</span>
        <Icon size={17} color={color || "var(--violet)"} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">
        <Activity size={13} />
        {foot}
      </div>
    </div>
  );
}
function Modal({
  children,
  close,
  title,
}: {
  children: React.ReactNode;
  close: () => void;
  title: string;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={close}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value.toLowerCase()}`}>
      {value === "UNMARKED"
        ? "Not marked"
        : value[0] + value.slice(1).toLowerCase()}
    </span>
  );
}
function Empty({
  title,
  body,
  button,
}: {
  title: string;
  body: string;
  button?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 5 }}>
        {title}
      </div>
      <div>{body}</div>
      {button && <div style={{ marginTop: 15 }}>{button}</div>}
    </div>
  );
}

function Teacher({
  user,
  view,
  setView,
}: {
  user: User;
  view: string;
  setView: (x: string) => void;
}) {
  const [data, setData] = useState<Any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [create, setCreate] = useState(false);
  const [live, setLive] = useState<Any>();
  const [session, setSession] = useState<Any>();
  const load = useCallback(async () => {
    try {
      setData(await api("/teacher/overview"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  if (loading) return <Loading />;
  if (error) return <ErrorState text={error} retry={load} />;
  const metrics = data.metrics;
  return (
    <>
      {view === "attendance" ? (
        <LiveSessions data={data} open={setLive} refresh={load} />
      ) : view === "history" ? (
        <TeacherHistory data={data} open={setSession} />
      ) : view === "schedule" ? (
        <Schedule data={data} refresh={load} />
      ) : view === "analytics" ? (
        <Analytics />
      ) : view === "noticeboard" ? (
        <TeacherNoticeboard courses={data.courses} />
      ) : view === "courses" ? (
        <CourseView
          data={data}
          create={() => setCreate(true)}
          open={setLive}
          refresh={load}
        />
      ) : (
        <>
          <Top
            user={user}
            title={`Good morning, ${user.name.split(" ")[0]}.`}
            subtitle="Here’s the signal from your classrooms today."
            action={
              <>
                <button className="ghost" onClick={load}>
                  <RefreshCw size={15} />
                  <span>Refresh</span>
                </button>
                <button className="primary" onClick={() => setCreate(true)}>
                  <Plus size={16} />
                  New course
                </button>
              </>
            }
          />
          <div className="grid metrics">
            <Metric
              icon={BookOpen}
              label="Total courses"
              value={metrics.totalCourses}
              foot="Active this term"
            />
            <Metric
              icon={Users}
              label="Enrolled students"
              value={metrics.totalStudents}
              foot="Across all courses"
              color="var(--teal)"
            />
            <Metric
              icon={Video}
              label="Sessions delivered"
              value={metrics.totalSessions}
              foot={`${metrics.activeSessions} live · ${metrics.scheduledSessions ?? 0} scheduled`}
              color="#e5a22b"
            />
            <Metric
              icon={Activity}
              label="Average attendance"
              value={`${metrics.averageAttendance}%`}
              foot="Across completed sessions"
            />
          </div>
          <div className="grid two">
            <Trend data={data.trend} />
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Your courses</h2>
                  <div className="muted">A snapshot of every room</div>
                </div>
                <button className="link" onClick={() => setView("courses")}>
                  View all
                </button>
              </div>
              <div className="course-list">
                {data.courses.slice(0, 4).map((c: Any) => (
                  <CourseRow
                    key={c.id}
                    c={c}
                    onClick={() => setView("courses")}
                  />
                ))}
              </div>
              {!data.courses.length && (
                <Empty
                  title="No courses yet"
                  body="Create your first course to start tracking attendance."
                />
              )}
            </div>
            <div className="card wide">
              <div className="card-head">
                <div>
                  <h2>Recent sessions</h2>
                  <div className="muted">Attendance at a glance</div>
                </div>
                <button className="iconbtn" onClick={() => setView("history")}>
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <SessionTable rows={data.recentSessions} open={setSession} />
            </div>
          </div>
        </>
      )}
      {create && (
        <CreateCourse
          close={() => setCreate(false)}
          done={() => {
            setCreate(false);
            load();
          }}
        />
      )}
      {live && (
        <LiveModal session={live} close={() => setLive(false)} refresh={load} />
      )}{" "}
      {session && <Roster session={session} close={() => setSession(false)} />}
    </>
  );
}
function Trend({ data }: { data: Any[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Attendance pulse</h2>
          <div className="muted">Last completed sessions</div>
        </div>
        <div className="pill">Live insight</div>
      </div>
      {data.length ? (
        <div className="chart">
          {data.map((x: Any, i) => (
            <div className="bar-wrap" key={i}>
              <div className="muted" style={{ fontSize: 10 }}>
                {x.rate}%
              </div>
              <div
                className="bar"
                style={{ height: `${Math.max(5, x.rate)}%` }}
              />
              <div className="bar-label">{x.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="No session data"
          body="Your trend will appear after your first completed session."
        />
      )}
    </div>
  );
}
function CourseRow({ c, onClick }: { c: Any; onClick: () => void }) {
  return (
    <button
      className="course-row"
      onClick={onClick}
      style={{
        textAlign: "left",
        background: "transparent",
        color: "inherit",
        width: "100%",
      }}
    >
      <div className="course-dot" style={{ background: c.color }} />
      <div className="grow">
        <div className="course-code">{c.code}</div>
        <div className="course-name">{c.name}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{c.studentCount}</div>
        <div className="muted" style={{ fontSize: 10 }}>
          students
        </div>
      </div>
      <ArrowUpRight size={15} color="var(--muted)" />
    </button>
  );
}
function SessionTable({ rows, open }: { rows: Any[]; open: (x: Any) => void }) {
  return rows.length ? (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Course</th>
            <th>Rate</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s: Any) => (
            <tr key={s.id}>
              <td>
                <b>{s.title}</b>
                <When start={s.startedAt} end={s.endsAt} />
              </td>
              <td>{s.courseCode}</td>
              <td>
                <b>{s.attendanceRate}%</b>{" "}
                <span className="muted">
                  ({s.presentCount}/{s.studentCount})
                </span>
              </td>
              <td>
                {s.isActive ? (
                  <Status value="LIVE" />
                ) : s.isScheduled ? (
                  <Status value="SCHEDULED" />
                ) : (
                  <Status value="COMPLETED" />
                )}
              </td>
              <td>
                <button className="smallbtn" onClick={() => open(s)}>
                  Roster
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="Nothing here yet"
      body="Completed sessions will show up in this table."
    />
  );
}
function CreateCourse({
  close,
  done,
}: {
  close: () => void;
  done: () => void;
}) {
  const [f, setF] = useState({ name: "", code: "", color: "#8b5cf6" });
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/courses", { method: "POST", body: JSON.stringify(f) });
      done();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Modal title="Create a course" close={close}>
      <p className="muted">
        Set up a course room and invite students with its secure join code.
      </p>
      <form onSubmit={save} style={{ marginTop: 18 }}>
        <div className="field">
          <label>Course name</label>
          <input
            required
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Advanced Web Engineering"
          />
        </div>
        <div className="field">
          <label>Course code</label>
          <input
            required
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
            placeholder="CS701"
          />
        </div>
        <div className="field">
          <label>Accent color</label>
          <input
            type="color"
            value={f.color}
            onChange={(e) => setF({ ...f, color: e.target.value })}
            style={{ height: 42 }}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary">Create course</button>
        </div>
      </form>
    </Modal>
  );
}
function CourseView({
  data,
  create,
  open,
  refresh,
}: {
  data: Any;
  create: () => void;
  open: (x: Any) => void;
  refresh: () => void;
}) {
  const [manage, setManage] = useState<Any>();
  return (
    <>
      <Top
        user={{ name: "", role: "TEACHER", id: "", email: "" }}
        title="Your courses"
        subtitle="Every course, roster, and live room in one place."
        action={
          <button className="primary" onClick={create}>
            <Plus size={16} />
            New course
          </button>
        }
      />
      <div className="grid two">
        {data.courses.map((c: Any) => (
          <div className="card" key={c.id}>
            <div className="card-head">
              <div style={{ display: "flex", gap: 12 }}>
                <div className="course-dot" style={{ background: c.color }} />
                <div>
                  <div className="course-code">{c.code}</div>
                  <h2>{c.name}</h2>
                </div>
              </div>
              <button
                className="iconbtn"
                onClick={() => navigator.clipboard?.writeText(c.joinCode)}
                title="Copy join code"
              >
                <Copy size={15} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, margin: "20px 0" }}>
              <div
                className="card"
                style={{ padding: 12, flex: 1, boxShadow: "none" }}
              >
                <div className="muted">Students</div>
                <b>{c.studentCount}</b>
              </div>
              <div
                className="card"
                style={{ padding: 12, flex: 1, boxShadow: "none" }}
              >
                <div className="muted">Sessions</div>
                <b>{c.sessionCount}</b>
              </div>
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Join code
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--bg)",
                padding: "9px 12px",
                borderRadius: 10,
                fontWeight: 800,
                letterSpacing: ".12em",
              }}
            >
              {c.joinCode}
              <button
                className="smallbtn"
                onClick={() => {
                  navigator.clipboard?.writeText(c.joinCode);
                }}
              >
                Copy
              </button>
            </div>
            <div
              style={{
                marginTop: 15,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                className="primary"
                onClick={() =>
                  open({
                    courseId: c.id,
                    courseName: c.name,
                    courseCode: c.code,
                    title: "Live class",
                  })
                }
              >
                <Video size={15} />
                Start live session
              </button>
              <button className="ghost" onClick={() => setManage(c)}>
                <Users size={15} />
                Manage students
              </button>
            </div>
          </div>
        ))}
        {!data.courses.length && (
          <div className="wide">
            <Empty
              title="Your first course starts here"
              body="Create a course and share its invite code with students."
              button={
                <button className="primary" onClick={create}>
                  <Plus size={15} />
                  Create course
                </button>
              }
            />
          </div>
        )}
      </div>
      {manage && (
        <RosterManager course={manage} close={() => setManage(undefined)} />
      )}
    </>
  );
}
function LiveSessions({
  data,
  open,
  refresh,
}: {
  data: Any;
  open: (x: Any) => void;
  refresh: () => void;
}) {
  return (
    <>
      <Top
        user={{ name: "", role: "TEACHER", id: "", email: "" }}
        title="Live sessions"
        subtitle="Create a class and make the final attendance decision for each student."
        action={
          <button
            className="primary"
            onClick={() =>
              data.courses[0] &&
              open({
                courseId: data.courses[0].id,
                courseName: data.courses[0].name,
                courseCode: data.courses[0].code,
                title: "Live class",
              })
            }
          >
            <Video size={15} />
            Start session
          </button>
        }
      />
      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Active classes</h2>
              <div className="muted">
                Only teachers can mark or change attendance.
              </div>
            </div>
            <button className="iconbtn" onClick={refresh}>
              <RefreshCw size={15} />
            </button>
          </div>
          {data.recentSessions.filter((s: Any) => s.isActive).length ? (
            <SessionTable
              rows={data.recentSessions.filter((s: Any) => s.isActive)}
              open={open}
            />
          ) : (
            <Empty
              title="No active session"
              body="Start a session when your class is ready."
            />
          )}
        </div>
        <div className="card">
          <div className="eyebrow">How it works</div>
          <h2 style={{ marginTop: 8 }}>Your classroom. Your decision.</h2>
          <div className="course-list" style={{ marginTop: 20 }}>
            {[
              ["01", "Create a class", "Choose the course and session title."],
              ["02", "Mark the roster", "Choose Present, Late, Absent, or Excused for every student."],
              [
                "03",
                "Review and close",
                "Every teacher decision is recorded with an audit reason.",
              ],
            ].map((x) => (
              <div className="course-row" key={x[0]}>
                <div className="avatar" style={{ background: "#7357f514" }}>
                  {x[0]}
                </div>
                <div>
                  <b style={{ fontSize: 13 }}>{x[1]}</b>
                  <div className="muted">{x[2]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
function LiveModal({
  session: initial,
  close,
  refresh,
}: {
  session: Any;
  close: () => void;
  refresh: () => void;
}) {
  const [s, setS] = useState(initial);
  const [form, setForm] = useState({
    title: initial.title || "Class attendance",
    durationMinutes: 60,
  });
  const [started, setStarted] = useState(!!initial.id);
  const [error, setError] = useState("");
  async function start(e: React.FormEvent) {
    e.preventDefault();
    try {
      const d = await api(`/courses/${initial.courseId}/sessions`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setS(d.session);
      setStarted(true);
    } catch (e: any) {
      setError(e.message);
    }
  }
  if (started) return <Roster session={s} close={() => { refresh(); close(); }} />;
  return (
    <Modal
      title="Create class attendance"
      close={close}
    >
      <div className="muted" style={{ marginBottom: 18 }}>
        {initial.courseCode} · {initial.courseName}
      </div>
      {(
        <form onSubmit={start}>
          <div className="field">
            <label>Session title</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Duration (minutes)</label>
            <input
              type="number"
              min={5}
              max={240}
              value={form.durationMinutes}
              onChange={(e) =>
                setForm({ ...form, durationMinutes: Number(e.target.value) })
              }
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="form-actions">
            <button className="primary">
              Open attendance roster <ArrowUpRight size={15} />
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
function RosterManager({ course, close }: { course: Any; close: () => void }) {
  const [rows, setRows] = useState<Any[]>([]);
  const [email, setEmail] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const d = await api(`/courses/${course.id}/students`);
      setRows(d.students);
    } catch (e: any) {
      setError(e.message);
    }
  }, [course.id]);
  useEffect(() => {
    load();
  }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/courses/${course.id}/students`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setEmail("");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(studentId: string) {
    if (!confirm("Remove this student from the course?")) return;
    try {
      await api(`/courses/${course.id}/students/${studentId}`, {
        method: "DELETE",
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const filtered = rows.filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      r.name.toLowerCase().includes(s) ||
      r.email.toLowerCase().includes(s) ||
      String(r.prn ?? "").toLowerCase().includes(s)
    );
  });
  return (
    <Modal title={`Students · ${course.code}`} close={close}>
      <p className="muted">
        Enroll a student directly with the email they registered with, or remove
        someone from this course.
      </p>
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="student@university.edu"
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={busy}>
          <Plus size={15} />
          Add
        </button>
      </form>
      {error && (
        <div className="error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      <div className="toolbar" style={{ marginTop: 16 }}>
        <input
          className="search"
          placeholder="Search by PRN, name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">{rows.length} enrolled</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>PRN</th>
              <th>Student</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.studentId}>
                <td>
                  <span className={`chip ${r.prn ? "" : "chip-missing"}`}>
                    {r.prn || "No PRN"}
                  </span>
                </td>
                <td>
                  <b>{r.name}</b>
                  <div className="muted">{r.email}</div>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="smallbtn"
                    onClick={() => remove(r.studentId)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No students enrolled yet.</div>}
        {rows.length > 0 && !filtered.length && (
          <div className="empty">No student matches “{q}”.</div>
        )}
      </div>
    </Modal>
  );
}
function Roster({ session, close }: { session: Any; close: () => void }) {
  const [d, setD] = useState<Any>();
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setD(await api(`/sessions/${session.id}/attendance`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [session.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  async function mark(studentId: string, status: string, reason?: string) {
    try {
      await api(`/sessions/${session.id}/attendance/${studentId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason }),
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function override(studentId: string, status: string) {
    if (!status) return;
    const reason = prompt(
      `Reason for marking this student ${status.toLowerCase()}?`,
      "Teacher override",
    );
    if (!reason) return;
    mark(studentId, status, reason);
  }
  async function bulk(status: string) {
    if (!confirm(`Mark every enrolled student as ${status.toLowerCase()}?`))
      return;
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/attendance/bulk`, {
        method: "POST",
        body: JSON.stringify({ status, reason: "Bulk teacher marking" }),
      });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function setOpen(active: boolean) {
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/${active ? "close" : "reopen"}`, {
        method: "POST",
        body: "{}",
      });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const records: Any[] = d?.records ?? [];
  const filtered = records.filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      r.name.toLowerCase().includes(s) ||
      r.email.toLowerCase().includes(s) ||
      String(r.prn ?? "").toLowerCase().includes(s)
    );
  });
  return (
    <Modal title="Attendance roster" close={close}>
      <div className="muted" style={{ marginBottom: 15 }}>
        {session.courseCode} · {session.title}
      </div>
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 15 }}
      >
        <button
          className="smallbtn"
          disabled={busy}
          onClick={() => bulk("PRESENT")}
        >
          <Check size={14} />
          Mark all present
        </button>
        <button
          className="smallbtn"
          disabled={busy}
          onClick={() => bulk("ABSENT")}
        >
          Mark all absent
        </button>
        {d?.session?.isActive ? (
          <button
            className="smallbtn"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            Close session
          </button>
        ) : (
          <button
            className="smallbtn"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Reopen session
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {d ? (
        <>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <input
              className="search"
              placeholder="Search by PRN, name or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="muted">{records.length} on the roster</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>PRN</th>
                  <th>Student</th>
                  <th>Status</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: Any) => (
                  <tr key={r.studentId}>
                    <td>
                      <span className={`chip ${r.prn ? "" : "chip-missing"}`}>
                        {r.prn || "No PRN"}
                      </span>
                    </td>
                    <td>
                      <div className="with-avatar">
                        <Avatar user={r} size={30} />
                        <div>
                          <b>{r.name}</b>
                          <div className="muted">{r.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Status value={r.status} />
                    </td>
                    <td>
                      <select
                        className="smallbtn"
                        value={r.status === "UNMARKED" ? "" : r.status}
                        onChange={(e) => override(r.studentId, e.target.value)}
                      >
                        <option value="">Change…</option>
                        <option value="PRESENT">Present</option>
                        <option value="LATE">Late</option>
                        <option value="ABSENT">Absent</option>
                        <option value="EXCUSED">Excused</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!records.length && (
              <div className="empty">No students enrolled in this course.</div>
            )}
            {records.length > 0 && !filtered.length && (
              <div className="empty">No student matches “{q}”.</div>
            )}
          </div>
        </>
      ) : (
        <div className="empty">Loading roster…</div>
      )}
    </Modal>
  );
}
function TeacherHistory({ data, open }: { data: Any; open: (x: Any) => void }) {
  return (
    <>
      <Top
        user={{ name: "", role: "TEACHER", id: "", email: "" }}
        title="Session history"
        subtitle="Review the record and correct it responsibly."
      />
      <div className="card">
        <SessionTable rows={data.recentSessions} open={open} />
      </div>
    </>
  );
}
function Student({
  user,
  view,
  setView,
  onProfile,
}: {
  user: User;
  view: string;
  setView: (x: string) => void;
  onProfile: () => void;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Any>();
  const [feed, setFeed] = useState<Any[]>([]);
  const [subject, setSubject] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [join, setJoin] = useState(false);
  const load = useCallback(async () => {
    try {
      const [o, f] = await Promise.all([
        api(`/student/overview?month=${month}`),
        api("/student/feed"),
      ]);
      setData(o);
      setFeed(f.posts);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [month]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  if (!data)
    return error ? <ErrorState text={error} retry={load} /> : <Loading />;
  if (view === "subjects")
    return (
      <StudentSubjects
        user={user}
        courses={data.courses}
        open={(c: Any) => {
          setSubject(c.id);
          setView("subject");
        }}
        onJoin={() => setJoin(true)}
      />
    );
  if (view === "subject" && subject)
    return (
      <SubjectDetail
        user={user}
        courseId={subject}
        back={() => setView("subjects")}
      />
    );
  if (view === "history")
    return (
      <>
        <Top
          user={user}
          title="Your history"
          subtitle="A clear record of every class you attended."
        />
        <div className="card">
          <History rows={data.recentAttendance} />
        </div>
      </>
    );
  if (view === "noticeboard")
    return (
      <>
        <Top
          user={user}
          title="Noticeboard"
          subtitle="Notices, announcements and study materials from your teachers."
        />
        <Feed posts={feed} />
      </>
    );
  return (
    <>
      <Top
        user={user}
        title={`Welcome back, ${user.name.split(" ")[0]}.`}
        subtitle="Small consistency compounds into remarkable progress."
        action={
          <>
            <button className="ghost" onClick={load}>
              <RefreshCw size={15} />
              <span>Refresh</span>
            </button>
            <button className="primary" onClick={() => setJoin(true)}>
              <Plus size={16} />
              Join course
            </button>
          </>
        }
      />
      {!user.prn && (
        <div className="card prn-prompt">
          <div className="actions">
            <div
              className="logo"
              style={{ background: "#f2b84b33", color: "#bb7a08" }}
            >
              <Pencil size={15} />
            </div>
            <div className="grow">
              <b>Add your PRN</b>
              <div className="muted">
                Your teacher uses your Permanent Registration Number for roll
                call. Add it once and it appears beside your name.
              </div>
            </div>
            <button className="primary" onClick={onProfile}>
              Add PRN
            </button>
          </div>
        </div>
      )}
      <div className="grid metrics">
        <Metric
          icon={Activity}
          label="Attendance rate"
          value={`${data.metrics.attendanceRate}%`}
          foot="Across completed classes"
        />
        <Metric
          icon={Check}
          label="Lectures completed"
          value={`${data.metrics.attendedSessions}/${data.metrics.totalSessions}`}
          foot={data.metrics.attendedSessions < data.metrics.totalSessions ? "Still behind" : "All in"}
          color="var(--teal)"
        />
        <Metric
          icon={Activity}
          label="Current streak"
          value={`${data.metrics.streak} ${data.metrics.streak === 1 ? "class" : "classes"}`}
          foot="Keep the momentum"
          color="#e5a22b"
        />
      </div>
      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Course progress</h2>
              <div className="muted">
                Tap a subject to see every lecture and your presence in it
              </div>
            </div>
          </div>
          <div className="course-list">
            {data.courses.map((c: Any) => (
              <StudentCourse
                c={c}
                key={c.id}
                onOpen={() => {
                  setSubject(c.id);
                  setView("subject");
                }}
              />
            ))}
          </div>
          {!data.courses.length && (
            <Empty
              title="No courses yet"
              body="Join a course with the code from your teacher."
              button={
                <button className="primary" onClick={() => setJoin(true)}>
                  <Plus size={15} />
                  Join course
                </button>
              }
            />
          )}
        </div>
        <Calendar data={data} month={month} setMonth={setMonth} />
        <div className="card wide">
          <div className="card-head">
            <div>
              <h2>Noticeboard</h2>
              <div className="muted">
                Latest notices and study materials from your teachers
              </div>
            </div>
            <button className="link" onClick={() => setView("noticeboard")}>
              View all
            </button>
          </div>
          <Feed posts={feed.slice(0, 3)} compact />
        </div>
        <div className="card wide">
          <div className="card-head">
            <div>
              <h2>Recent attendance</h2>
              <div className="muted">Your latest classroom activity</div>
            </div>
            <button className="link" onClick={() => {}}>
              View details
            </button>
          </div>
          <History rows={data.recentAttendance.slice(0, 6)} />
        </div>
      </div>
      {join && <Join close={() => setJoin(false)} done={load} />}
    </>
  );
}
function StudentCourse({ c, onOpen }: { c: Any; onOpen: () => void }) {
  return (
    <button
      className="course-row subject-open"
      onClick={onOpen}
      title="See every lecture for this subject"
    >
      <div
        className="ring"
        style={{ "--p": c.attendanceRate } as React.CSSProperties}
      >
        <div className="ring-inner">
          <div>
            <span className="ring-value">{c.attendanceRate}%</span>
            <span className="ring-label">attendance</span>
          </div>
        </div>
      </div>
      <div className="grow">
        <div className="course-code">{c.code}</div>
        <div className="course-name">{c.name}</div>
        <div className="muted" style={{ marginTop: 4 }}>
          {c.attendedSessions}/{c.totalSessions} lectures completed
        </div>
      </div>
      <ArrowUpRight size={15} color="var(--muted)" />
    </button>
  );
}
function Calendar({
  data,
  month,
  setMonth,
}: {
  data: Any;
  month: string;
  setMonth: (x: string) => void;
}) {
  const first = new Date(`${month}-01T00:00:00`);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const map = Object.fromEntries(
    (data.calendar || []).map((x: Any) => [x.date, x]),
  );
  const title = first.toLocaleDateString("en", {
    month: "long",
    year: "numeric",
  });
  const shift = (n: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Attendance calendar</h2>
          <div className="muted">{title}</div>
        </div>
        <div className="actions">
          <button className="iconbtn" onClick={() => shift(-1)}>
            <ChevronLeft size={15} />
          </button>
          <button className="iconbtn" onClick={() => shift(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="calendar">
        {["M", "T", "W", "T", "F", "S", "S"].map((x, i) => (
          <div
            key={i}
            className="muted"
            style={{ textAlign: "center", fontSize: 10 }}
          >
            {x}
          </div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={"e" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const n = i + 1;
          const date = `${month}-${String(n).padStart(2, "0")}`;
          const d = map[date];
          return (
            <div
              key={date}
              className={`day ${d?.status === "PRESENT" || d?.status === "LATE" ? "present-day" : ""} ${d?.status === "ABSENT" ? "absent-day" : ""}`}
            >
              <strong>{n}</strong>
              {d && (
                <>
                  <br />
                  <span
                    className={`day-dot ${d.status === "ABSENT" ? "absent" : "present"}`}
                  />
                  <span>
                    {d.status === "LATE"
                      ? "Late"
                      : d.status[0] + d.status.slice(1).toLowerCase()}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ marginTop: 14, fontSize: 11 }}>
        <span className="day-dot present" />
        Present / late{" "}
        <span className="day-dot absent" style={{ marginLeft: 13 }} />
        Absent
      </div>
    </div>
  );
}
function History({ rows }: { rows: Any[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Lecture</th>
            <th>Course</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: Any, i) => (
            <tr key={r.sessionId + i}>
              <td>
                <When start={r.date} end={r.endsAt ?? r.date} />
              </td>
              <td>
                <b>{r.title}</b>
              </td>
              <td>{r.courseCode}</td>
              <td>
                <Status value={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No attendance history"
      body="Your completed classes will appear here."
    />
  );
}
function Join({ close, done }: { close: () => void; done: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  async function go(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/courses/join", {
        method: "POST",
        body: JSON.stringify({ joinCode: code }),
      });
      done();
      close();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Modal title="Join a course" close={close}>
      <p className="muted">Ask your teacher for the course invite code.</p>
      <form onSubmit={go} style={{ marginTop: 18 }}>
        <div className="field">
          <label>Course code</label>
          <input
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CS701"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary">Join course</button>
        </div>
      </form>
    </Modal>
  );
}
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const clockParts = (value: string | Date) => {
  const d = new Date(value);
  const h24 = d.getHours();
  return {
    h: h24 % 12 === 0 ? 12 : h24 % 12,
    m: d.getMinutes(),
    mer: h24 >= 12 ? "pm" : "am",
  };
};
const clockLabel = (p: { h: number; m: number }) =>
  p.m === 0 ? `${p.h}` : `${p.h}:${String(p.m).padStart(2, "0")}`;
// Compact lecture window, e.g. "9–10 am" or "11:30 am–1 pm".
const fmtLectureTime = (start: string, end: string) => {
  const a = clockParts(start);
  const b = clockParts(end);
  return a.mer === b.mer
    ? `${clockLabel(a)}–${clockLabel(b)} ${a.mer}`
    : `${clockLabel(a)} ${a.mer}–${clockLabel(b)} ${b.mer}`;
};
// DD/MM/YYYY.
const fmtDMY = (value: string | Date) => {
  const d = new Date(value);
  return [d.getDate(), d.getMonth() + 1, d.getFullYear()]
    .map((n, i) => (i === 2 ? String(n) : String(n).padStart(2, "0")))
    .join("/");
};
function When({ start, end }: { start: string; end: string }) {
  return (
    <div className="when">
      <b>{fmtLectureTime(start, end)}</b>
      <span className="muted">{fmtDMY(start)}</span>
    </div>
  );
}
function TeacherNoticeboard({ courses }: { courses: Any[] }) {
  const [courseId, setCourseId] = useState<string>(courses[0]?.id || "");
  const [posts, setPosts] = useState<Any[]>([]);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState(false);
  const load = useCallback(async () => {
    if (!courseId) return;
    try {
      const d = await api(`/courses/${courseId}/posts`);
      setPosts(d.posts);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [courseId]);
  useEffect(() => {
    load();
  }, [load]);
  async function remove(id: string) {
    if (!confirm("Delete this post?")) return;
    try {
      await api(`/courses/${courseId}/posts/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function togglePin(p: Any) {
    try {
      await api(`/courses/${courseId}/posts/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !p.pinned }),
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const course = courses.find((c: Any) => c.id === courseId);
  return (
    <>
      <Top
        user={{ name: "", role: "TEACHER", id: "", email: "" }}
        title="Noticeboard"
        subtitle="Push notices and study materials to your students."
        action={
          <button
            className="primary"
            disabled={!courseId}
            onClick={() => setCompose(true)}
          >
            <Send size={15} />
            New post
          </button>
        }
      />
      <div className="card wide">
        <div className="card-head">
          <div>
            <h2>Posts by course</h2>
            <div className="muted">Only enrolled students see these.</div>
          </div>
          <select
            className="smallbtn"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            {courses.map((c: Any) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error">{error}</div>}
        {!courses.length ? (
          <Empty
            title="No courses yet"
            body="Create a course before posting to the noticeboard."
          />
        ) : (
          <div className="feed">
            {posts.map((p: Any) => (
              <article className="card post" key={p.id}>
                <div className="post-head">
                  <div className="actions">
                    <span
                      className={`pill ${p.kind === "MATERIAL" ? "material" : "notice"}`}
                    >
                      {p.kind === "MATERIAL" ? (
                        <>
                          <Paperclip size={12} /> Material
                        </>
                      ) : (
                        <>
                          <Bell size={12} /> Notice
                        </>
                      )}
                    </span>
                    {p.pinned && (
                      <span className="pill pinned">
                        <Pin size={12} /> Pinned
                      </span>
                    )}
                  </div>
                  <span className="muted">{fmtDate(p.createdAt)}</span>
                </div>
                <h3 className="post-title">{p.title}</h3>
                {p.body && <p className="muted post-body">{p.body}</p>}
                <div className="post-foot">
                  <span className="chip" style={{ borderColor: p.courseColor }}>
                    {p.courseCode}
                  </span>
                  {p.url && (
                    <a
                      className="smallbtn"
                      href={p.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <ExternalLink size={13} /> Link
                    </a>
                  )}
                  <span className="grow" />
                  <button className="smallbtn" onClick={() => togglePin(p)}>
                    <Pin size={13} /> {p.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="smallbtn danger"
                    onClick={() => remove(p.id)}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </article>
            ))}
            {!posts.length && (
              <Empty
                title="No posts yet"
                body="Publish a notice or study material for this course."
              />
            )}
          </div>
        )}
      </div>
      {compose && course && (
        <PostComposer
          course={course}
          close={() => setCompose(false)}
          done={() => {
            setCompose(false);
            load();
          }}
        />
      )}
    </>
  );
}
function PostComposer({
  course,
  close,
  done,
}: {
  course: Any;
  close: () => void;
  done: () => void;
}) {
  const [f, setF] = useState({
    kind: "NOTICE",
    title: "",
    body: "",
    url: "",
    pinned: false,
  });
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/courses/${course.id}/posts`, {
        method: "POST",
        body: JSON.stringify({
          kind: f.kind,
          title: f.title,
          body: f.body,
          url: f.url || undefined,
          pinned: f.pinned,
        }),
      });
      done();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Modal title={`New post · ${course.code}`} close={close}>
      <div className="seg">
        <button
          type="button"
          className={f.kind === "NOTICE" ? "active" : ""}
          onClick={() => setF({ ...f, kind: "NOTICE" })}
        >
          <Bell size={14} /> Notice
        </button>
        <button
          type="button"
          className={f.kind === "MATERIAL" ? "active" : ""}
          onClick={() => setF({ ...f, kind: "MATERIAL" })}
        >
          <Paperclip size={14} /> Study material
        </button>
      </div>
      <form onSubmit={save} style={{ marginTop: 16 }}>
        <div className="field">
          <label>Title</label>
          <input
            required
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder={
              f.kind === "MATERIAL" ? "Lecture 6 slides" : "Mid-term review"
            }
          />
        </div>
        <div className="field">
          <label>{f.kind === "MATERIAL" ? "Description" : "Message"}</label>
          <textarea
            required={f.kind === "NOTICE"}
            rows={4}
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
            placeholder="Write your announcement…"
          />
        </div>
        <div className="field">
          <label>
            {f.kind === "MATERIAL"
              ? "Download link (required)"
              : "Link (optional)"}
          </label>
          <input
            type="url"
            required={f.kind === "MATERIAL"}
            value={f.url}
            onChange={(e) => setF({ ...f, url: e.target.value })}
            placeholder="https://…"
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={f.pinned}
            onChange={(e) => setF({ ...f, pinned: e.target.checked })}
          />
          Pin to the top
        </label>
        {error && (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary">
            <Send size={15} /> Publish
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Feed({ posts, compact }: { posts: Any[]; compact?: boolean }) {
  if (!posts?.length)
    return (
      <Empty
        title="Nothing posted yet"
        body="Notices and study materials from your teachers will appear here."
      />
    );
  return (
    <div className="feed">
      {posts.map((p: Any) => (
        <article className="card post" key={p.id}>
          <div className="post-head">
            <div className="actions">
              <span
                className={`pill ${p.kind === "MATERIAL" ? "material" : "notice"}`}
              >
                {p.kind === "MATERIAL" ? (
                  <>
                    <Paperclip size={12} /> Material
                  </>
                ) : (
                  <>
                    <Bell size={12} /> Notice
                  </>
                )}
              </span>
              {p.pinned && (
                <span className="pill pinned">
                  <Pin size={12} /> Pinned
                </span>
              )}
            </div>
            <span className="muted">{fmtDate(p.createdAt)}</span>
          </div>
          <h3 className="post-title">{p.title}</h3>
          {p.body && (
            <p className={`muted post-body${compact ? " clamp" : ""}`}>
              {p.body}
            </p>
          )}
          <div className="post-foot">
            <span className="chip" style={{ borderColor: p.courseColor }}>
              {p.courseCode}
            </span>
            {!compact && <span className="muted">by {p.authorName}</span>}
            {p.url && (
              <a
                className="smallbtn"
                href={p.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Download size={13} />
                {p.kind === "MATERIAL" ? "Open material" : "Open link"}
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
function Schedule({ data, refresh }: { data: Any; refresh: () => void }) {
  const [compose, setCompose] = useState(false);
  const [edit, setEdit] = useState<Any>();
  const [open, setOpen] = useState<Any>();
  const [error, setError] = useState("");
  const upcoming: Any[] = data.upcomingSessions || [];
  async function remove(s: Any) {
    if (!confirm(`Delete "${s.title}"?`)) return;
    try {
      await api(`/sessions/${s.id}`, { method: "DELETE" });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function openNow(s: Any) {
    try {
      await api(`/sessions/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ startsAt: new Date().toISOString() }),
      });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <>
      <Top
        user={{ name: "", role: "TEACHER", id: "", email: "" }}
        title="Manual scheduler"
        subtitle="Create, schedule and manage upcoming lectures."
        action={
          <button className="primary" onClick={() => setCompose(true)}>
            <CalendarPlus size={16} />
            Schedule lecture
          </button>
        }
      />
      <div className="card wide">
        <div className="card-head">
          <div>
            <h2>Upcoming lectures</h2>
            <div className="muted">{upcoming.length} scheduled</div>
          </div>
          <button className="iconbtn" onClick={refresh}>
            <RefreshCw size={15} />
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {upcoming.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lecture</th>
                  <th>Course</th>
                  <th>Starts</th>
                  <th>Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {upcoming.map((s: Any) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.title}</b>
                      <div className="muted">{s.studentCount} students</div>
                    </td>
                    <td>{s.courseCode}</td>
                    <td>
                      <When start={s.startedAt} end={s.endsAt} />
                    </td>
                    <td>
                      {Math.round(
                        (new Date(s.endsAt).getTime() -
                          new Date(s.startedAt).getTime()) /
                          60000,
                      )}{" "}
                      min
                    </td>
                    <td>
                      <div className="actions">
                        <button className="smallbtn" onClick={() => openNow(s)}>
                          <Video size={13} /> Open now
                        </button>
                        <button className="smallbtn" onClick={() => setOpen(s)}>
                          <ClipboardCheck size={13} /> Roster
                        </button>
                        <button className="smallbtn" onClick={() => setEdit(s)}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          className="smallbtn danger"
                          onClick={() => remove(s)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No upcoming lectures"
            body="Schedule a lecture and it will appear here for your students."
            button={
              <button className="primary" onClick={() => setCompose(true)}>
                <CalendarPlus size={15} /> Schedule lecture
              </button>
            }
          />
        )}
      </div>
      {compose && (
        <ScheduleModal
          courses={data.courses}
          close={() => setCompose(false)}
          done={() => {
            setCompose(false);
            refresh();
          }}
        />
      )}
      {edit && (
        <ScheduleModal
          courses={data.courses}
          session={edit}
          close={() => setEdit(undefined)}
          done={() => {
            setEdit(undefined);
            refresh();
          }}
        />
      )}
      {open && (
        <Roster
          session={open}
          close={() => {
            setOpen(undefined);
            refresh();
          }}
        />
      )}
    </>
  );
}
function ScheduleModal({
  courses,
  session,
  close,
  done,
}: {
  courses: Any[];
  session?: Any;
  close: () => void;
  done: () => void;
}) {
  const start = session ? new Date(session.startedAt) : new Date(Date.now() + 864e5);
  const pad = (n: number) => String(n).padStart(2, "0");
  const [f, setF] = useState({
    courseId: session?.courseId || courses[0]?.id || "",
    title: session?.title || "Lecture",
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    durationMinutes: session
      ? Math.round(
          (new Date(session.endsAt).getTime() -
            new Date(session.startedAt).getTime()) /
            60000,
        )
      : 60,
  });
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const startsAt = new Date(`${f.date}T${f.time}`).toISOString();
    try {
      if (session) {
        await api(`/sessions/${session.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: f.title,
            startsAt,
            durationMinutes: f.durationMinutes,
          }),
        });
      } else {
        await api(`/courses/${f.courseId}/sessions`, {
          method: "POST",
          body: JSON.stringify({
            title: f.title,
            startsAt,
            durationMinutes: f.durationMinutes,
          }),
        });
      }
      done();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Modal
      title={session ? "Reschedule lecture" : "Schedule a lecture"}
      close={close}
    >
      <form onSubmit={save}>
        {!session && (
          <div className="field">
            <label>Course</label>
            <select
              value={f.courseId}
              onChange={(e) => setF({ ...f, courseId: e.target.value })}
            >
              {courses.map((c: Any) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Lecture title</label>
          <input
            required
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Date</label>
            <input
              required
              type="date"
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Start time</label>
            <input
              required
              type="time"
              value={f.time}
              onChange={(e) => setF({ ...f, time: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Minutes</label>
            <input
              required
              type="number"
              min={5}
              max={240}
              value={f.durationMinutes}
              onChange={(e) =>
                setF({ ...f, durationMinutes: Number(e.target.value) })
              }
            />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary">
            {session ? "Save changes" : "Schedule lecture"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Analytics() {
  const [d, setD] = useState<Any>();
  const [error, setError] = useState("");
  const [active, setActive] = useState<string>("");
  const load = useCallback(async () => {
    try {
      const r = await api("/teacher/analytics");
      setD(r);
      setActive((a) => a || r.subjects[0]?.courseId || "");
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  if (error) return <ErrorState text={error} retry={load} />;
  if (!d) return <Loading />;
  const subject =
    d.subjects.find((s: Any) => s.courseId === active) || d.subjects[0];
  return (
    <>
      <Top
        user={{ name: "", role: "TEACHER", id: "", email: "" }}
        title="Live analytics"
        subtitle="Attendance for every student, aggregated by subject."
        action={
          <button className="ghost" onClick={load}>
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
        }
      />
      {!d.subjects.length ? (
        <Empty
          title="No subjects yet"
          body="Create a course and mark attendance to build analytics."
        />
      ) : (
        <>
          <div className="tabs">
            {d.subjects.map((s: Any) => (
              <button
                key={s.courseId}
                className={s.courseId === active ? "active" : ""}
                onClick={() => setActive(s.courseId)}
              >
                <span
                  className="course-dot"
                  style={{
                    background: s.color,
                    height: 10,
                    width: 10,
                    borderRadius: 3,
                  }}
                />
                {s.courseCode}
                <b>{s.averageRate}%</b>
              </button>
            ))}
          </div>
          <div className="grid metrics">
            <Metric
              icon={Users}
              label="Students"
              value={subject.studentCount}
              foot={subject.courseName}
            />
            <Metric
              icon={Video}
              label="Lectures marked"
              value={subject.completedSessions}
              foot="Completed sessions"
              color="#e5a22b"
            />
            <Metric
              icon={BarChart3}
              label="Subject average"
              value={`${subject.averageRate}%`}
              foot="Across all students"
              color="var(--teal)"
            />
            <Metric
              icon={Activity}
              label="At risk"
              value={subject.students.filter((s: Any) => s.rate < 75).length}
              foot="Below 75% attendance"
              color="var(--danger)"
            />
          </div>
          <div className="card wide">
            <div className="card-head">
              <div>
                <h2>
                  {subject.courseCode} · {subject.courseName}
                </h2>
                <div className="muted">
                  Per-student attendance, lowest first
                </div>
              </div>
              <div className="pill">Live</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>PRN</th>
                    <th>Student</th>
                    <th>Present</th>
                    <th>Late</th>
                    <th>Absent</th>
                    <th>Excused</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {subject.students.map((s: Any) => (
                    <tr key={s.studentId}>
                      <td>
                        <span
                          className={`chip ${s.prn ? "" : "chip-missing"}`}
                        >
                          {s.prn || "No PRN"}
                        </span>
                      </td>
                      <td>
                        <div className="with-avatar">
                          <Avatar user={s} size={28} />
                          <div>
                            <b>{s.name}</b>
                            <div className="muted">{s.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{s.present}</td>
                      <td>{s.late}</td>
                      <td>{s.absent}</td>
                      <td>{s.excused}</td>
                      <td>
                        <div className="rate-cell">
                          <b>{s.rate}%</b>
                          <div className="meter">
                            <div
                              className="meter-fill"
                              style={{
                                width: `${Math.max(3, s.rate)}%`,
                                background:
                                  s.rate < 75 ? "var(--danger)" : undefined,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!subject.students.length && (
                <div className="empty">
                  No students enrolled in this subject.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
const CROP_VIEW = 240;
const CROP_OUT = 320;
// A dependency-free circular cropper: drag to reposition, slide to zoom, and the
// square behind the circle is what gets saved. Everything happens in a canvas,
// so a portrait photo can never be stretched into a square avatar.
function Cropper({
  src,
  saving,
  onCancel,
  onSave,
}: {
  src: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const img = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const base =
    nat.w && nat.h ? Math.max(CROP_VIEW / nat.w, CROP_VIEW / nat.h) : 1;
  const scale = base * zoom;
  const dw = nat.w * scale;
  const dh = nat.h * scale;
  // Offsets are clamped while reading, so zooming can never reveal empty space.
  const pos = {
    x: Math.min(0, Math.max(CROP_VIEW - dw, off.x)),
    y: Math.min(0, Math.max(CROP_VIEW - dh, off.y)),
  };
  function load(e: React.SyntheticEvent<HTMLImageElement>) {
    const n = {
      w: e.currentTarget.naturalWidth,
      h: e.currentTarget.naturalHeight,
    };
    const s = Math.max(CROP_VIEW / n.w, CROP_VIEW / n.h);
    setNat(n);
    setOff({ x: (CROP_VIEW - n.w * s) / 2, y: (CROP_VIEW - n.h * s) / 2 });
  }
  // Zooming keeps whatever sits under the centre of the circle in place, so a
  // centred face stays centred instead of drifting towards a corner.
  function zoomTo(z: number) {
    const next = base * z;
    const centre = CROP_VIEW / 2;
    setOff({
      x: centre - ((centre - pos.x) / scale) * next,
      y: centre - ((centre - pos.y) / scale) * next,
    });
    setZoom(z);
  }
  function start(e: React.PointerEvent<HTMLDivElement>) {
    // Capture keeps the drag alive outside the circle, but it can legitimately
    // fail (pen/touch edge cases), so a failed capture must not break dragging.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setOff({
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    });
  }
  function save() {
    const i = img.current;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (!i || !nat.w || !ctx) return;
    c.width = CROP_OUT;
    c.height = CROP_OUT;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Map the visible circle back to the source image, then redraw it at size.
    ctx.drawImage(
      i,
      -pos.x / scale,
      -pos.y / scale,
      CROP_VIEW / scale,
      CROP_VIEW / scale,
      0,
      0,
      CROP_OUT,
      CROP_OUT,
    );
    onSave(c.toDataURL("image/jpeg", 0.86));
  }
  return (
    <>
      <div
        className="crop-viewport"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          ref={img}
          src={src}
          alt=""
          draggable={false}
          onLoad={load}
          style={{
            width: dw || "auto",
            height: dh || "auto",
            transform: `translate(${pos.x}px, ${pos.y}px)`,
          }}
        />
      </div>
      <div className="crop-zoom">
        <ZoomIn size={15} />
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => zoomTo(Number(e.target.value))}
          aria-label="Zoom photo"
        />
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="ghost"
          disabled={saving}
          onClick={onCancel}
        >
          Back
        </button>
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? (
            <RefreshCw size={15} className="spin" />
          ) : (
            <Check size={15} />
          )}
          {saving ? "Saving…" : "Save photo"}
        </button>
      </div>
    </>
  );
}
function AvatarModal({
  user,
  close,
  done,
}: {
  user: User;
  close: () => void;
  done: (u: User) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const url = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  function pick(f?: File | null) {
    setError("");
    if (!f) return;
    if (!f.type.startsWith("image/"))
      return setError("Choose a PNG, JPEG or WebP image.");
    if (f.size > 8 * 1024 * 1024)
      return setError("That photo is larger than 8 MB. Pick a smaller one.");
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(f);
    setSrc(url.current);
  }
  async function upload(dataUrl: string | null) {
    setBusy(true);
    setError("");
    try {
      const d = await api("/profile", {
        method: "PATCH",
        body: JSON.stringify({ avatar: dataUrl }),
      });
      setSrc(null);
      done(d.user);
      toast(dataUrl ? "Profile updated successfully" : "Profile photo removed");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const openPicker = () => file.current?.click();
  if (src)
    return (
      <Modal title="Adjust your photo" close={close}>
        <div className="muted" style={{ marginBottom: 14 }}>
          Drag the photo to reposition it, then zoom until your face sits inside
          the circle.
        </div>
        <Cropper
          src={src}
          saving={busy}
          onCancel={() => setSrc(null)}
          onSave={upload}
        />
      </Modal>
    );
  return (
    <Modal title="Your profile" close={close}>
      <div className="avatar-editor">
        <button
          type="button"
          className="avatar-edit"
          onClick={openPicker}
          aria-label="Change profile photo"
          title="Change profile photo"
        >
          <Avatar user={user} size={92} busy={busy} />
          <span className="avatar-edit-badge">
            <Camera size={14} />
          </span>
        </button>
        <div className="grow">
          <b>{user.name}</b>
          <div className="muted">{user.email}</div>
          <div className="muted">
            {user.role === "TEACHER"
              ? "Teacher"
              : user.prn
                ? `PRN ${user.prn}`
                : "Student"}
          </div>
        </div>
      </div>
      <div
        className={`dropzone ${over ? "over" : ""} ${busy ? "busy" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Upload a profile photo"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        <ImagePlus size={20} />
        <div>
          <b>Drag &amp; drop a photo</b>
          <div className="muted">
            PNG, JPEG or WebP up to 8 MB · you can crop it before saving
          </div>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <div className="error">{error}</div>}
      <div className="form-actions">
        {user.avatar && (
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => upload(null)}
          >
            <Trash2 size={15} />
            Remove photo
          </button>
        )}
        <button type="button" className="ghost" disabled={busy} onClick={openPicker}>
          <Upload size={15} />
          Choose file
        </button>
        <button type="button" className="primary" onClick={close} disabled={busy}>
          Done
        </button>
      </div>
    </Modal>
  );
}
function AccountModal({
  user,
  close,
  done,
}: {
  user: User;
  close: () => void;
  done: (u: User) => void;
}) {
  const student = user.role === "STUDENT";
  const [name, setName] = useState(user.name);
  const [prn, setPrn] = useState(user.prn || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let u = user;
      if (name.trim() && name.trim() !== user.name)
        u = (
          await api("/profile", {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim() }),
          })
        ).user;
      if (student && prn && prn !== (user.prn || ""))
        u = (
          await api("/student/profile", {
            method: "PATCH",
            body: JSON.stringify({ prn }),
          })
        ).user;
      done(u);
      toast("Account settings saved");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Account settings" close={close}>
      <form onSubmit={save}>
        <div className="field">
          <label>Display name</label>
          <input
            autoFocus
            required
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="Maya Sharma"
          />
          <span className="hint">Shown across your workspace and to your classes.</span>
        </div>
        <div className="field">
          <label>Email address</label>
          <input value={user.email} readOnly disabled />
          <span className="hint">Your sign-in address cannot be changed here.</span>
        </div>
        {student && (
          <div className="field">
            <label>PRN number</label>
            <input
              required={!user.prn}
              value={prn}
              maxLength={20}
              onChange={(e) => setPrn(e.target.value.toUpperCase())}
              placeholder="2023CS001"
            />
            <span className="hint">
              Letters, numbers and dashes. Your teacher sees this while marking
              attendance.
            </span>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <RefreshCw size={15} className="spin" /> : <Check size={15} />}
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Footer({ onAbout }: { onAbout: () => void }) {
  return (
    <footer className="footer">
      <span>
        © {new Date().getFullYear()} {CREATOR.name} · {CREATOR.institute}. All
        rights reserved.
      </span>
      <button className="link" onClick={onAbout}>
        About &amp; credits
      </button>
    </footer>
  );
}
function AboutModal({ close }: { close: () => void }) {
  return (
    <Modal title="About & credits" close={close}>
      <div className="brand" style={{ marginBottom: 16 }}>
        <div className="logo">
          <ClipboardCheck size={19} />
        </div>
        <span>Attendly</span>
      </div>
      <p className="muted">
        A teacher-led student attendance platform. The design, development and
        ongoing management of this product are credited to:
      </p>
      <div className="credits">
        <div className="credit-row">
          <span className="muted">{CREATOR.role}</span>
          <b>{CREATOR.name}</b>
        </div>
        <div className="credit-row">
          <span className="muted">Institution</span>
          <b>{CREATOR.institute}</b>
        </div>
        <div className="credit-row">
          <span className="muted">Contact</span>
          <a href={`mailto:${CREATOR.email}`}>{CREATOR.email}</a>
        </div>
        <div className="credit-row">
          <span className="muted">Copyright</span>
          <b>
            © {new Date().getFullYear()} {CREATOR.name}
          </b>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        All rights reserved. Attendly, including its interface, source code and
        documentation, is the copyright of {CREATOR.name}. Unauthorised copying,
        redistribution or resale is not permitted.
      </p>
    </Modal>
  );
}
function LectureRow({ l }: { l: Any }) {
  return (
    <div className="lecture">
      <span className={`lecture-dot ${String(l.status).toLowerCase()}`} />
      <div className="grow">
        <b className="lecture-title">{l.title}</b>
        <When start={l.startedAt} end={l.endsAt} />
      </div>
      <Status value={l.status} />
    </div>
  );
}
function StudentSubjects({
  user,
  courses,
  open,
  onJoin,
}: {
  user: User;
  courses: Any[];
  open: (c: Any) => void;
  onJoin: () => void;
}) {
  return (
    <>
      <Top
        user={user}
        title="My subjects"
        subtitle="Open a subject to see every lecture and whether you were marked present."
      />
      {courses.length ? (
        <div className="grid two">
          {courses.map((c: Any) => (
            <button
              key={c.id}
              className="card subject-card"
              onClick={() => open(c)}
            >
              <div className="card-head" style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div className="course-dot" style={{ background: c.color }} />
                  <div>
                    <div className="course-code">{c.code}</div>
                    <div className="course-name">{c.name}</div>
                    <div className="muted">{c.teacherName}</div>
                  </div>
                </div>
                <ArrowUpRight size={16} color="var(--muted)" />
              </div>
              <div className="meters">
                <div className="meter">
                  <div
                    className="meter-fill"
                    style={{
                      width: `${Math.max(3, c.attendanceRate)}%`,
                      background:
                        c.attendanceRate < 75 ? "var(--danger)" : undefined,
                    }}
                  />
                </div>
                <b>{c.attendanceRate}%</b>
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {c.attendedSessions}/{c.totalSessions} lectures completed
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="No subjects yet"
          body="Join a course with the code from your teacher."
          button={
            <button className="primary" onClick={onJoin}>
              <Plus size={15} />
              Join course
            </button>
          }
        />
      )}
    </>
  );
}
function SubjectDetail({
  user,
  courseId,
  back,
}: {
  user: User;
  courseId: string;
  back: () => void;
}) {
  const [d, setD] = useState<Any>();
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const load = useCallback(async () => {
    try {
      setD(await api(`/student/courses/${courseId}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [courseId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  if (error)
    return (
      <>
        <Top
          user={user}
          title="Subject"
          subtitle="We could not load this subject."
        />
        <ErrorState text={error} retry={load} />
      </>
    );
  if (!d) return <Loading />;
  const { course, summary } = d;
  const lectures = (d.lectures ?? []).filter(
    (l: Any) => filter === "ALL" || l.status === filter,
  );
  return (
    <>
      <Top
        user={user}
        title={`${course.code} · ${course.name}`}
        subtitle={`Taught by ${course.teacherName}`}
        action={
          <button className="ghost" onClick={back}>
            <ChevronLeft size={15} />
            <span>My subjects</span>
          </button>
        }
      />
      <div className="grid metrics">
        <Metric
          icon={Activity}
          label="Attendance rate"
          value={`${summary.rate}%`}
          foot={`${summary.eligible} lectures counted`}
        />
        <Metric
          icon={Check}
          label="Present"
          value={summary.present}
          foot={`${summary.late} late`}
          color="var(--teal)"
        />
        <Metric
          icon={X}
          label="Absent"
          value={summary.absent}
          foot={`${summary.excused} excused`}
          color="var(--danger)"
        />
        <Metric
          icon={CalendarPlus}
          label="Upcoming"
          value={summary.upcoming}
          foot="Scheduled lectures"
          color="#e5a22b"
        />
      </div>
      {(d.active ?? []).length > 0 && (
        <div className="card prn-prompt">
          <div className="actions">
            <div
              className="logo"
              style={{ background: "#22bca71a", color: "#07977f" }}
            >
              <Clock3 size={15} />
            </div>
            <div className="grow">
              <b>Lecture in progress</b>
              <div className="muted">
                Your teacher is marking attendance for a lecture that is live
                right now.
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="card wide">
        <div className="card-head">
          <div>
            <h2>Lecture history</h2>
            <div className="muted">
              {course.name} · {summary.eligible} counted lectures
            </div>
          </div>
          <div className="filters">
            {["ALL", "PRESENT", "LATE", "ABSENT", "EXCUSED"].map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "ALL" ? "All" : f[0] + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        {lectures.length ? (
          <div className="lectures">
            {lectures.map((l: Any) => (
              <LectureRow key={l.sessionId} l={l} />
            ))}
          </div>
        ) : (
          <Empty
            title="Nothing to show"
            body={
              filter === "ALL"
                ? "Lectures appear here once your teacher marks them."
                : `No ${filter.toLowerCase()} lectures yet.`
            }
          />
        )}
        <div className="legend">
          {[
            ["present", "Present"],
            ["late", "Late"],
            ["absent", "Absent"],
            ["excused", "Excused"],
          ].map(([k, label]) => (
            <span key={k}>
              <i className={`lecture-dot ${k}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
      {(d.upcoming ?? []).length > 0 && (
        <div className="card wide" style={{ marginTop: 17 }}>
          <div className="card-head">
            <div>
              <h2>Upcoming lectures</h2>
              <div className="muted">Scheduled by {course.teacherName}</div>
            </div>
          </div>
          <div className="lectures">
            {d.upcoming.map((l: Any) => (
              <div className="lecture" key={l.sessionId}>
                <span className="lecture-dot scheduled" />
                <div className="grow">
                  <b className="lecture-title">{l.title}</b>
                  <When start={l.startedAt} end={l.endsAt} />
                </div>
                <span className="pill scheduled">Scheduled</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
function Loading() {
  return (
    <div
      className="card"
      style={{ marginTop: 50, textAlign: "center", padding: 60 }}
    >
      <RefreshCw
        className="spin"
        style={{ animation: "spin 1s linear infinite" }}
      />
      <div className="muted" style={{ marginTop: 12 }}>
        Loading your workspace…
      </div>
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
function ErrorState({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="card" style={{ marginTop: 50 }}>
      <div className="error">{text}</div>
      <button className="primary" onClick={retry}>
        <RefreshCw size={15} />
        Try again
      </button>
    </div>
  );
}
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("overview");
  const [avatarModal, setAvatarModal] = useState(false);
  const [settings, setSettings] = useState(false);
  const [about, setAbout] = useState(false);
  const [dark, setDark] = useState(false);
  // Appearance now lives in the account popover, so the choice is remembered
  // between visits. Reading and writing happen in separate effects to keep the
  // server-rendered markup and the first client render identical.
  useEffect(() => {
    if (localStorage.getItem("attendly_theme") === "dark") setDark(true);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("attendly_theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    getCsrf()
      .then(() =>
        api("/auth/me")
          .then((d) => setUser(d.user))
          .catch(() => {}),
      )
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    await api("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    setUser(null);
  }
  if (loading)
    return (
      <main className="auth">
        <div className="card" style={{ padding: 45 }}>
          <RefreshCw className="spin" />
        </div>
      </main>
    );
  if (!user) return <Auth onLogin={setUser} />;
  return (
    <div className="shell">
      <Sidebar
        user={user}
        view={view}
        setView={setView}
        logout={logout}
        dark={dark}
        setDark={setDark}
        openAvatar={() => setAvatarModal(true)}
        openSettings={() => setSettings(true)}
      />
      <main className="main">
        {user.role === "TEACHER" ? (
          <Teacher user={user} view={view} setView={setView} />
        ) : (
          <Student
            user={user}
            view={view}
            setView={setView}
            onProfile={() => setSettings(true)}
          />
        )}
        <Footer onAbout={() => setAbout(true)} />
      </main>
      {about && <AboutModal close={() => setAbout(false)} />}
      {avatarModal && (
        <AvatarModal user={user} close={() => setAvatarModal(false)} done={setUser} />
      )}
      {settings && (
        <AccountModal
          user={user}
          close={() => setSettings(false)}
          done={(u) => {
            setUser(u);
            setSettings(false);
          }}
        />
      )}
      <Toaster />
    </div>
  );
}
