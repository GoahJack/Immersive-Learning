import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Command,
  MaterialType,
  Schedule,
  Snapshot,
  StudyAPI,
  Task,
  TaskInput,
} from "../shared/types";
import "./style.css";
import { nextOccurrence } from "../shared/schedule";

declare global {
  interface Window {
    study: StudyAPI;
  }
}
type Page = "today" | "habits" | "plans" | "free" | "records" | "settings";
type TaskType = Schedule["type"];
const taskKinds = {
  weekly: {
    page: "habits",
    name: "每周习惯",
    create: "新建习惯",
    description: "每周固定练习，按选定星期和时间重复提醒。",
    empty: "还没有每周习惯",
    icon: "leaf",
  },
  once: {
    page: "plans",
    name: "日期计划",
    create: "新建日期计划",
    description: "为某一天安排学习，只在指定日期和时间提醒一次。",
    empty: "还没有日期计划",
    icon: "plan",
  },
  none: {
    page: "free",
    name: "自由学习",
    create: "新建自由学习",
    description: "不设提醒，想学时随时开始。",
    empty: "还没有自由学习内容",
    icon: "book",
  },
} as const;
const taskTypes: TaskType[] = ["weekly", "once", "none"];
type Modal =
  | { kind: "choose-task"; preset?: Partial<TaskInput> }
  | { kind: "task"; task?: Task; preset?: Partial<TaskInput> }
  | { kind: "start"; task: Task; reminderId?: string }
  | { kind: "end" }
  | { kind: "archive"; task: Task }
  | null;
