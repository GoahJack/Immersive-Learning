import { spawn } from "node:child_process";
import electron from "electron";
import fs from "node:fs";
import path from "node:path";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const tempRoot = path.resolve(".test-data");
fs.mkdirSync(tempRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tempRoot, "update-download-"));
env.STUDY_UPDATE_TEST_DIR = dir;
const runner = spawn(electron, ["tests/update-download.cjs"], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
runner.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
runner.on("exit", (code) => {
  if (path.dirname(path.resolve(dir)) !== tempRoot)
    throw Error("Unexpected update test path");
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 200,
  });
  process.exitCode = code ?? 1;
});
