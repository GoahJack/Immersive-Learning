import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("one-minute completion shows island with main hidden; identical notifications and hidden windows recover", async () => {
  test.setTimeout(95000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-desktop-"));
  const app = await electron.launch({
    executablePath: process.env.STUDY_EXECUTABLE,
    args: [path.resolve(__dirname, "../..")],
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
    await page.evaluate(async () => {
      await window.study.command({
        type: "settings.update",
        settings: { trayExplained: true },
      });
      await window.study.command({
        type: "task.save",
        task: {
          name: "一分钟完成提醒验证",
          category: "测试",
          materialType: "paper",
          material: "",
          goal: "验证实际到期",
          minutes: 1,
          enabled: true,
          schedule: { type: "none" },
        },
      });
      const s = await window.study.snapshot();
      await window.study.command({
        type: "session.start",
        taskId: s.tasks[0].id,
      });
      await window.study.command({ type: "window.hide" });
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.study.snapshot())).island?.kind,
        { timeout: 75000, intervals: [1000] },
      )
      .toBe("complete");
    const popup = app.windows().find((w) => w.url().includes("island=1"))!;
    await expect(
      popup.getByRole("heading", { name: "这一段，学完了" }),
    ).toBeVisible();
    expect(
      await popup.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
    expect(
      await popup.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
    const transparency = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes("island=1"),
      )!;
      const image = await w.capturePage();
      return {
        background: w.getBackgroundColor(),
        cornerAlpha: image.toBitmap()[3],
        visible: w.isVisible(),
      };
    });
    expect(transparency.background).toMatch(/^#000000(?:00)?$/);
    expect(transparency.cornerAlpha).toBe(0);
    expect(transparency.visible).toBe(true);
    await popup.screenshot({
      path: "test-results/island.png",
      animations: "disabled",
      omitBackground: true,
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes("island=1"))!
        .hide(),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes("island=1"))!
            .isVisible(),
        ),
      )
      .toBe(true);
    await page.evaluate(() =>
      window.study.command({ type: "island.preview", kind: "complete" }),
    );
    const first = (await page.evaluate(() => window.study.snapshot())).island!
      .eventId;
    await page.evaluate(() =>
      window.study.command({ type: "island.preview", kind: "complete" }),
    );
    const second = (await page.evaluate(() => window.study.snapshot())).island!
      .eventId;
    expect(first).not.toBe(second);
    await expect(
      popup.getByRole("heading", { name: "这一段，学完了" }),
    ).toBeVisible();
    await page.evaluate(() => window.study.command({ type: "island.dismiss" }));
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes("island=1"))!
            .isVisible(),
        ),
      )
      .toBe(false);
  } finally {
    await app.close();
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
});

test("plan editor exposes weekly weekdays and a specific calendar date, persists both", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-desktop-"));
  const app = await electron.launch({
    executablePath: process.env.STUDY_EXECUTABLE,
    args: [path.resolve(__dirname, "../..")],
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
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await page.getByLabel("任务名称").fill("每周高数");
    await page.getByLabel("学习时间", { exact: true }).selectOption("weekly");
    const weekdays = page.getByRole("group", { name: "重复星期" });
    for (const b of await weekdays.getByRole("button").all())
      if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
    await weekdays.getByRole("button", { name: "一", exact: true }).click();
    await weekdays.getByRole("button", { name: "三", exact: true }).click();
    await page.getByLabel("每周学习时间", { exact: true }).fill("20:30");
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    expect(
      (await page.evaluate(() => window.study.snapshot())).tasks[0].schedule,
    ).toEqual({ type: "weekly", days: [1, 3], time: "20:30" });
    await page.getByRole("button", { name: "学习计划", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("学习时间", { exact: true }).selectOption("once");
    const d = new Date();
    d.setDate(d.getDate() + 2);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T19:45`;
    await page.getByLabel("学习日期与时间").fill(value);
    await page.getByRole("button", { name: "保存任务", exact: true }).click();
    const schedule = (await page.evaluate(() => window.study.snapshot()))
      .tasks[0].schedule;
    expect(schedule.type).toBe("once");
    if (schedule.type === "once")
      expect(schedule.at).toBe(new Date(value).toISOString());
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("学习日期与时间")).toHaveValue(value);
  } finally {
    await app.close();
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
});
