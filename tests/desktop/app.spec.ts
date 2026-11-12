import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine, freshData } from "../../core/engine";
import type { Data, TaskInput } from "../../shared/types";

const root = path.resolve(__dirname, "../..");
const task = (extra: Partial<TaskInput> = {}): TaskInput => ({
  name: "高数 · 极限与连续",
  category: "数学",
  materialType: "paper",
  material: "第 32—36 页",
  goal: "理解极限定义，完成两道例题",
  minutes: 25,
  enabled: true,
  schedule: { type: "none" },
  ...extra,
});
async function launch(data?: Data, directory?: string) {
  const dir =
    directory || fs.mkdtempSync(path.join(os.tmpdir(), "study-desktop-"));
  if (data)
    fs.writeFileSync(path.join(dir, "study-data.json"), JSON.stringify(data));
  const app = await electron.launch({
    executablePath: process.env.STUDY_EXECUTABLE,
    args: [root],
    env: { ...process.env, STUDY_TEST_MODE: "1", STUDY_DATA_DIR: dir },
  });
  try {
    await app.firstWindow();
    await expect
      .poll(() =>
        app
          .windows()
          .some(
            (w) =>
              w.url().includes("index.html") && !w.url().includes("island=1"),
          ),
      )
      .toBe(true);
    const page = app
      .windows()
      .find(
        (w) => w.url().includes("index.html") && !w.url().includes("island=1"),
      )!;
    await expect(
      page.getByRole("heading", { name: "今天", exact: true }),
    ).toBeVisible();
    return { app, page, dir };
  } catch (error) {
    await cleanup(app, dir);
    throw error;
  }
}
async function cleanup(
  app: Awaited<ReturnType<typeof launch>>["app"],
  dir: string,
) {
  try {
    await app.close();
  } finally {
    const target = path.resolve(dir);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("study-desktop-")
    )
      throw Error("Unexpected test directory");
    fs.rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 200,
    });
  }
}

test("paper workflow: create, start, pause, resume, record progress and restore after restart", async () => {
  let { app, page, dir } = await launch();
  try {
    await expect(page.getByText("从一件想学的事开始。")).toBeVisible();
    await page.screenshot({ path: "test-results/empty.png" });
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await page
      .getByRole("button", { name: "新建自由学习", exact: false })
      .click();
    await page.getByLabel("任务名称").fill("高数 · 极限与连续");
    await page.getByLabel("学习分类").fill("数学");
    await page.getByLabel("本次目标").fill("理解极限定义，完成两道例题");
    await page.getByLabel("材料说明").fill("高等数学第 32—36 页");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "开始学习", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "开始学习", exact: true })
      .click();
    await expect(page.getByText("专注进行中")).toBeVisible();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: "test-results/focus.png" });
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    const paused = await page.evaluate(
      async () => (await window.study.snapshot()).active!.elapsedMs,
    );
    await page.waitForTimeout(2200);
    expect(
      await page.evaluate(
        async () => (await window.study.snapshot()).active!.elapsedMs,
      ),
    ).toBe(paused);
    await page.getByRole("button", { name: "继续学习", exact: true }).click();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "结束并记录", exact: true }).click();
    await page.getByLabel("学到哪里（可选）").fill("完成极限定义与例题 1");
    await page.getByLabel("下一步（可选）").fill("从习题 1-2 开始");
    await page.getByRole("button", { name: "结束并保存", exact: true }).click();
    await expect(page.getByText("从习题 1-2 开始")).toBeVisible();
    await page.getByRole("button", { name: "学习记录", exact: true }).click();
    await expect(
      page.getByText("学到哪里：完成极限定义与例题 1"),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/records.png" });
    await app.close();
    const second = await launch(undefined, dir);
    app = second.app;
    page = second.page;
    await expect(page.getByText("从习题 1-2 开始")).toBeVisible();
    expect(
      (await page.evaluate(() => window.study.snapshot())).sessions,
    ).toHaveLength(1);
    await page.getByRole("button", { name: "自由学习", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("任务名称").fill("高数 · 接续练习");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "高数 · 接续练习" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "归档", exact: true }).click();
    await page.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(page.getByText("还没有自由学习内容")).toBeVisible();
  } finally {
    await cleanup(app, dir);
  }
});

