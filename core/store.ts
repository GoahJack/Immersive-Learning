import fs from "node:fs";
import path from "node:path";
import type { Data } from "../shared/types";
import { freshData, validateTask } from "./engine";

export class IncompatibleDataError extends Error {}
export function parseData(raw: string): Data {
  const d = JSON.parse(raw);
  if (typeof d?.schemaVersion === "number" && d.schemaVersion > 1)
    throw new IncompatibleDataError(
      "数据来自更新版本的软件，请升级应用后再打开。原文件未修改。",
    );
  const fail = () => {
    throw Error("学习数据结构无效。");
  };
  if (
    !d ||
    d.schemaVersion !== 1 ||
    !Array.isArray(d.tasks) ||
    !Array.isArray(d.sessions) ||
    !Array.isArray(d.reminders) ||
    !d.settings
  )
    fail();
  for (const key of ["sound", "stages", "autostart", "trayExplained"])
    if (typeof d.settings[key] !== "boolean") fail();
  const string = (v: unknown) => typeof v === "string";
  const date = (v: unknown) =>
    string(v) && Number.isFinite(Date.parse(v as string));
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  for (const t of d.tasks) {
    if (
      !t ||
      !string(t.id) ||
      !t.id ||
      !date(t.createdAt) ||
      !date(t.updatedAt) ||
      typeof t.archived !== "boolean" ||
      !string(t.progress) ||
      !string(t.nextStep)
    )
      fail();
    validateTask(t, new Date(0), t);
  }
  const ids = new Set(d.tasks.map((t: { id: string }) => t.id));
  if (ids.size !== d.tasks.length) fail();
  for (const s of d.sessions) {
    if (
      !s ||
      !string(s.id) ||
      !ids.has(s.taskId) ||
      !string(s.taskName) ||
      !string(s.category) ||
      !date(s.startedAt) ||
      !["running", "paused", "ended"].includes(s.state) ||
      !num(s.targetMs) ||
      s.targetMs === 0 ||
      !num(s.elapsedMs) ||
      !num(s.pausedMs) ||
      !num(s.stage) ||
      typeof s.reached !== "boolean" ||
      !string(s.progress) ||
      !string(s.nextStep) ||
      !s.dailyMs ||
      typeof s.dailyMs !== "object" ||
      Array.isArray(s.dailyMs)
    )
      fail();
    if (
      Object.entries(s.dailyMs).some(
        ([key, ms]) => !/^\d{4}-\d{2}-\d{2}$/.test(key) || !num(ms),
      )
    )
      fail();
    if (
      s.state === "ended" &&
      (!date(s.endedAt) || !["target", "early"].includes(s.endReason))
    )
      fail();
  }
  if (
    d.sessions.filter((s: { state: string }) => s.state !== "ended").length > 1
  )
    fail();
  if (
    new Set(d.sessions.map((s: { id: string }) => s.id)).size !==
    d.sessions.length
  )
    fail();
  for (const r of d.reminders)
    if (
      !r ||
      !string(r.id) ||
      !ids.has(r.taskId) ||
      !date(r.scheduledAt) ||
      !date(r.dueAt) ||
      !["pending", "snoozed", "started", "skipped"].includes(r.status) ||
      typeof r.shown !== "boolean"
    )
      fail();
  if (
    new Set(d.reminders.map((r: { id: string }) => r.id)).size !==
    d.reminders.length
  )
    fail();
  return d;
}
export class Store {
  readonly file: string;
  notice: string | null = null;
  constructor(directory: string) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "study-data.json");
  }
  load(): Data {
    if (!fs.existsSync(this.file) && !fs.existsSync(this.file + ".bak"))
      return freshData();
    try {
      return parseData(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      if (e instanceof IncompatibleDataError) throw e;
      try {
        const backup = parseData(fs.readFileSync(this.file + ".bak", "utf8"));
        if (fs.existsSync(this.file))
          fs.copyFileSync(this.file, this.file + `.damaged-${Date.now()}`);
        fs.writeFileSync(this.file + ".tmp", JSON.stringify(backup), {
          flush: true,
        });
        fs.renameSync(this.file + ".tmp", this.file);
        this.notice =
          "学习数据已从备份恢复，损坏文件已保留。最近一次保存可能未恢复，请检查记录。";
        return backup;
      } catch (backupError) {
        if (backupError instanceof IncompatibleDataError) throw backupError;
        throw Error(
          `无法读取学习数据和备份，原文件已保留。请检查目录或恢复备份：${path.dirname(this.file)}`,
        );
      }
    }
  }
  save(data: Data) {
    const text = JSON.stringify(data);
    parseData(text);
    if (fs.existsSync(this.file)) {
      // Never replace a good backup with an invalid primary file.
      parseData(fs.readFileSync(this.file, "utf8"));
      fs.copyFileSync(this.file, this.file + ".bak");
    }
    fs.writeFileSync(this.file + ".tmp", text, { flush: true });
    fs.renameSync(this.file + ".tmp", this.file);
  }
}
