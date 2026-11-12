import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  UpdateController,
  type UpdateDriver,
} from "../electron/update-controller";
import { freshData } from "../core/engine";
import { parseData } from "../core/store";

class Driver extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = 0;
  failCheck = false;
  failDownload = false;
  failInstall = false;
  available = true;
  info = { version: "0.1.4", files: [], releaseDate: new Date().toISOString() };
  async checkForUpdates() {
    this.checks++;
    await Promise.resolve();
    if (this.failCheck) throw Error("offline");
    this.emit(
      this.available ? "update-available" : "update-not-available",
      this.info,
    );
    return {
      isUpdateAvailable: this.available,
      updateInfo: this.info,
      versionInfo: this.info,
    };
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 50 });
    await Promise.resolve();
    if (this.failDownload) throw Error("checksum mismatch");
    this.emit("update-downloaded", this.info);
    return ["test-only-installer.exe"];
  }
  quitAndInstall() {
    this.installs++;
    if (this.failInstall)
      this.emit("error", Error("installer could not start"));
  }
}
const setup = () => {
  const d = new Driver();
  let notifications = 0;
  const states: string[] = [];
  const c = new UpdateController(
    d as UpdateDriver,
    "0.1.3",
    () => states.push(c.state.status),
    () => notifications++,
  );
  return { d, c, states, notices: () => notifications };
};

test("concurrent checks download once, report progress, preserve ready until explicit install", async () => {
  const { d, c, states, notices } = setup();
  await Promise.all([c.check(), c.check(), c.check()]);
  assert.equal(d.checks, 1);
  assert.equal(d.downloads, 1);
  assert.ok(states.includes("downloading"));
  assert.equal(c.state.status, "ready");
  assert.equal(notices(), 1);
  await c.check();
  assert.equal(c.state.status, "ready");
  assert.equal(d.checks, 1);
  assert.equal(d.installs, 0);
});

test("offline and download errors allow retry; failed download never enables installation", async () => {
  const { d, c } = setup();
  d.failCheck = true;
  await c.check();
  assert.equal(c.state.status, "error");
  d.failCheck = false;
  d.failDownload = true;
  await c.check();
  assert.equal(c.state.status, "error");
  await assert.rejects(c.install(async () => true));
  assert.equal(d.installs, 0);
  d.failDownload = false;
  await c.check();
  assert.equal(c.state.status, "ready");
});

test("cancel and failed persistence keep the update ready without launching installer", async () => {
  const { d, c } = setup();
  await c.check();
  await c.install(async () => false);
  assert.equal(d.installs, 0);
  await assert.rejects(
    c.install(async () => {
      throw Error("disk full");
    }),
    /disk full/,
  );
  assert.equal(d.installs, 0);
  assert.equal(c.state.status, "ready");
  let release!: (allowed: boolean) => void;
  const first = c.install(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(c.install(async () => true));
  release(true);
  await first;
  assert.equal(d.installs, 1);
  assert.equal(c.state.status, "installing");
});

test("installer launch errors return to a recoverable error instead of quitting", async () => {
  const { d, c } = setup();
  await c.check();
  d.failInstall = true;
  await c.install(async () => true);
  assert.equal(c.state.status, "error");
  d.failInstall = false;
  await c.check();
  assert.equal(c.state.status, "ready");
});

test("no newer version remains idle; unsupported builds reject update operations", async () => {
  const { d, c } = setup();
  d.available = false;
  await c.check();
  assert.equal(c.state.status, "idle");
  assert.equal(d.downloads, 0);
  const disabled = new UpdateController(
    null,
    "0.1.3",
    () => {},
    () => {},
    "使用安装版",
  );
  await assert.rejects(disabled.check(), /使用安装版/);
  await assert.rejects(disabled.install(async () => true));
});

test("older schema 1 settings gain autoUpdate while learning content is preserved", () => {
  const old = freshData();
  const raw = JSON.parse(JSON.stringify(old));
  delete raw.settings.autoUpdate;
  assert.deepEqual(parseData(JSON.stringify(raw)), old);
  raw.settings.autoUpdate = false;
  assert.equal(parseData(JSON.stringify(raw)).settings.autoUpdate, false);
  raw.settings.autoUpdate = "true";
  assert.throws(() => parseData(JSON.stringify(raw)));
});