test("closing main preserves process and scheduled island; reminder can start a session", async () => {
  const e = new Engine(freshData());
  e.command({ type: "task.save", task: task() });
  const { app, page, dir } = await launch(e.data);
  try {
    // Suppress first-close teaching tip to isolate the real scheduled reminder.
    await page.evaluate(() =>
      window.study.command({
        type: "settings.update",
        settings: { trayExplained: true },
      }),
    );
    const result = await page.evaluate(async () => {
      const s = await window.study.snapshot();
      const t = s.tasks[0];
      return window.study.command({
        type: "task.save",
        id: t.id,
        task: {
          ...t,
          schedule: {
            type: "once",
            at: new Date(Date.now() + 3500).toISOString(),
          },
        },
      });
    });
    expect(result.ok).toBe(true);
    await page.evaluate(() => window.study.command({ type: "window.hide" }));
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "沉浸学习")!
          .isVisible(),
      ),
    ).toBe(false);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.study.snapshot())).island?.kind,
        { timeout: 10000 },
      )
      .toBe("due");
    const popup = app.windows().find((w) => w.url().includes("island=1"))!;
    await expect(
      popup.getByRole("heading", { name: "高数 · 极限与连续" }),
    ).toBeVisible();
    await popup.screenshot({
      path: "test-results/island.png",
      animations: "disabled",
    });
    await popup.getByRole("button", { name: "先学 5 分钟" }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.study.snapshot())).active?.state,
      )
      .toBe("running");
    const snap = await page.evaluate(() => window.study.snapshot());
    expect(snap.active!.targetMs).toBe(300000);
    expect(snap.reminders[0].status).toBe("started");
    expect(snap.island).toBeNull();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes("island=1"))!
            .isVisible(),
        ),
      )
      .toBe(false);
    await page.waitForTimeout(1000);
    expect(
      (await page.evaluate(() => window.study.snapshot())).reminders,
    ).toHaveLength(1);
  } finally {
    await cleanup(app, dir);
  }
});

