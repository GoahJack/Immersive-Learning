import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  screen,
  shell,
  dialog,
  powerMonitor,
} from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { Engine } from "../core/engine";
import { Store } from "../core/store";
import type { Command, Island, Result } from "../shared/types";

const testMode = process.env.STUDY_TEST_MODE === "1";
if (testMode && process.env.STUDY_DATA_DIR)
  app.setPath("userData", process.env.STUDY_DATA_DIR);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let main: BrowserWindow,
  island: BrowserWindow,
  tray: Tray,
  engine: Engine,
  store: Store;
let quitting = false,
  lastSave = 0,
  savedRevision = -1,
  lastIsland = "",
  lastTray = "";
let approvedFiles = new Set<string>();
let hideIslandTimer: ReturnType<typeof setTimeout> | undefined;
const root = path.join(__dirname, "../..");
const preload = path.join(__dirname, "preload.js");
const developmentURL = !app.isPackaged
  ? process.env.VITE_DEV_SERVER_URL
  : undefined;
function load(window: BrowserWindow, isIsland = false) {
  if (developmentURL)
    void window.loadURL(`${developmentURL}${isIsland ? "?island=1" : ""}`);
  else
    void window.loadFile(path.join(root, "dist/index.html"), {
      query: isIsland ? { island: "1" } : {},
    });
}
function save(force = false) {
  if (!force && savedRevision === engine.revision) return true;
  try {
    store.save(engine.data);
    savedRevision = engine.revision;
    engine.saveError = null;
    lastSave = performance.now();
    return true;
  } catch (e) {
    engine.saveError = `保存失败：${(e as Error).message}。请检查磁盘空间与权限后重试。`;
    return false;
  }
}
function showMain() {
  if (!main || main.isDestroyed()) return;
  main.show();
  if (main.isMinimized()) main.restore();
  main.focus();
}
function positionIsland() {
  if (!island || island.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(580, area.width - 24);
  island.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + 12,
    width,
    height: 174,
  });
}
function publish() {
  const snapshot = engine.snapshot();
  for (const w of [main, island])
    if (w && !w.isDestroyed() && !w.webContents.isLoadingMainFrame())
      w.webContents.send("study:state", snapshot);
  const key = JSON.stringify(engine.island);
  const changed = key !== lastIsland;
  lastIsland = key;
  if (engine.island) {
    if (hideIslandTimer) {
      clearTimeout(hideIslandTimer);
      hideIslandTimer = undefined;
    }
    if (
      !island.webContents.isLoadingMainFrame() &&
      (changed || !island.isVisible())
    ) {
      positionIsland();
      if (island.isMinimized()) island.restore();
      island.showInactive();
      if (changed && engine.data.settings.sound) shell.beep();
    }
  } else if (island.isVisible() && !hideIslandTimer) {
    hideIslandTimer = setTimeout(() => {
      hideIslandTimer = undefined;
      if (!engine.island && !island.isDestroyed()) island.hide();
    }, 220);
  }
  updateTray();
}
function updateTray() {
  const active = engine.active;
  const signature = `${active?.id}|${active?.state}|${active?.taskName}|${active ? active.elapsedMs >= active.targetMs : ""}`;
  if (signature === lastTray) return;
  lastTray = signature;
  tray.setToolTip(
    active
      ? `沉浸学习：${active.taskName}（${active.state === "running" ? "专注中" : "已暂停"}）`
      : "沉浸学习",
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开学习台", click: showMain },
      ...(active
        ? [
            {
              label:
                active.state === "running"
                  ? "暂停学习"
                  : active.elapsedMs >= active.targetMs
                    ? "继续 10 分钟"
                    : "继续学习",
              click: () => {
                void execute({
                  type:
                    active.state === "running"
                      ? "session.pause"
                      : active.elapsedMs >= active.targetMs
                        ? "session.extend"
                        : "session.resume",
                  id: active.id,
                });
              },
            },
            {
              label: "结束并记录进度",
              click: () => {
                showMain();
                main.webContents.send("study:finish");
              },
            },
          ]
        : []),
      { type: "separator" },
      {
        label: "彻底退出",
        click: () => {
          void requestQuit();
        },
      },
    ]),
  );
}
async function requestQuit() {
  if (quitting) return;
  if (engine.active && !testMode) {
    const answer = await dialog.showMessageBox({
      type: "question",
      title: "退出沉浸学习",
      message: "当前学习将保存为暂停，退出后不再提醒。",
      buttons: ["继续学习", "保存并退出"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return;
  }
  if (engine.active)
    engine.command({ type: "session.pause", id: engine.active.id });
  if (!save(true)) {
    showMain();
    publish();
    return;
  }
  quitting = true;
  app.quit();
}
async function openMaterial(taskId: string) {
  const task = engine.task(taskId);
  if (task.materialType === "web") {
    const url = new URL(task.material);
    if (!["http:", "https:"].includes(url.protocol))
      throw Error("只允许打开 HTTP 或 HTTPS 网页。");
    await shell.openExternal(url.toString());
  } else if (task.materialType === "file") {
    if (!approvedFiles.has(task.material)) throw Error("请重新选择本地文件。");
    const error = await shell.openPath(task.material);
    if (error) throw Error(`文件打开失败：${error}`);
  }
}
async function execute(command: Command): Promise<Result> {
  try {
    if (
      !command ||
      typeof command !== "object" ||
      typeof command.type !== "string"
    )
      throw Error("操作格式不正确。");
    if (command.type === "window.show") {
      showMain();
      return { ok: true };
    }
    if (command.type === "window.finish") {
      showMain();
      main.webContents.send("study:finish");
      engine.island = null;
      publish();
      return { ok: true };
    }
    if (command.type === "window.hide") {
      main.close();
      return { ok: true };
    }
    if (command.type === "app.quit") {
      await requestQuit();
      return { ok: true };
    }
    if (command.type === "store.retry") {
      if (!save(true)) throw Error(engine.saveError!);
      publish();
      return { ok: true };
    }
    if (command.type === "material.open") {
      await openMaterial(command.taskId);
      return { ok: true };
    }
    if (command.type === "island.preview") {
      const kind = command.kind || "due";
      const variants: Record<string, Island> = {
        due: {
          kind: "preview",
          title: "到时间了，开始这一小步",
          message: "提醒预览：平时完全隐藏，15 秒后自动收起。",
        },
        stage: {
          kind: "preview",
          title: "把注意力带回这一刻",
          message: "阶段提醒预览：继续当前任务。",
        },
        complete: {
          kind: "preview",
          title: "这一段，学完了",
          message: "完成提醒预览：可以结束并记录，或继续 10 分钟。",
        },
      };
      engine.show(variants[kind] || variants.due, kind === "stage" ? 5 : 15);
      publish();
      return { ok: true };
    }
    if (
      command.type === "task.save" &&
      command.task?.materialType === "file" &&
      !approvedFiles.has(command.task.material)
    )
      throw Error("请通过“选择文件”添加本地材料。");
    if (
      command.type === "settings.update" &&
      command.settings?.autostart !== undefined
    ) {
      if (!app.isPackaged && command.settings.autostart)
        throw Error("开机启动仅在安装后的版本可用。");
      if (typeof command.settings.autostart !== "boolean")
        throw Error("开机启动设置无效。");
      app.setLoginItemSettings({
        openAtLogin: command.settings.autostart,
        args: ["--hidden"],
      });
    }
    const previousActive = engine.active?.id;
    engine.command(command);
    const persisted = save();
    publish();
    if (!persisted) return { ok: false, error: engine.saveError! };
    if (command.type === "session.start" && !previousActive && engine.active) {
      try {
        await openMaterial(command.taskId);
      } catch (e) {
        engine.notice = `学习计时已开始。${(e as Error).message}`;
        publish();
      }
    }
    return { ok: true };
  } catch (e) {
    publish();
    return { ok: false, error: (e as Error).message || "操作未完成，请重试。" };
  }
}
function trusted(event: IpcMainInvokeEvent) {
  if (
    ![main?.webContents.id, island?.webContents.id].includes(event.sender.id) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw Error("不允许的窗口请求。");
}
if (locked) {
  app.on("second-instance", showMain);
  app.whenReady().then(() => {
    app.setAppUserModelId("com.studycompanion.desktop");
    try {
      store = new Store(app.getPath("userData"));
      engine = new Engine(store.load());
      engine.notice = store.notice;
    } catch (e) {
      dialog.showErrorBox("学习数据未能载入", (e as Error).message);
      quitting = true;
      app.quit();
      return;
    }
    approvedFiles = new Set(
      engine.data.tasks
        .filter((t) => t.materialType === "file")
        .map((t) => t.material),
    );
    main = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 760,
      minHeight: 600,
      show: false,
      title: "沉浸学习",
      backgroundColor: "#f5f7fb",
      icon: path.join(root, "assets/icon.png"),
      autoHideMenuBar: true,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    island = new BrowserWindow({
      width: 580,
      height: 174,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    island.setAlwaysOnTop(true, "screen-saver");
    island.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      engine.command({ type: "island.dismiss" });
      publish();
    });
    island.webContents.on("did-finish-load", () => publish());
    for (const w of [main, island]) {
      w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      w.webContents.on("will-navigate", (event) => event.preventDefault());
    }
    const icon = nativeImage
      .createFromPath(path.join(root, "assets/icon.png"))
      .resize({ width: 20, height: 20 });
    tray = new Tray(icon);
    tray.on("double-click", showMain);
    updateTray();
    main.once("ready-to-show", () => {
      if (!process.argv.includes("--hidden")) main.show();
    });
    main.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      main.hide();
      if (!engine.data.settings.trayExplained) {
        engine.data.settings.trayExplained = true;
        engine.changed();
        save();
        engine.notice =
          "主窗口已收起到系统托盘。双击托盘图标可打开，右键菜单可彻底退出。";
        engine.show({
          kind: "preview",
          title: "学习台仍在后台陪伴",
          message: "双击托盘图标打开；右键可彻底退出。",
        });
        publish();
      }
    });
    ipcMain.handle("study:snapshot", (event) => {
      trusted(event);
      return engine.snapshot();
    });
    ipcMain.handle("study:command", (event, command: Command) => {
      trusted(event);
      return execute(command);
    });
    ipcMain.handle("study:pick-file", async (event) => {
      trusted(event);
      const result = await dialog.showOpenDialog(main, {
        properties: ["openFile"],
        title: "选择学习材料",
      });
      const selected = result.canceled ? null : result.filePaths[0];
      if (selected) approvedFiles.add(selected);
      return selected;
    });
    const pauseForSystem = () => {
      if (engine.active)
        engine.command({ type: "session.pause", id: engine.active.id });
      save(true);
      publish();
    };
    const resumeSystem = () => {
      engine.tick();
      save();
      publish();
    };
    powerMonitor.on("suspend", pauseForSystem);
    powerMonitor.on("lock-screen", pauseForSystem);
    powerMonitor.on("resume", resumeSystem);
    powerMonitor.on("unlock-screen", resumeSystem);
    screen.on("display-metrics-changed", positionIsland);
    screen.on("display-added", positionIsland);
    screen.on("display-removed", positionIsland);
    load(main);
    load(island, true);
    setInterval(() => {
      const previousState = engine.active?.state;
      const previousReminderCount = engine.data.reminders.length;
      engine.tick();
      if (
        performance.now() - lastSave >= 4000 ||
        previousState !== engine.active?.state ||
        previousReminderCount !== engine.data.reminders.length ||
        (engine.island && JSON.stringify(engine.island) !== lastIsland)
      )
        save();
      publish();
    }, 1000);
    engine.tick();
    save(true);
    publish();
  });
  app.on("window-all-closed", () => {
    /* Tray owns application lifetime. */
  });
  app.on("before-quit", (event) => {
    if (quitting || !engine) return;
    if (engine.active)
      engine.command({ type: "session.pause", id: engine.active.id });
    if (!save(true)) {
      event.preventDefault();
      showMain();
      publish();
      return;
    }
    quitting = true;
  });
}
