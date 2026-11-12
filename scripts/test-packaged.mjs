import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const executable = path.resolve("release/win-unpacked/沉浸学习.exe");
if (!existsSync(executable))
  throw Error("请先执行 npm run dist 生成 Windows 应用。");
const runner = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, STUDY_EXECUTABLE: executable },
  },
);
runner.on("exit", (code) => {
  process.exitCode = code || 0;
});