test("homepage prioritizes dated plans in the first viewport and keeps active focus first", async () => {
  const current = Date.now();
  let wall = current - 2 * 3600000;
  const e = new Engine(
    freshData(),
    () => new Date(wall),
    () => 0,
  );
  const save = (name: string, offset: number, enabled = true) => {
    e.command({
      type: "task.save",
      task: task({
        name,
        category: name.includes("听力")
          ? "英语"
          : name.includes("算法")
            ? "算法"
            : "数学",
        goal: name.includes("听力")
          ? "完成一组听力，回顾错题"
          : name.includes("算法")
            ? "实现二分查找，整理复杂度"
            : "理解极限定义，完成两道例题",
        enabled,
        schedule: {
          type: "once",
          at: new Date(current + offset).toISOString(),
        },
      }),
    });
    return e.data.tasks.at(-1)!;
  };
  const finished = save("已经完成的旧计划", -90 * 60000);
  wall = current - 80 * 60000;
  e.tick();
  e.command({
    type: "session.start",
    taskId: finished.id,
    reminderId: e.data.reminders[0].id,
  });
  e.command({
    type: "session.end",
    id: e.active!.id,
    progress: "已完成",
    nextStep: "",
  });
  e.command({
    type: "task.save",
    task: task({
      name: "每周听力习惯",
      category: "英语",
      goal: "完成一组听力，整理错题",
      schedule: { type: "weekly", days: [1, 3], time: "20:00" },
    }),
  });
  save("下周算法练习", 7 * 86400000);
  save("明天高数复习", 86400000);
  save("今晚极限练习", 3600000);
  save("已经到点的听力", -30 * 60000);
  save("已停用的安排", 1800000, false);
  const archived = save("已归档的安排", 1800000);
  e.command({ type: "task.archive", id: archived.id });
  const { app, page, dir } = await launch(e.data);
  try {
    const agenda = page.getByRole("region", { name: "日期计划", exact: true });
    await expect(agenda.getByRole("article")).toHaveCount(3);
    await expect(agenda.getByRole("heading", { level: 3 })).toHaveText([
      "已经到点的听力",
      "今晚极限练习",
      "明天高数复习",
    ]);
    await expect(agenda.getByText("待开始", { exact: true })).toBeVisible();
    await expect(
      agenda.getByRole("button", {
        name: "查看其余 1 项日期计划",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      agenda.getByRole("heading", { name: "已经完成的旧计划" }),
    ).toHaveCount(0);
    await expect(
      agenda.getByRole("heading", { name: "已停用的安排" }),
    ).toHaveCount(0);
    const before = await agenda.boundingBox();
    const focus = await page.locator(".focus-panel").boundingBox();
    expect(before!.y).toBeLessThan(focus!.y);
    await page.screenshot({
      path: "test-results/home-plans.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 760, height: 600 });
    const firstButton = agenda.getByRole("button", {
      name: "开始学习：已经到点的听力",
      exact: true,
    });
    const bounds = await firstButton.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/home-plans-small.png",
      animations: "disabled",
    });
    await firstButton.focus();
    await page.waitForTimeout(1100);
    await expect(firstButton).toBeFocused();
    await page.setViewportSize({ width: 1180, height: 820 });
    await firstButton.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "开始学习", exact: true })
      .click();
    await expect(page.getByText("专注进行中", { exact: true })).toBeVisible();
    await expect(
      agenda.getByRole("heading", { name: "已经到点的听力" }),
    ).toHaveCount(0);
    const activeFocus = await page.locator(".focus-panel").boundingBox();
    const after = await agenda.boundingBox();
    expect(activeFocus!.y).toBeLessThan(after!.y);
    await expect(
      agenda.getByRole("button", {
        name: "开始学习：今晚极限练习",
        exact: true,
      }),
    ).toBeDisabled();
    await page.screenshot({
      path: "test-results/home-plans-active.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "结束并记录", exact: true }).click();
    await page.getByRole("button", { name: "结束并保存", exact: true }).click();
    await agenda
      .getByRole("button", { name: "全部日期计划", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "日期计划", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "已经完成的旧计划", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const snapshot = await window.study.snapshot();
      await window.study.command({
        type: "task.archive",
        id: snapshot.tasks.find((t) => t.name === "每周听力习惯")!.id,
      });
    });
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await expect(page.locator(".focus-panel")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "学习概况" })).toBeVisible();
    await page.screenshot({
      path: "test-results/home-plans-only.png",
      animations: "disabled",
    });
  } finally {
    await cleanup(app, dir);
  }
});

