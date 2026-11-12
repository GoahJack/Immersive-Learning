import type { AppUpdater } from "electron-updater";
import type { UpdateState } from "../shared/types";

export type UpdateDriver = Pick<
  AppUpdater,
  "on" | "checkForUpdates" | "downloadUpdate" | "quitAndInstall"
>;

// This state is transient. Only the automatic-check preference belongs in the data file.
export class UpdateController {
  state: UpdateState;
  private working = false;
  constructor(
    private driver: UpdateDriver | null,
    currentVersion: string,
    private changed: () => void,
    ready: () => void,
    reason?: string,
  ) {
    this.state = {
      currentVersion,
      status: driver ? "idle" : "disabled",
      message: reason,
    };
    if (!driver) return;
    driver.on("update-available", (info) => {
      if (this.state.status === "checking")
        this.set({ status: "available", version: info.version });
    });
    driver.on("update-not-available", () => {
      if (this.state.status === "checking")
        this.set({
          status: "idle",
          checkedAt: new Date().toISOString(),
          message: "已经是最新版本。",
        });
    });
    driver.on("download-progress", (info) => {
      if (this.state.status === "downloading" && Number.isFinite(info.percent))
        this.set({ percent: Math.max(0, Math.min(100, info.percent)) });
    });
    driver.on("update-downloaded", (info) => {
      if (this.state.status !== "downloading") return;
      this.set({
        status: "ready",
        version: info.version,
        percent: 100,
        message: "更新已准备好，重启后安装。",
      });
      ready();
    });
    driver.on("error", (error) => this.fail(error));
  }
  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.changed();
  }
  private statusIs(status: UpdateState["status"]) {
    return this.state.status === status;
  }
  private fail(error: unknown) {
    console.warn(
      "Update failed:",
      error instanceof Error ? error.message : error,
    );
    this.set({
      status: "error",
      percent: undefined,
      message: "更新未完成，请检查网络或稍后重试。学习数据不受影响。",
    });
  }
  async check() {
    if (!this.driver)
      throw Error(this.state.message || "当前运行方式不支持自动更新。");
    if (this.working || ["ready", "installing"].includes(this.state.status))
      return;
    this.working = true;
    try {
      this.set({
        status: "checking",
        version: undefined,
        percent: undefined,
        message: undefined,
      });
      const result = await this.driver.checkForUpdates();
      if (this.state.status === "available") {
        this.set({
          status: "downloading",
          checkedAt: new Date().toISOString(),
          percent: 0,
        });
        await this.driver.downloadUpdate();
        if (this.statusIs("downloading"))
          throw Error("Download completed without verified update event");
      } else if (!result && this.state.status === "checking") {
        throw Error("Updater inactive");
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.working = false;
    }
  }
  async install(prepare: () => Promise<boolean>) {
    if (!this.driver || this.state.status !== "ready" || this.working)
      throw Error("请先完成更新下载。");
    this.working = true;
    try {
      if (!(await prepare())) return;
      this.set({ status: "installing", message: "正在重启安装…" });
      this.driver.quitAndInstall(true, true);
    } catch (error) {
      // A cancelled or failed save must never reach the installer.
      if (!this.statusIs("installing")) throw error;
      this.fail(error);
    } finally {
      this.working = false;
    }
  }
}
