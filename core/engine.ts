import { randomUUID } from "node:crypto";
import { recentOccurrence } from "../shared/schedule";
export { nextOccurrence } from "../shared/schedule";
import type {
  Command,
  Data,
  Island,
  Reminder,
  Session,
  Snapshot,
  Task,
  TaskInput,
} from "../shared/types";

export const freshData = (): Data => ({
  schemaVersion: 1,
  tasks: [],
  reminders: [],
  sessions: [],
  settings: {
    sound: false,
    stages: false,
    autostart: false,
    trayExplained: false,
    autoUpdate: true,
  },
});
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validateTask(
  input: TaskInput,
  now: Date,
  previous?: Task,
): TaskInput {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 200
  )
    throw Error("请填写学习任务名称（不超过 200 字）。");
  for (const value of [input.category, input.material, input.goal])
    if (typeof value !== "string" || value.length > 10000)
      throw Error("任务内容格式不正确。");
  if (
    !Number.isInteger(input.minutes) ||
    input.minutes < 1 ||
    input.minutes > 240
  )
    throw Error("计划时长应为 1—240 的整数分钟。");
  if (
    !["paper", "web", "file", "other"].includes(input.materialType) ||
    typeof input.enabled !== "boolean"
  )
    throw Error("材料类型或任务状态不正确。");
  if (input.materialType === "web") {
    try {
      if (!["http:", "https:"].includes(new URL(input.material).protocol))
        throw Error();
    } catch {
      throw Error("请输入完整的 HTTP 或 HTTPS 网页链接。");
    }
  }
  if (input.materialType === "file" && !input.material)
    throw Error("请选择本地文件。");
  const schedule = input.schedule;
  if (!schedule || !["none", "once", "weekly"].includes(schedule.type))
    throw Error("请选择提醒方式。");
  if (schedule.type === "once") {
    if (!Number.isFinite(Date.parse(schedule.at)))
      throw Error("提醒日期时间无效。");
    const unchanged =
      previous?.schedule.type === "once" &&
      previous.schedule.at === schedule.at;
    if (!unchanged && Date.parse(schedule.at) <= now.getTime())
      throw Error("一次性提醒需要设在未来。");
  }
  if (
    schedule.type === "weekly" &&
    (!Array.isArray(schedule.days) ||
      !schedule.days.length ||
      schedule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))
  )
    throw Error("请至少选择一个星期，并设置有效时间。");
  return {
    ...input,
    name: input.name.trim(),
    category: input.category.trim() || "未分类",
  };
}
export class Engine {
  island: Island | null = null;
  islandUntil = 0;
  notice: string | null = null;
  saveError: string | null = null;
  revision = 0;
  private lastMono: number;
  constructor(
    public data: Data,
    private wall = () => new Date(),
    private mono = () => performance.now(),
  ) {
    this.lastMono = mono();
    for (const s of data.sessions)
      if (s.state === "running") s.state = "paused";
  }
  get active(): Session | undefined {
    return this.data.sessions.find((s) => s.state !== "ended");
  }
  changed() {
    this.revision++;
  }
  show(island: Island, seconds = 15) {
    this.island = { ...island, eventId: randomUUID() };
    this.islandUntil = this.mono() + seconds * 1000;
  }
  snapshot(): Snapshot {
    return structuredClone({
      ...this.data,
      now: this.wall().toISOString(),
      active: this.active,
      island: this.island,
      notice: this.notice,
      saveError: this.saveError,
    });
  }
  tick() {
    const now = this.wall();
    const currentMono = this.mono();
    const delta = Math.max(0, currentMono - this.lastMono);
    const s = this.active;
    if (s?.state === "running") {
      const used = Math.min(delta, Math.max(0, s.targetMs - s.elapsedMs));
      // Attribute the monotonic interval to local calendar days; wall-clock jumps do not change duration.
      let cursor = new Date(now.getTime() - delta);
      let remaining = used;
      while (remaining > 0) {
        const midnight = new Date(cursor);
        midnight.setHours(24, 0, 0, 0);
        const part = Math.min(remaining, midnight.getTime() - cursor.getTime());
        const key = localDay(cursor);
        s.dailyMs[key] = (s.dailyMs[key] || 0) + part;
        remaining -= part;
        cursor = new Date(cursor.getTime() + part);
      }
      s.elapsedMs += used;
      this.changed();
      if (s.elapsedMs >= s.targetMs) {
        s.state = "paused";
        s.reached = true;
        this.show({
          kind: "complete",
          title: "这一段，学完了",
          message: s.taskName,
          taskId: s.taskId,
        });
      } else {
        const stage = Math.floor(s.elapsedMs / 1200000);
        if (stage > s.stage && this.data.settings.stages)
          this.show(
            { kind: "stage", title: "把注意力带回这一刻", message: s.taskName },
            5,
          );
        s.stage = stage;
      }
    } else if (s?.state === "paused") {
      s.pausedMs += delta;
      this.changed();
    }
    this.lastMono = currentMono;
    if (this.island && currentMono >= this.islandUntil) this.island = null;
    const newDue: Reminder[] = [];
    for (const task of this.data.tasks) {
      const occurrence = recentOccurrence(task, now);
      if (!occurrence) continue;
      const at = occurrence.toISOString();
      const id = `${task.id}@${at}`;
      if (!this.data.reminders.some((r) => r.id === id)) {
        for (const old of this.data.reminders)
          if (
            old.taskId === task.id &&
            ["pending", "snoozed"].includes(old.status) &&
            old.scheduledAt < at
          )
            old.status = "skipped";
        this.data.reminders.push({
          id,
          taskId: task.id,
          scheduledAt: at,
          dueAt: at,
          status: "pending",
          shown: false,
        });
        this.changed();
      }
    }
    for (const reminder of this.data.reminders) {
      const task = this.data.tasks.find((t) => t.id === reminder.taskId);
      if (!task || !task.enabled || task.archived) continue;
      if (
        ["pending", "snoozed"].includes(reminder.status) &&
        !reminder.shown &&
        Date.parse(reminder.dueAt) <= now.getTime()
      )
        newDue.push(reminder);
    }
    if (newDue.length && !this.active && this.island?.kind !== "complete") {
      for (const r of newDue) {
        r.shown = true;
        r.status = "pending";
      }
      this.changed();
      if (newDue.length > 1)
        this.show({
          kind: "summary",
          title: `${newDue.length} 项学习等待开始`,
          message: "打开今天，选择接下来的一件事。",
        });
      else {
        const r = newDue[0];
        const t = this.data.tasks.find((t) => t.id === r.taskId)!;
        this.show({
          kind: "due",
          title: t.name,
          message: t.goal || `给自己 ${t.minutes} 分钟，开始就好。`,
          reminderId: r.id,
          taskId: t.id,
        });
      }
    }
  }
  command(command: Command) {
    this.tick();
    const now = this.wall().toISOString();
    switch (command.type) {
      case "task.save": {
        const prev = command.id
          ? this.data.tasks.find((t) => t.id === command.id)
          : undefined;
        if (command.id && !prev) throw Error("找不到这项任务。");
        const input = validateTask(command.task, this.wall(), prev);
        if (prev) {
          const rescheduled =
            JSON.stringify(prev.schedule) !== JSON.stringify(input.schedule);
          Object.assign(prev, input, { updatedAt: now });
          if (rescheduled || !input.enabled)
            for (const r of this.data.reminders)
              if (
                r.taskId === prev.id &&
                ["pending", "snoozed"].includes(r.status)
              )
                r.status = "skipped";
          // Retain consumed instance IDs to avoid duplicate delivery when editing an existing schedule.
        } else
          this.data.tasks.push({
            ...input,
            id: randomUUID(),
            archived: false,
            createdAt: now,
            updatedAt: now,
            progress: "",
            nextStep: "",
          });
        break;
      }
      case "task.archive": {
        if (this.active?.taskId === command.id)
          throw Error("请先结束这项任务的学习，再归档。");
        const task = this.task(command.id);
        task.archived = true;
        for (const r of this.data.reminders)
          if (r.taskId === task.id && ["pending", "snoozed"].includes(r.status))
            r.status = "skipped";
        break;
      }
      case "session.start": {
        if (this.active) {
          if (this.active.taskId === command.taskId) return;
          throw Error("请先结束当前学习，再开始另一项任务。");
        }
        const task = this.task(command.taskId);
        if (task.archived || !task.enabled) throw Error("请先启用这项任务。");
        const minutes = command.minutes ?? task.minutes;
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)
          throw Error("时长应为 1—240 分钟。");
        if (command.reminderId) {
          const r = this.data.reminders.find(
            (r) => r.id === command.reminderId && r.taskId === task.id,
          );
          if (!r || !["pending", "snoozed"].includes(r.status))
            throw Error("这条提醒已处理，请从任务开始新的学习。");
          r.status = "started";
        }
        this.data.sessions.push({
          id: randomUUID(),
          taskId: task.id,
          taskName: task.name,
          category: task.category,
          reminderId: command.reminderId,
          startedAt: now,
          state: "running",
          targetMs: minutes * 60000,
          elapsedMs: 0,
          pausedMs: 0,
          dailyMs: {},
          reached: false,
          stage: 0,
          progress: "",
          nextStep: "",
        });
        this.island = null;
        break;
      }
      case "session.pause": {
        const s = this.session(command.id);
        if (s.state === "running") s.state = "paused";
        break;
      }
      case "session.resume": {
        const s = this.session(command.id);
        if (s.state === "ended") return;
        if (s.elapsedMs >= s.targetMs)
          throw Error("本段已完成，请延长 10 分钟或结束记录。");
        s.state = "running";
        break;
      }
      case "session.extend": {
        const s = this.session(command.id);
        if (s.state === "ended") return;
        s.targetMs = s.elapsedMs + 600000;
        s.state = "running";
        this.island = null;
        break;
      }
      case "session.end": {
        const s = this.session(command.id);
        if (s.state === "ended") return;
        if (
          typeof command.progress !== "string" ||
          typeof command.nextStep !== "string" ||
          command.progress.length > 10000 ||
          command.nextStep.length > 10000
        )
          throw Error("进度记录过长或格式不正确。");
        s.state = "ended";
        s.endedAt = now;
        s.endReason = s.reached ? "target" : "early";
        s.progress = command.progress;
        s.nextStep = command.nextStep;
        const task = this.task(s.taskId);
        if (command.progress) task.progress = command.progress;
        if (command.nextStep) task.nextStep = command.nextStep;
        this.island = null;
        break;
      }
      case "reminder.snooze": {
        const r = this.data.reminders.find((r) => r.id === command.id);
        if (!r || !["pending", "snoozed"].includes(r.status))
          throw Error("这条提醒已处理。");
        r.status = "snoozed";
        r.dueAt = new Date(this.wall().getTime() + 600000).toISOString();
        r.shown = false;
        this.island = null;
        break;
      }
      case "settings.update": {
        for (const [key, value] of Object.entries(command.settings)) {
          if (
            ![
              "sound",
              "stages",
              "autostart",
              "trayExplained",
              "autoUpdate",
            ].includes(key) ||
            typeof value !== "boolean"
          )
            throw Error("设置格式不正确。");
        }
        Object.assign(this.data.settings, command.settings);
        break;
      }
      case "island.dismiss":
        this.island = null;
        break;
      case "notice.dismiss":
        this.notice = null;
        break;
      default:
        throw Error("不支持的操作。");
    }
    this.changed();
  }
  task(id: string) {
    const t = this.data.tasks.find((t) => t.id === id);
    if (!t) throw Error("找不到这项任务。");
    return t;
  }
  session(id: string) {
    const s = this.data.sessions.find((s) => s.id === id);
    if (!s) throw Error("找不到学习记录。");
    return s;
  }
}