test("existing weekly, dated and unscheduled tasks stay separate after edit and restart", async () => {
  const e = new Engine(freshData());
  e.command({
    type: "task.save",
    task: task({
      name: "旧版听力习惯",
      schedule: { type: "weekly", days: [1, 3], time: "20:30" },
    }),
  });
  e.command({
    type: "task.save",
    task: task({
      name: "旧版日期计划",
      schedule: {
        type: "once",
        at: new Date(Date.now() + 86400000 * 2).toISOString(),
      },
    }),
  });
  e.command({ type: "task.save", task: task({ name: "旧版自由学习" }) });
  const ids = e.data.tasks.map((t) => t.id);
  e.command({ type: "session.start", taskId: ids[0] });
  e.command({
    type: "session.end",
    id: e.active!.id,
    progress: "已练习第一组",
    nextStep: "复习错题",
  });
  const history = structuredClone(e.data.sessions);
  let { app, page, dir } = await launch(e.data);
  try {
    for (const [pageName, own, other] of [
      ["每周习惯", "旧版听力习惯", "旧版日期计划"],
      ["日期计划", "旧版日期计划", "旧版听力习惯"],
      ["自由学习", "旧版自由学习", "旧版听力习惯"],
    ]) {
      await page.getByRole("button", { name: pageName, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: own, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: other, exact: true }),
      ).toHaveCount(0);
    }
    await page.getByRole("button", { name: "每周习惯", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("每周学习时间", { exact: true }).fill("21:15");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    await page.getByRole("button", { name: "日期计划", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const date = new Date();
    date.setDate(date.getDate() + 3);
    const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T19:45`;
    await page.getByLabel("学习日期与时间").fill(dateValue);
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    await app.close();
    ({ app, page } = await launch(undefined, dir));
    const saved = await page.evaluate(() => window.study.snapshot());
    expect(saved.tasks.map((t) => t.id)).toEqual(ids);
    expect(saved.tasks[0].schedule).toEqual({
      type: "weekly",
      days: [1, 3],
      time: "21:15",
    });
    expect(saved.tasks[1].schedule).toEqual({
      type: "once",
      at: new Date(dateValue).toISOString(),
    });
    expect(saved.tasks[0].progress).toBe("已练习第一组");
    expect(saved.sessions).toEqual(history);
    await page.getByRole("button", { name: "每周习惯", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("每周学习时间", { exact: true })).toHaveValue(
      "21:15",
    );
    await page.getByRole("button", { name: "关闭对话框" }).click();
    await page.getByRole("button", { name: "日期计划", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("学习日期与时间")).toHaveValue(dateValue);
  } finally {
    await cleanup(app, dir);
  }
});

test("recovery is paused; completion island returns to progress form and hides", async () => {
  const e = new Engine(freshData());
  e.command({ type: "task.save", task: task() });
  e.command({ type: "session.start", taskId: e.data.tasks[0].id });
  e.active!.targetMs = 2000;
  const { app, page, dir } = await launch(e.data);
  try {
    expect(
      (await page.evaluate(() => window.study.snapshot())).active!.state,
    ).toBe("paused");
    await page.getByRole("button", { name: "继续学习", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.study.snapshot())).island?.kind,
        { timeout: 7000 },
      )
      .toBe("complete");
    const popup = app.windows().find((w) => w.url().includes("island=1"))!;
    await popup.getByRole("button", { name: "完成并记录" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "结束并保存" }).click();
    const s = await page.evaluate(() => window.study.snapshot());
    expect(s.active).toBeUndefined();
    expect(s.sessions[0].endReason).toBe("target");
    expect(s.sessions[0].elapsedMs).toBe(2000);
  } finally {
    await cleanup(app, dir);
  }
});

test("settings preview auto-hides and invalid commands are rejected", async () => {
  const { app, page, dir } = await launch();
  try {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("switch", { name: "阶段提醒" }).click();
    await expect(page.getByRole("switch", { name: "阶段提醒" })).toBeChecked();
    await page.screenshot({ path: "test-results/settings.png" });
    await page.getByRole("button", { name: "阶段", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.study.snapshot())).island?.kind,
      )
      .toBe("preview");
    await expect
      .poll(
        async () => (await page.evaluate(() => window.study.snapshot())).island,
        { timeout: 10000 },
      )
      .toBeNull();
    const rejected = await page.evaluate(() =>
      window.study.command({
        type: "task.save",
        task: {
          name: "非法网页",
          category: "",
          materialType: "web",
          material: "file:///C:/Windows/system.ini",
          goal: "",
          minutes: 25,
          enabled: true,
          schedule: { type: "none" },
        },
      }),
    );
    expect(rejected.ok).toBe(false);
    await page.setViewportSize({ width: 800, height: 640 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await cleanup(app, dir);
  }
});

test("update settings persist while test builds cannot download or install", async () => {
  let { app, page, dir } = await launch();
  try {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const section = page.getByRole("region", { name: "软件更新" });
    await expect(
      section.getByRole("button", { name: "检查更新", exact: true }),
    ).toBeDisabled();
    await expect(
      section.getByText("自动化测试中不访问更新服务。", { exact: true }),
    ).toBeVisible();
    const toggle = section.getByRole("switch", { name: "自动检查并下载" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    const rejected = await page.evaluate(() =>
      window.study.command({ type: "update.install" }),
    );
    expect(rejected.ok).toBe(false);
    expect(
      (await page.evaluate(() => window.study.snapshot())).update?.status,
    ).toBe("disabled");
    await page.screenshot({
      path: "test-results/updates.png",
      animations: "disabled",
      fullPage: true,
    });
    await app.close();
    ({ app, page } = await launch(undefined, dir));
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByRole("switch", { name: "自动检查并下载" }),
    ).not.toBeChecked();
  } finally {
    await cleanup(app, dir);
  }
});
