import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Engine,
  freshData,
  localDay,
  nextOccurrence,
  validateTask,
} from "../core/engine";
import type { TaskInput } from "../shared/types";

const input = (extra: Partial<TaskInput> = {}): TaskInput => ({
  name: "高数",
  category: "数学",
  materialType: "paper",
  material: "第 32—36 页",
  goal: "完成例题",
  minutes: 25,
  enabled: true,
  schedule: { type: "none" },
  ...extra,
});
function clock(start = new Date(2026, 10, 12, 20, 0, 0)) {
  let wall = start.getTime(),
    mono = 0;
  const engine = new Engine(
    freshData(),
    () => new Date(wall),
    () => mono,
  );
  return {
    engine,
    advance(ms: number) {
      wall += ms;
      mono += ms;
      engine.tick();
    },
    jump(ms: number) {
      wall += ms;
      engine.tick();
    },
  };
}
const add = (e: Engine, value = input()) => {
  e.command({ type: "task.save", task: value });
  return e.data.tasks.at(-1)!;
};

test("task validation rejects unsafe links, invalid durations and missing weekdays", () => {
  assert.throws(() => validateTask(input({ name: "" }), new Date()));
  assert.throws(() => validateTask(input({ minutes: 0 }), new Date()));
  assert.throws(() =>
    validateTask(
      input({ materialType: "web", material: "javascript:alert(1)" }),
      new Date(),
    ),
  );
  assert.throws(() =>
    validateTask(
      input({ schedule: { type: "weekly", days: [], time: "20:00" } }),
      new Date(),
    ),
  );
  assert.throws(() =>
    validateTask(
      input({ schedule: { type: "once", at: "2020-01-01" } }),
      new Date(),
    ),
  );
});
test("single session, duplicate clicks, pause and resume preserve exact elapsed time", () => {
  const c = clock();
  const a = add(c.engine);
  const b = add(c.engine, input({ name: "算法" }));
  c.engine.command({ type: "session.start", taskId: a.id });
  c.engine.command({ type: "session.start", taskId: a.id });
  assert.equal(c.engine.data.sessions.length, 1);
  assert.throws(() =>
    c.engine.command({ type: "session.start", taskId: b.id }),
  );
  c.advance(60000);
  const id = c.engine.active!.id;
  c.engine.command({ type: "session.pause", id });
  c.advance(30000);
  c.engine.command({ type: "session.resume", id });
  c.advance(60000);
  assert.equal(c.engine.active!.elapsedMs, 120000);
  assert.equal(c.engine.active!.pausedMs, 30000);
});
test("target auto-pauses; extension runs ten minutes and completed time never grows unattended", () => {
  const c = clock();
  const t = add(c.engine);
  c.engine.command({ type: "session.start", taskId: t.id, minutes: 5 });
  c.advance(360000);
  assert.equal(c.engine.active!.state, "paused");
  assert.equal(c.engine.active!.elapsedMs, 300000);
  assert.equal(t.minutes, 25);
  assert.equal(c.engine.island!.kind, "complete");
  c.advance(600000);
  assert.equal(c.engine.active!.elapsedMs, 300000);
  assert.throws(() =>
    c.engine.command({ type: "session.resume", id: c.engine.active!.id }),
  );
  c.engine.command({ type: "session.extend", id: c.engine.active!.id });
  assert.equal(c.engine.active!.targetMs, 900000);
  assert.equal(c.engine.active!.state, "running");
});
test("ending saves progress without mutating historical name and is idempotent", () => {
  const c = clock();
  const t = add(c.engine);
  c.engine.command({ type: "session.start", taskId: t.id });
  c.advance(10000);
  const id = c.engine.active!.id;
  c.engine.command({
    type: "session.end",
    id,
    progress: "完成例题 1",
    nextStep: "习题 1-2",
  });
  c.engine.command({ type: "session.end", id, progress: "", nextStep: "" });
  c.engine.command({
    type: "task.save",
    id: t.id,
    task: input({ name: "新名字" }),
  });
  assert.equal(t.progress, "完成例题 1");
  assert.equal(t.nextStep, "习题 1-2");
  assert.equal(c.engine.data.sessions[0].taskName, "高数");
  assert.equal(c.engine.data.sessions[0].endReason, "early");
});
test("cross-midnight time is allocated to local dates and clock jumps do not add time", () => {
  const start = new Date(2026, 10, 15, 23, 59, 30);
  const c = clock(start);
  const t = add(c.engine);
  c.engine.command({ type: "session.start", taskId: t.id });
  c.advance(60000);
  assert.equal(c.engine.active!.dailyMs["2026-11-15"], 30000);
  assert.equal(c.engine.active!.dailyMs["2026-11-16"], 30000);
  c.jump(-3600000);
  assert.equal(c.engine.active!.elapsedMs, 60000);
  c.advance(1000);
  assert.equal(c.engine.active!.elapsedMs, 61000);
});
test("recovery pauses a running session and excludes offline time", () => {
  const c = clock();
  const t = add(c.engine);
  c.engine.command({ type: "session.start", taskId: t.id });
  c.advance(10000);
  const restored = new Engine(structuredClone(c.engine.data));
  assert.equal(restored.active!.state, "paused");
  assert.equal(restored.active!.elapsedMs, 10000);
});
test("reminders deduplicate, snooze same instance and do not duplicate after restart", () => {
  const c = clock();
  const t = add(
    c.engine,
    input({
      schedule: {
        type: "once",
        at: new Date(2026, 10, 12, 20, 1).toISOString(),
      },
    }),
  );
  c.advance(60000);
  assert.equal(c.engine.data.reminders.length, 1);
  assert.equal(c.engine.island!.kind, "due");
  const r = c.engine.data.reminders[0];
  c.engine.command({ type: "reminder.snooze", id: r.id });
  c.advance(599000);
  assert.equal(c.engine.island, null);
  c.advance(1000);
  assert.equal(c.engine.island!.kind, "due");
  assert.equal(c.engine.data.reminders.length, 1);
  c.engine.command({ type: "session.start", taskId: t.id, reminderId: r.id });
  assert.equal(r.status, "started");
  const restored = new Engine(structuredClone(c.engine.data));
  restored.tick();
  assert.equal(restored.data.reminders.length, 1);
});
test("weekly recovery retains only the latest missed occurrence and computes next", () => {
  const c = clock();
  const t = add(
    c.engine,
    input({ schedule: { type: "weekly", days: [4], time: "20:01" } }),
  );
  c.advance(60000);
  const old = c.engine.data.reminders[0];
  c.advance(7 * 86400000);
  assert.equal(old.status, "skipped");
  assert.equal(
    c.engine.data.reminders.filter((r) => r.status === "pending").length,
    1,
  );
  const next = nextOccurrence(t, new Date(2026, 10, 19, 20, 1));
  assert.equal(localDay(next!), "2026-11-26");
});
test("reminders during active learning are deferred; archive cancels pending reminders", () => {
  const c = clock();
  const t = add(c.engine);
  const other = add(
    c.engine,
    input({
      name: "算法",
      schedule: {
        type: "once",
        at: new Date(2026, 10, 12, 20, 1).toISOString(),
      },
    }),
  );
  c.engine.command({ type: "session.start", taskId: t.id });
  c.advance(60000);
  assert.equal(c.engine.island, null);
  assert.equal(c.engine.data.reminders[0].shown, false);
  assert.throws(() => c.engine.command({ type: "task.archive", id: t.id }));
  c.engine.command({ type: "task.archive", id: other.id });
  assert.equal(c.engine.data.reminders[0].status, "skipped");
});
test("stage reminders are opt-in, based on focus duration and hide after five seconds", () => {
  const c = clock();
  const t = add(c.engine, input({ minutes: 60 }));
  c.engine.command({ type: "session.start", taskId: t.id });
  c.advance(1200000);
  assert.equal(c.engine.island, null);
  c.engine.command({ type: "settings.update", settings: { stages: true } });
  c.advance(1200000);
  assert.equal(c.engine.island!.kind, "stage");
  c.advance(5000);
  assert.equal(c.engine.island, null);
});
test("simultaneous reminders produce one summary and stop repeating after timeout", () => {
  const c = clock();
  const at = new Date(2026, 10, 12, 20, 1).toISOString();
  add(c.engine, input({ schedule: { type: "once", at } }));
  add(c.engine, input({ name: "听力", schedule: { type: "once", at } }));
  c.advance(60000);
  assert.equal(c.engine.island!.kind, "summary");
  c.advance(16000);
  assert.equal(c.engine.island, null);
  c.advance(60000);
  assert.equal(c.engine.island, null);
});
