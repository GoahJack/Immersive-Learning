import { spawn } from "node:child_process";
import electron from "electron";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
  windowsHide: true,
});
let desktop;
const stop = () => {
  desktop?.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch("http://127.0.0.1:5173")).ok) break;
  } catch {}
  if (i === 99) {
    stop();
    throw Error("前端服务未能启动。");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
desktop = spawn(electron, ["."], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:5173" },
});
desktop.on("exit", (code) => {
  vite.kill();
  process.exitCode = code || 0;
});