type IconName =
  | "sun"
  | "plan"
  | "chart"
  | "settings"
  | "plus"
  | "play"
  | "pause"
  | "book"
  | "video"
  | "headphones"
  | "close"
  | "check"
  | "arrow"
  | "clock"
  | "leaf";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
      </>
    ),
    plan: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="3" />
        <path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h2m-7 3h2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 4v16h17M8 15v-4m5 4V7m5 8v-6" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1-2 3 2 3v4l3 1 2 3h4l2-3 3-1v-4l2-3-2-3-3-1-1-3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    play: <path d="m9 5 10 7-10 7Z" />,
    pause: <path d="M9 5v14M15 5v14" />,
    book: (
      <>
        <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10 9 5 3-5 3Z" />
      </>
    ),
    headphones: (
      <>
        <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
        <rect x="3" y="12" width="4" height="8" rx="2" />
        <rect x="17" y="12" width="4" height="8" rx="2" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 4C9 2 3 8 5 15c2 7 15 7 15-11Z" />
        <path d="M5 20 16 9" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const duration = (ms: number) =>
  ms < 60000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分钟`;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
function scheduleText(task: Task) {
  if (!task.enabled) return "已停用";
  if (task.schedule.type === "none") return "随时开始";
  if (task.schedule.type === "once")
    return new Date(task.schedule.at).toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `每周${[...task.schedule.days]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => weekNames[d])
    .join("、")} ${task.schedule.time}`;
}
function nextAt(task: Task, now: Date): number {
  return nextOccurrence(task, now)?.getTime() ?? Infinity;
}
const taskIcon = (task: Task): IconName =>
  /英语|听力/.test(task.category + task.name)
    ? "headphones"
    : task.materialType === "web"
      ? "video"
      : "book";
const taskTone = (task: Task) =>
  taskIcon(task) === "headphones"
    ? "teal"
    : taskIcon(task) === "video"
      ? "violet"
      : "blue";

function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-btn" aria-label="关闭对话框" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function TaskForm({
  task,
  preset,
  onSave,
  pickFile,
  onClose,
  busy,
}: {
  task?: Task;
  preset?: Partial<TaskInput>;
  onSave: (value: TaskInput) => Promise<void>;
  pickFile: () => Promise<string | null>;
  onClose: () => void;
  busy: boolean;
}) {
  const [v, set] = useState<TaskInput>(
    task || {
      name: "",
      category: "",
      materialType: "paper",
      material: "",
      goal: "",
      minutes: 25,
      enabled: true,
      schedule: { type: "none" },
      ...preset,
    },
  );
  const [error, setError] = useState("");
  const update = (patch: Partial<TaskInput>) =>
    set((prev) => ({ ...prev, ...patch }));
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? `${dayKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      : "";
  };
  const kind = taskKinds[v.schedule.type];
  return (
    <ModalFrame
      title={task ? `编辑${kind.name}` : kind.create}
      subtitle={kind.description}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onSave(v);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          任务名称
          <input
            autoFocus
            required
            maxLength={200}
            placeholder="例如：高数 · 极限与连续"
            value={v.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            学习分类
            <input
              placeholder="例如：数学、算法、英语"
              value={v.category}
              onChange={(e) => update({ category: e.target.value })}
            />
          </label>
          <label>
            计划时长（分钟）
            <input
              type="number"
              min="1"
              max="240"
              required
              value={v.minutes}
              onChange={(e) => update({ minutes: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          本次目标
          <input
            placeholder="例如：阅读第 32—36 页，完成两道例题"
            value={v.goal}
            onChange={(e) => update({ goal: e.target.value })}
          />
        </label>
        <label>
          学习材料
          <select
            value={v.materialType}
            onChange={(e) =>
              update({
                materialType: e.target.value as MaterialType,
                material: "",
              })
            }
          >
            <option value="paper">纸质课本</option>
            <option value="web">网页 / B 站链接</option>
            <option value="file">本地文件</option>
            <option value="other">其他</option>
          </select>
        </label>
        {v.materialType === "file" ? (
          <div className="file-picker">
            <span>{v.material || "还未选择文件"}</span>
            <button
              type="button"
              onClick={async () => {
                const file = await pickFile();
                if (file) update({ material: file });
              }}
            >
              选择文件
            </button>
          </div>
        ) : (
          <label>
            {v.materialType === "web" ? "网页链接" : "材料说明"}
            <input
              type={v.materialType === "web" ? "url" : "text"}
              required={v.materialType === "web"}
              placeholder={
                v.materialType === "web"
                  ? "https://www.bilibili.com/video/…"
                  : "书名、页码或练习内容（可选）"
              }
              value={v.material}
              onChange={(e) => update({ material: e.target.value })}
            />
          </label>
        )}
        {v.schedule.type !== "none" && (
          <p className="schedule-hint">
            到点会用灵动岛提醒，关闭主窗口也能收到。按电脑本地时间执行。
          </p>
        )}
        {v.schedule.type === "once" && (
          <label>
            学习日期与时间
            <input
              type="datetime-local"
              required
              value={toLocal(v.schedule.at)}
              onChange={(e) => {
                const d = new Date(e.target.value);
                if (Number.isFinite(d.getTime()))
                  update({ schedule: { type: "once", at: d.toISOString() } });
              }}
            />
          </label>
        )}
        {v.schedule.type === "weekly" && (
          <>
            <div className="week-picker" role="group" aria-label="重复星期">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={
                    v.schedule.type === "weekly" &&
                    v.schedule.days.includes(day)
                  }
                  onClick={() => {
                    if (v.schedule.type === "weekly")
                      update({
                        schedule: {
                          ...v.schedule,
                          days: v.schedule.days.includes(day)
                            ? v.schedule.days.filter((d) => d !== day)
                            : [...v.schedule.days, day],
                        },
                      });
                  }}
                >
                  {weekNames[day]}
                </button>
              ))}
            </div>
            <label>
              每周学习时间
              <input
                type="time"
                required
                value={v.schedule.time}
                onChange={(e) => {
                  if (v.schedule.type === "weekly")
                    update({
                      schedule: { ...v.schedule, time: e.target.value },
                    });
                }}
              />
            </label>
          </>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          启用这项任务
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy ? "正在保存…" : "保存任务"}
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>("today");
  const [modal, setModal] = useState<Modal>(null);
  const [filter, setFilter] = useState("全部");
  const [progress, setProgress] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [startMinutes, setStartMinutes] = useState(25);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!window.study) {
      setError("请从桌面应用打开，浏览器预览不包含托盘与本地数据服务。");
      return;
    }
    const off = window.study.subscribe(setSnapshot);
    window.study
      .snapshot()
      .then(setSnapshot)
      .catch((e) => setError(String(e)));
    const offFinish = window.study.onFinish(() => {
      setPage("today");
      setProgress("");
      setNextStep("");
      setModal({ kind: "end" });
    });
    const offUpdate = window.study.onUpdateSettings(() => setPage("settings"));
    return () => {
      off();
      offFinish();
      offUpdate();
    };
  }, []);
  const run = async (command: Command, throwError = false) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.study.command(command);
      if (!result.ok) throw Error(result.error);
      return true;
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      if (throwError) throw e;
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const openStart = (task: Task, reminderId?: string) => {
    setStartMinutes(task.minutes);
    setModal({ kind: "start", task, reminderId });
  };
  const openEnd = () => {
    setProgress("");
    setNextStep("");
    setModal({ kind: "end" });
  };
  const createTask = (type: TaskType, preset?: Partial<TaskInput>) => {
    const schedule: Schedule =
      type === "weekly"
        ? { type, days: [new Date().getDay()], time: "20:00" }
        : type === "once"
          ? { type, at: new Date(Date.now() + 3600000).toISOString() }
          : { type };
    setModal({ kind: "task", preset: { ...preset, schedule } });
  };
  if (!snapshot)
    return (
      <div className="loading">
        <Icon name="leaf" size={36} />
        <h1>沉浸学习</h1>
        <p role={error ? "alert" : undefined}>
          {error || "正在读取你的学习安排…"}
        </p>
      </div>
    );
  const s = snapshot;
  const now = new Date(s.now);
  const today = dayKey(now);
  const active = s.active;
  const tasks = s.tasks.filter((t) => !t.archived);
  const pageType = taskTypes.find((type) => taskKinds[type].page === page);
  const pageTasks = tasks.filter((t) => t.schedule.type === pageType);
  const available = tasks.filter((t) => t.enabled);
  const pending = s.reminders.filter(
    (r) =>
      ["pending", "snoozed"].includes(r.status) &&
      tasks.some((t) => t.id === r.taskId && t.enabled),
  );
  const ordered = [...available].sort((a, b) => {
    const pa = pending.some((r) => r.taskId === a.id) ? 0 : 1;
    const pb = pending.some((r) => r.taskId === b.id) ? 0 : 1;
    return pa - pb || nextAt(a, now) - nextAt(b, now);
  });
  const datedPlans = available
    .filter(
      (t) =>
        t.schedule.type === "once" &&
        t.id !== active?.taskId &&
        (Date.parse(t.schedule.at) > now.getTime() ||
          pending.some((r) => r.taskId === t.id)),
    )
    .sort((a, b) => {
      const ra = pending.find((r) => r.taskId === a.id);
      const rb = pending.find((r) => r.taskId === b.id);
      const at =
        a.schedule.type === "once" ? Date.parse(a.schedule.at) : Infinity;
      const bt =
        b.schedule.type === "once" ? Date.parse(b.schedule.at) : Infinity;
      return (
        Number(!ra) - Number(!rb) ||
        (ra ? Date.parse(ra.dueAt) : at) - (rb ? Date.parse(rb.dueAt) : bt)
      );
    });
  const otherTasks = ordered.filter((t) => t.schedule.type !== "once");
  const nextTask = otherTasks.find((t) => t.id !== active?.taskId);
  const todayMs = s.sessions.reduce((a, x) => a + (x.dailyMs[today] || 0), 0);
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const key = dayKey(d);
    return {
      key,
      label: weekNames[d.getDay()],
      ms: s.sessions.reduce((a, x) => a + (x.dailyMs[key] || 0), 0),
    };
  });
  const weekMs = days.reduce((a, x) => a + x.ms, 0);
  const filteredSessions = s.sessions.filter(
    (x) => filter === "全部" || x.category === filter,
  );
  const recordTodayMs = filteredSessions.reduce(
    (a, x) => a + (x.dailyMs[today] || 0),
    0,
  );
  const recordWeekMs = filteredSessions.reduce(
    (a, x) => a + days.reduce((b, d) => b + (x.dailyMs[d.key] || 0), 0),
    0,
  );
  const maximum = Math.max(1800000, ...days.map((d) => d.ms));
  const pageName: Record<Page, string> = {
    today: "今天",
    habits: "每周习惯",
    plans: "日期计划",
    free: "自由学习",
    records: "学习记录",
    settings: "设置",
  };
  function TaskRow({ task }: { task: Task }) {
    const reminder = pending.find((r) => r.taskId === task.id);
    return (
      <article className={`task-row ${!task.enabled ? "disabled-task" : ""}`}>
        <span className={`material-icon ${taskTone(task)}`}>
          <Icon name={taskIcon(task)} />
        </span>
        <div className="task-info">
          <h3>{task.name}</h3>
          <p>{task.goal || task.material || "从一个小目标开始"}</p>
          <div className="task-meta">
            <span className={`task-kind kind-${task.schedule.type}`}>
              {taskKinds[task.schedule.type].name}
            </span>
            <span>{task.category}</span>
            <span>
              <Icon name="clock" size={13} />
              {task.minutes} 分钟
            </span>
            <span className={reminder ? "pending-text" : ""}>
              {reminder
                ? reminder.status === "snoozed"
                  ? `稍后 ${new Date(reminder.dueAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
                  : "待开始"
                : scheduleText(task)}
            </span>
          </div>
        </div>
        <div className="row-actions">
          {pageType && (
            <>
              <button
                className="text-btn"
                onClick={() => setModal({ kind: "task", task })}
              >
                编辑
              </button>
              <button
                className="text-btn muted"
                onClick={() => setModal({ kind: "archive", task })}
              >
                归档
              </button>
            </>
          )}
          <button
            disabled={busy || !task.enabled || !!active}
            onClick={() => openStart(task, reminder?.id)}
          >
            <Icon name="play" size={14} />
            开始
          </button>
        </div>
      </article>
    );
  }
  const planAgenda = (
    <section
      className={`plan-agenda ${active ? "after-focus" : ""}`}
      aria-label="日期计划"
    >
      <div className="agenda-heading">
        <div>
          <h2>
            日期计划{" "}
            <span>
              {datedPlans.length
                ? `${datedPlans.length} 项学习安排`
                : "为某一天留出学习时间"}
            </span>
          </h2>
          <p>
            {active
              ? "当前学习结束后，可以接着下一项安排。"
              : "先看看接下来要学什么。"}
          </p>
        </div>
        <div className="agenda-actions">
          <button className="text-btn" onClick={() => setPage("plans")}>
            全部日期计划 <Icon name="arrow" size={15} />
          </button>
          <button onClick={() => createTask("once")}>
            <Icon name="plus" size={15} />
            新建日期计划
          </button>
        </div>
      </div>
      {datedPlans.length ? (
        <div className="agenda-list">
          {datedPlans.slice(0, 3).map((task) => {
            const at = new Date(
              task.schedule.type === "once" ? task.schedule.at : "",
            );
            const reminder = pending.find((r) => r.taskId === task.id);
            const due = reminder && Date.parse(reminder.dueAt) <= now.getTime();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const label =
              dayKey(at) === today
                ? "今天"
                : dayKey(at) === dayKey(tomorrow)
                  ? "明天"
                  : at.toLocaleDateString("zh-CN", { weekday: "long" });
            const time = at.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });
            return (
              <article
                key={task.id}
                className={`agenda-row ${due ? "is-due" : ""}`}
              >
                <div
                  className="agenda-date"
                  aria-label={at.toLocaleDateString("zh-CN")}
                >
                  <span>
                    {at.getFullYear() !== now.getFullYear()
                      ? `${at.getFullYear()}年`
                      : ""}
                    {at.getMonth() + 1}月
                  </span>
                  <strong>{String(at.getDate()).padStart(2, "0")}</strong>
                </div>
                <div className="agenda-details">
                  <div className="agenda-time">
                    <time dateTime={at.toISOString()}>
                      {label} {time}
                    </time>
                    {reminder && (
                      <span className={due ? "due-label" : "snooze-label"}>
                        {due
                          ? "待开始"
                          : `稍后 ${new Date(reminder.dueAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`}
                      </span>
                    )}
                  </div>
                  <h3>{task.name}</h3>
                  <p>
                    {task.goal || task.material || task.category}
                    <span>{task.minutes} 分钟</span>
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={busy || !!active}
                  aria-label={`开始学习：${task.name}`}
                  onClick={() => openStart(task, reminder?.id)}
                >
                  <Icon name="play" size={15} />
                  开始学习
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="agenda-empty">
          <Icon name="plan" size={25} />
          <p>还没有待开始的日期计划。为下一次课本、课程或听力学习定个时间。</p>
        </div>
      )}
      {datedPlans.length > 3 && (
        <button
          className="agenda-more text-btn"
          onClick={() => setPage("plans")}
        >
          查看其余 {datedPlans.length - 3} 项日期计划{" "}
          <Icon name="arrow" size={15} />
        </button>
      )}
    </section>
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="leaf" size={23} />
          </span>
          <div>
            沉浸学习<small>留一点时间，给自己</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {(
            [
              ["today", "sun"],
              ["habits", "leaf"],
              ["plans", "plan"],
              ["free", "book"],
              ["records", "chart"],
              ["settings", "settings"],
            ] as [Page, IconName][]
          ).map(([id, icon]) => (
            <button
              key={id}
              className={page === id ? "nav-item selected" : "nav-item"}
              aria-label={pageName[id]}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon name={icon} />
              {pageName[id]}
              {taskTypes.some((type) => taskKinds[type].page === id) && (
                <span>
                  {
                    tasks.filter((t) => taskKinds[t.schedule.type].page === id)
                      .length
                  }
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span
            className={`status-dot ${active?.state === "running" ? "on" : ""}`}
          />
          <span>
            {active
              ? active.state === "running"
                ? "正在专注"
                : "学习已暂停"
              : "随时可以开始"}
          </span>
          <p>
            关掉窗口，提醒依然在。
            <br />
            学习时，让桌面安静下来。
          </p>
          <button
            className="text-btn"
            onClick={() => void run({ type: "window.hide" })}
          >
            收起到托盘 <Icon name="arrow" size={14} />
          </button>
        </div>
      </aside>
      <main className="workspace">
        <div className="page-content" key={page}>
          <header className="page-header">
            <div>
              <p className="date-label">
                {now.toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </p>
              <h1>{pageName[page]}</h1>
            </div>
            {page !== "settings" && (
              <button
                className="primary"
                onClick={() =>
                  pageType
                    ? createTask(pageType)
                    : setModal({ kind: "choose-task" })
                }
              >
                <Icon name="plus" size={17} />
                {pageType ? taskKinds[pageType].create : "新建任务"}
              </button>
            )}
          </header>
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {s.saveError && (
            <div className="banner error" role="alert">
              <span>{s.saveError}</span>
              <button
                disabled={busy}
                onClick={() => void run({ type: "store.retry" })}
              >
                重试保存
              </button>
            </div>
          )}
          {s.notice && (
            <div className="banner">
              <span>{s.notice}</span>
              {s.update?.status === "ready" && page !== "settings" && (
                <button onClick={() => setPage("settings")}>查看更新</button>
              )}
              <button
                aria-label="关闭提示"
                onClick={() => void run({ type: "notice.dismiss" })}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {page === "today" && (
            <>
              {!active && planAgenda}
              {(active || nextTask || !available.length) && (
                <div className="today-grid">
                  <section
                    className={`focus-panel ${active ? "is-active" : ""}`}
                  >
                    {active ? (
                      <>
                        <div className="focus-top">
                          <span className="pill">
                            <span
                              className={`status-dot ${active.state === "running" ? "on" : ""}`}
                            />
                            {active.state === "running"
                              ? "专注进行中"
                              : active.elapsedMs >= active.targetMs
                                ? "本段已完成"
                                : "已暂停，按自己的节奏来"}
                          </span>
                          <button
                            className="text-btn"
                            onClick={() => void run({ type: "window.hide" })}
                          >
                            收起窗口 <Icon name="arrow" size={15} />
                          </button>
                        </div>
                        <h2>{active.taskName}</h2>
                        <p className="focus-description">
                          {s.tasks.find((t) => t.id === active.taskId)?.goal ||
                            "此刻，只做这一件事。"}
                        </p>
                        <div
                          className="timer"
                          aria-label={`剩余时间 ${clock(active.targetMs - active.elapsedMs)}`}
                        >
                          {clock(active.targetMs - active.elapsedMs)}
                          <span>剩余时间</span>
                        </div>
                        <div className="progress-track">
                          <span
                            style={{
                              width: `${Math.min(100, (active.elapsedMs / active.targetMs) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="focus-footer">
                          <span>
                            已专注 {duration(active.elapsedMs)}
                            <br />
                            <small>暂停 {duration(active.pausedMs)}</small>
                          </span>
                          <div>
                            {active.elapsedMs >= active.targetMs ? (
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  void run({
                                    type: "session.extend",
                                    id: active.id,
                                  })
                                }
                              >
                                继续 10 分钟
                              </button>
                            ) : (
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  void run({
                                    type:
                                      active.state === "running"
                                        ? "session.pause"
                                        : "session.resume",
                                    id: active.id,
                                  })
                                }
                              >
                                <Icon
                                  name={
                                    active.state === "running"
                                      ? "pause"
                                      : "play"
                                  }
                                  size={16}
                                />
                                {active.state === "running"
                                  ? "暂停"
                                  : "继续学习"}
                              </button>
                            )}
                            <button onClick={openEnd}>结束并记录</button>
                          </div>
                        </div>
                      </>
                    ) : nextTask ? (
                      <>
                        <div className="focus-top">
                          <span className="pill">接下来，专注这一件事</span>
                          <span className="quiet-label">
                            {nextTask.minutes} 分钟
                          </span>
                        </div>
                        <span
                          className={`large-material ${taskTone(nextTask)}`}
                        >
                          <Icon name={taskIcon(nextTask)} size={30} />
                        </span>
                        <h2>{nextTask.name}</h2>
                        <p className="focus-description">
                          {nextTask.goal ||
                            nextTask.material ||
                            "不必等到状态完美，先开始一小步。"}
                        </p>
                        {(nextTask.progress || nextTask.nextStep) && (
                          <div className="resume-note">
                            <span>接着上次</span>
                            <p>{nextTask.nextStep || nextTask.progress}</p>
                          </div>
                        )}
                        <div className="focus-footer">
                          <span>{scheduleText(nextTask)}</span>
                          <div>
                            <button
                              className="primary"
                              onClick={() =>
                                openStart(
                                  nextTask,
                                  pending.find((r) => r.taskId === nextTask.id)
                                    ?.id,
                                )
                              }
                            >
                              <Icon name="play" size={16} />
                              开始学习
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run({
                                  type: "session.start",
                                  taskId: nextTask.id,
                                  minutes: 5,
                                  reminderId: pending.find(
                                    (r) => r.taskId === nextTask.id,
                                  )?.id,
                                })
                              }
                            >
                              先学 5 分钟
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="focus-top">
                          <span className="pill">给学习留一个位置</span>
                          <Icon name="book" size={24} />
                        </div>
                        <h2 className="welcome-title">从一件想学的事开始。</h2>
                        <p className="focus-description">
                          一本课本、一节教程，或一段听力。
                          <br />
                          定下小目标，剩下的交给这段时间。
                        </p>
                        <button
                          className="primary welcome-action"
                          onClick={() => setModal({ kind: "choose-task" })}
                        >
                          <Icon name="plus" size={17} />
                          安排第一项学习
                        </button>
                        <p className="welcome-note">
                          纸质书也可以，学习不必都在屏幕里。
                        </p>
                      </>
                    )}
                  </section>
                  <section className="week-panel">
                    <div className="section-heading">
                      <h2>这一周的投入</h2>
                      <Icon name="chart" size={18} />
                    </div>
                    <div className="week-total">
                      {Math.floor(weekMs / 60000)}
                      <span>分钟</span>
                    </div>
                    <p>每一小段，都算数。</p>
                    <div className="week-chart" aria-label="本周每日专注时长">
                      {days.map((d) => (
                        <div
                          className={`day-column ${d.key === today ? "is-today" : ""}`}
                          key={d.key}
                          title={`${d.key}：${duration(d.ms)}`}
                        >
                          <div className="bar-area">
                            <div
                              style={{
                                height: `${Math.max(d.ms > 0 ? 4 : 0, (d.ms / maximum) * 100)}%`,
                              }}
                            />
                          </div>
                          <span>{d.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="today-total">
                      <span>今天已专注</span>
                      <strong>{duration(todayMs)}</strong>
                    </div>
                  </section>
                </div>
              )}
              {active && planAgenda}
              {!active && !nextTask && available.length > 0 && (
                <section className="study-summary" aria-label="学习概况">
                  <div>
                    <span>今天专注</span>
                    <strong>{duration(todayMs)}</strong>
                  </div>
                  <div>
                    <span>本周专注</span>
                    <strong>{duration(weekMs)}</strong>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => setPage("records")}
                  >
                    查看学习记录 <Icon name="arrow" size={15} />
                  </button>
                </section>
              )}
              {(otherTasks.length > 0 || !available.length) && (
                <section className="task-section">
                  <div className="section-heading">
                    <h2>
                      每周习惯与自由学习{" "}
                      <span className="count">{otherTasks.length}</span>
                    </h2>
                  </div>
                  {otherTasks.length ? (
                    <div className="task-list">
                      {taskTypes
                        .filter(
                          (type) =>
                            type !== "once" &&
                            otherTasks.some((t) => t.schedule.type === type),
                        )
                        .map((type) => (
                          <section
                            key={type}
                            aria-label={taskKinds[type].name}
                            className="task-group"
                          >
                            <div className="section-heading group-heading">
                              <h3>{taskKinds[type].name}</h3>
                              <button
                                className="text-btn"
                                onClick={() => setPage(taskKinds[type].page)}
                              >
                                管理{taskKinds[type].name}{" "}
                                <Icon name="arrow" size={15} />
                              </button>
                            </div>
                            {otherTasks
                              .filter((t) => t.schedule.type === type)
                              .map((t) => (
                                <TaskRow key={t.id} task={t} />
                              ))}
                          </section>
                        ))}
                    </div>
                  ) : (
                    <div className="scenario-list">
                      <p>从你熟悉的学习场景开始</p>
                      {(
                        [
                          {
                            icon: "book",
                            name: "高数课本",
                            category: "数学",
                            materialType: "paper",
                            goal: "阅读课本，完成两道例题",
                          },
                          {
                            icon: "video",
                            name: "算法教程",
                            category: "算法",
                            materialType: "web",
                            goal: "理解一个算法，并自己实现",
                          },
                          {
                            icon: "headphones",
                            name: "四级听力",
                            category: "英语",
                            materialType: "web",
                            goal: "完成一组听力，回顾错题",
                          },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.name}
                          onClick={() =>
                            setModal({
                              kind: "choose-task",
                              preset: {
                                name: p.name,
                                category: p.category,
                                materialType: p.materialType,
                                goal: p.goal,
                              },
                            })
                          }
                        >
                          <span className="scenario-icon">
                            <Icon name={p.icon} />
                          </span>
                          <span>
                            {p.name}
                            <small>{p.goal}</small>
                          </span>
                          <Icon name="plus" size={17} />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <p className="bottom-note">
                <Icon name="leaf" size={15} />
                学习时默认隐藏，只在需要时提醒你。
              </p>
            </>
          )}
          {pageType && (
            <>
              <div className="section-heading plan-heading">
                <p>{taskKinds[pageType].description}</p>
                <span>
                  {pageTasks.length} 项{taskKinds[pageType].name}
                </span>
              </div>
              {pageTasks.length ? (
                <div className="task-list">
                  {[...pageTasks]
                    .sort(
                      (a, b) =>
                        Number(b.enabled) - Number(a.enabled) ||
                        nextAt(a, now) - nextAt(b, now),
                    )
                    .map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                </div>
              ) : (
                <div className="empty">
                  <Icon name={taskKinds[pageType].icon} size={40} />
                  <h2>{taskKinds[pageType].empty}</h2>
                  <p>{taskKinds[pageType].description}</p>
                  <button
                    className="primary"
                    onClick={() => createTask(pageType)}
                  >
                    添加第一项{taskKinds[pageType].name}
                  </button>
                </div>
              )}
            </>
          )}
          {page === "records" && (
            <>
              <div className="record-summary">
                <div>
                  <span>今天专注</span>
                  <strong>{duration(recordTodayMs)}</strong>
                </div>
                <div>
                  <span>本周专注</span>
                  <strong>{duration(recordWeekMs)}</strong>
                </div>
                <div>
                  <span>已结束的学习</span>
                  <strong>
                    {filteredSessions.filter((x) => x.state === "ended").length}
                    <small> 次</small>
                  </strong>
                </div>
              </div>
              <div className="section-heading">
                <h2>学习足迹</h2>
                <select
                  aria-label="按分类筛选"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {["全部", ...new Set(s.sessions.map((x) => x.category))].map(
                    (c) => (
                      <option key={c}>{c}</option>
                    ),
                  )}
                </select>
              </div>
              {s.sessions.filter(
                (x) => filter === "全部" || x.category === filter,
              ).length ? (
                <div className="records">
                  {[...s.sessions]
                    .reverse()
                    .filter((x) => filter === "全部" || x.category === filter)
                    .map((x) => (
                      <article className="record" key={x.id}>
                        <div className="record-dot">
                          <Icon
                            name={x.state === "ended" ? "check" : "clock"}
                            size={17}
                          />
                        </div>
                        <div>
                          <div className="record-heading">
                            <h3>{x.taskName}</h3>
                            <strong>{duration(x.elapsedMs)}</strong>
                          </div>
                          <p>
                            {new Date(x.startedAt).toLocaleString("zh-CN", {
                              month: "long",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                            　{x.category}　
                            {x.state === "ended"
                              ? x.endReason === "target"
                                ? "达到目标"
                                : "提前结束"
                              : x.state === "running"
                                ? "专注中"
                                : "已暂停"}
                          </p>
                          {x.progress && (
                            <p className="record-note">
                              学到哪里：{x.progress}
                            </p>
                          )}
                          {x.nextStep && (
                            <p className="record-note">下一步：{x.nextStep}</p>
                          )}
                          <small>暂停 {duration(x.pausedMs)}</small>
                        </div>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="empty">
                  <Icon name="book" size={40} />
                  <h2>学习会在这里留下足迹</h2>
                  <p>完成一次学习，就能看到时长与进度。</p>
                </div>
              )}
              <p className="bottom-note">
                专注时长来自计时记录，不代表知识掌握程度。
              </p>
            </>
          )}
          {page === "settings" && (
            <>
              <section className="settings-section" aria-label="软件更新">
                <h2>软件更新</h2>
                <div className="setting-row">
                  <div>
                    <h3>自动检查并下载</h3>
                    <p>
                      启动后及每 6
                      小时检查正式版本。下载完成后由你选择重启安装。
                    </p>
                  </div>
                  <button
                    className="switch"
                    role="switch"
                    aria-label="自动检查并下载"
                    aria-checked={s.settings.autoUpdate}
                    disabled={busy}
                    onClick={() =>
                      void run({
                        type: "settings.update",
                        settings: { autoUpdate: !s.settings.autoUpdate },
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
                <div className="setting-row">
                  <div className="update-info" role="status" aria-live="polite">
                    <h3>当前版本 {s.update?.currentVersion || "0.1.4"}</h3>
                    <p>
                      {s.update?.status === "checking"
                        ? "正在检查新版本…"
                        : s.update?.status === "downloading"
                          ? `正在下载 ${s.update.version}：${Math.floor(s.update.percent || 0)}%`
                          : s.update?.status === "ready"
                            ? `新版本 ${s.update.version} 已准备好。`
                            : s.update?.message || "可随时手动检查更新。"}
                    </p>
                    {s.update?.status === "downloading" && (
                      <progress
                        aria-label="更新下载进度"
                        max={100}
                        value={s.update.percent || 0}
                      />
                    )}
                    {s.update?.checkedAt && (
                      <p>
                        上次检查：
                        {new Date(s.update.checkedAt).toLocaleString("zh-CN")}
                      </p>
                    )}
                  </div>
                  {s.update?.status === "ready" ? (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void run({ type: "update.install" })}
                    >
                      重启并更新
                    </button>
                  ) : (
                    <button
                      disabled={
                        busy ||
                        !s.update ||
                        [
                          "disabled",
                          "checking",
                          "available",
                          "downloading",
                          "installing",
                        ].includes(s.update.status)
                      }
                      onClick={() => void run({ type: "update.check" })}
                    >
                      {s.update?.status === "error" ? "重试更新" : "检查更新"}
                    </button>
                  )}
                </div>
                <p className="help-text">
                  更新来自 GitHub
                  正式发布。安装前保存学习状态，重启后保持暂停；不会自动中断学习。
                </p>
              </section>
              <section className="settings-section">
                <h2>提醒与陪伴</h2>
                {(
                  [
                    {
                      key: "sound",
                      title: "提醒声音",
                      description: "提醒出现时播放系统提示音，默认关闭。",
                    },
                    {
                      key: "stages",
                      title: "阶段提醒",
                      description: "每累积专注 20 分钟，短暂提醒回到当前任务。",
                    },
                    {
                      key: "autostart",
                      title: "开机启动",
                      description:
                        "登录 Windows 后在托盘启动，不打开主窗口。安装版可用。",
                    },
                  ] as const
                ).map((setting) => (
                  <div className="setting-row" key={setting.key}>
                    <div>
                      <h3>{setting.title}</h3>
                      <p>{setting.description}</p>
                    </div>
                    <button
                      className="switch"
                      role="switch"
                      aria-label={setting.title}
                      aria-checked={s.settings[setting.key]}
                      disabled={busy}
                      onClick={() =>
                        void run({
                          type: "settings.update",
                          settings: { [setting.key]: !s.settings[setting.key] },
                        })
                      }
                    >
                      <span />
                    </button>
                  </div>
                ))}
                <div className="setting-row">
                  <div>
                    <h3>灵动岛预览</h3>
                    <p>平时完全隐藏，提醒时在屏幕顶部出现，不抢焦点。</p>
                  </div>
                  <div className="preview-actions">
                    <button
                      onClick={() =>
                        void run({ type: "island.preview", kind: "due" })
                      }
                    >
                      到点
                    </button>
                    <button
                      onClick={() =>
                        void run({ type: "island.preview", kind: "stage" })
                      }
                    >
                      阶段
                    </button>
                    <button
                      onClick={() =>
                        void run({ type: "island.preview", kind: "complete" })
                      }
                    >
                      完成
                    </button>
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <h2>后台与数据</h2>
                <div className="setting-row">
                  <div>
                    <h3>关闭窗口，继续陪伴</h3>
                    <p>
                      关闭窗口会收起到系统托盘，提醒与计时继续。
                      <br />
                      彻底退出、关机或睡眠时无法准时提醒，回来后汇总待开始任务。
                    </p>
                  </div>
                  <button onClick={() => void run({ type: "window.hide" })}>
                    收起到托盘
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <h3>学习记录留在这台电脑</h3>
                    <p>
                      无需账户，不上传学习内容。数据在本机保存，并保留最近备份。
                      <br />
                      睡眠、锁屏或重启后，计时保持暂停，等待你继续。
                    </p>
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <h3>
                      沉浸学习{" "}
                      <span className="version">
                        {s.update?.currentVersion || "0.1.4"}
                      </span>
                    </h3>
                    <p>为纸质课本、在线课程和自己的节奏而设计。</p>
                  </div>
                  <button
                    className="danger-text"
                    onClick={() => void run({ type: "app.quit" })}
                  >
                    彻底退出
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      {modal?.kind === "choose-task" && (
        <ModalFrame
          title="安排哪一类学习？"
          subtitle="习惯按周重复，计划约定某一天。"
          onClose={() => setModal(null)}
        >
          <div className="task-type-choices">
            {taskTypes.map((type) => (
              <button key={type} onClick={() => createTask(type, modal.preset)}>
                <Icon name={taskKinds[type].icon} size={24} />
                <span>
                  <strong>{taskKinds[type].create}</strong>
                  <small>{taskKinds[type].description}</small>
                </span>
                <Icon name="arrow" size={18} />
              </button>
            ))}
          </div>
        </ModalFrame>
      )}
      {modal?.kind === "task" && (
        <TaskForm
          task={modal.task}
          preset={modal.preset}
          busy={busy}
          onClose={() => setModal(null)}
          pickFile={() => window.study.pickFile()}
          onSave={async (task) => {
            if (
              await run({ type: "task.save", task, id: modal.task?.id }, true)
            )
              setModal(null);
          }}
        />
      )}
      {modal?.kind === "start" && (
        <ModalFrame
          title="留一段时间，专注这一件事"
          subtitle={modal.task.name}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run({
                  type: "session.start",
                  taskId: modal.task.id,
                  minutes: startMinutes,
                  reminderId: modal.reminderId,
                })
              )
                setModal(null);
            }}
          >
            {modal.task.goal && <p className="start-goal">{modal.task.goal}</p>}
            {(modal.task.progress || modal.task.nextStep) && (
              <div className="resume-note">
                <span>接着上次</span>
                {modal.task.progress && <p>学到哪里：{modal.task.progress}</p>}
                {modal.task.nextStep && <p>下一步：{modal.task.nextStep}</p>}
              </div>
            )}
            <label>
              本次时长（分钟）
              <input
                autoFocus
                type="number"
                min="1"
                max="240"
                required
                value={startMinutes}
                onChange={(e) => setStartMinutes(Number(e.target.value))}
              />
            </label>
            <p className="help-text">
              开始后提醒窗会收起。你可以关闭主窗口，在托盘中暂停或结束。
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await run({
                      type: "session.start",
                      taskId: modal.task.id,
                      minutes: 5,
                      reminderId: modal.reminderId,
                    })
                  )
                    setModal(null);
                }}
              >
                先学 5 分钟
              </button>
              <button className="primary" disabled={busy} type="submit">
                <Icon name="play" size={16} />
                开始学习
              </button>
            </footer>
          </form>
        </ModalFrame>
      )}
      {modal?.kind === "end" && active && (
        <ModalFrame
          title="给下次的自己，留一个起点"
          subtitle={`这次已专注 ${duration(active.elapsedMs)} · ${active.taskName}`}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run({
                  type: "session.end",
                  id: active.id,
                  progress,
                  nextStep,
                })
              )
                setModal(null);
            }}
          >
            <label>
              学到哪里（可选）
              <textarea
                autoFocus
                rows={3}
                maxLength={10000}
                placeholder="例如：看完极限定义，完成例题 1、2"
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
              />
            </label>
            <label>
              下一步（可选）
              <textarea
                rows={2}
                maxLength={10000}
                placeholder="例如：下次从习题 1-2 开始"
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setModal(null)}>
                返回学习
              </button>
              <button className="primary" disabled={busy} type="submit">
                结束并保存
              </button>
            </footer>
          </form>
        </ModalFrame>
      )}
      {modal?.kind === "archive" && (
        <ModalFrame
          title="归档这项任务？"
          subtitle={modal.task.name}
          onClose={() => setModal(null)}
        >
          <p>归档后停止该任务提醒，已有学习记录会保留。</p>
          {error && <p className="form-error">{error}</p>}
          <footer>
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await run({ type: "task.archive", id: modal.task.id }))
                  setModal(null);
              }}
            >
              确认归档
            </button>
          </footer>
        </ModalFrame>
      )}
    </div>
  );
}

function IslandView() {
  const [s, set] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [displayed, setDisplayed] = useState<Snapshot["island"]>(null);
  useEffect(() => {
    if (s?.island) {
      setDisplayed(s.island);
      setError("");
    } else {
      const timer = setTimeout(() => setDisplayed(null), 210);
      return () => clearTimeout(timer);
    }
  }, [s?.island?.eventId]);
  useEffect(() => {
    document.body.classList.add("island-body");
    const off = window.study.subscribe(set);
    window.study.snapshot().then(set);
    return off;
  }, []);
  const run = async (c: Command) => {
    setBusy(true);
    setError("");
    try {
      const r = await window.study.command(c);
      if (!r.ok) setError(r.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const n = displayed;
  if (!n) return null;
  return (
    <section
      key={n.eventId}
      className={`island-shell ${!s?.island ? "leaving" : ""}`}
      aria-label="学习提醒"
      aria-hidden={!s?.island}
      inert={!s?.island}
    >
      <div className="island-content">
        <span className="island-orb">
          <Icon name={n.kind === "complete" ? "check" : "leaf"} size={24} />
        </span>
        <div>
          <h1>{n.title}</h1>
          <p>{error || n.message}</p>
        </div>
        <button
          className="island-close"
          aria-label="收起提醒"
          onClick={() => void run({ type: "island.dismiss" })}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="island-actions">
        {n.kind === "due" && n.taskId ? (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void run({
                  type: "session.start",
                  taskId: n.taskId!,
                  reminderId: n.reminderId,
                })
              }
            >
              开始学习
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run({
                  type: "session.start",
                  taskId: n.taskId!,
                  reminderId: n.reminderId,
                  minutes: 5,
                })
              }
            >
              先学 5 分钟
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run({ type: "reminder.snooze", id: n.reminderId! })
              }
            >
              稍后提醒
            </button>
          </>
        ) : n.kind === "complete" && s?.active ? (
          <>
            <button
              disabled={busy}
              onClick={() => void run({ type: "window.finish" })}
            >
              完成并记录
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run({ type: "session.extend", id: s.active!.id })
              }
            >
              继续 10 分钟
            </button>
          </>
        ) : (
          <button
            onClick={() =>
              void run({
                type: n.kind === "summary" ? "window.show" : "island.dismiss",
              })
            }
          >
            {n.kind === "summary" ? "查看学习安排" : "知道了"}
          </button>
        )}
      </div>
    </section>
  );
}

const isIsland = new URLSearchParams(location.search).has("island");
if (isIsland) {
  document.documentElement.classList.add("island-surface");
  document.body.classList.add("island-body");
}
createRoot(document.getElementById("root")!).render(
  isIsland ? <IslandView /> : <App />,
);
