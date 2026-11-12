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
    await page.getByRole("button", { name: "学习计划", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("任务名称").fill("高数 · 接续练习");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "高数 · 接续练习" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "归档", exact: true }).click();
    await page.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(page.getByText("还没有学习计划")).toBeVisible();
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
