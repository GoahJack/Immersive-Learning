// Real electron-updater integration: loopback server, real installer, corrupt checksum, retry.
// Never calls quitAndInstall or uses the user's installation/data/cache directories.
const { app } = require("electron");
const { NsisUpdater } = require("electron-updater");
const {
  ElectronHttpExecutor,
} = require("electron-updater/out/electronHttpExecutor");
const { UpdateController } = require("../build/electron/update-controller");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { Transform } = require("node:stream");
const root = path.resolve(__dirname, "..");
const tempRoot = path.join(root, ".test-data");
const dir = process.env.STUDY_UPDATE_TEST_DIR;
assert.ok(
  dir &&
    path.dirname(path.resolve(dir)) === tempRoot &&
    path.basename(dir).startsWith("update-download-"),
);
app.setPath("userData", dir);
let mode = "unavailable",
  requests = 0,
  autoQuit = 0;
const version = require("../package.json").version;
const installerName = `StudyCompanion-${version}-Setup.exe`;
const installer = path.join(root, "release", installerName);
const metadata = path.join(root, "release/latest.yml");
const config = path.join(dir, "app-update.yml");
fs.writeFileSync(config, "updaterCacheDirName: study-update-integration\n");
const server = http.createServer((req, res) => {
  requests++;
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file =
    pathname === "/latest.yml"
      ? metadata
      : pathname === `/${installerName}`
        ? installer
        : null;
  if (mode === "unavailable" || !file) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader("content-length", fs.statSync(file).size);
  if (file === installer && mode === "corrupt") {
    let first = true;
    fs.createReadStream(file)
      .pipe(
        new Transform({
          transform(chunk, encoding, callback) {
            if (first) {
              first = false;
              chunk[0] ^= 1;
            }
            callback(null, chunk);
          },
        }),
      )
      .pipe(res);
  } else fs.createReadStream(file).pipe(res);
});
const deadline = setTimeout(() => {
  console.error("Update integration timed out");
  app.exit(1);
}, 120000);
async function run() {
  assert.ok(
    fs.existsSync(installer) && fs.existsSync(metadata),
    "Run npm run dist first",
  );
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const driver = new NsisUpdater(
    { provider: "generic", url: `http://127.0.0.1:${server.address().port}` },
    {
      version: "0.0.1",
      name: "study-update-integration",
      isPackaged: true,
      appUpdateConfigPath: config,
      userDataPath: dir,
      baseCachePath: dir,
      whenReady: () => app.whenReady(),
      relaunch() {
        autoQuit++;
      },
      quit() {
        autoQuit++;
      },
      onQuit() {},
    },
  );
  // Upstream leaves the executor unset when supplied a test AppAdapter.
  // Set the real Electron transport before constructing the loopback provider.
  driver.httpExecutor = new ElectronHttpExecutor();
  driver.setFeedURL({
    provider: "generic",
    url: `http://127.0.0.1:${server.address().port}`,
  });
  driver.autoDownload = false;
  driver.autoInstallOnAppQuit = false;
  driver.disableWebInstaller = true;
  driver.disableDifferentialDownload = true;
  driver.allowDowngrade = false;
  driver.allowPrerelease = false;
  let ready = 0;
  const state = new UpdateController(
    driver,
    "0.0.1",
    () => {},
    () => ready++,
  );
  await state.check();
  assert.equal(state.state.status, "error");
  mode = "corrupt";
  await state.check();
  assert.equal(state.state.status, "error");
  assert.equal(ready, 0);
  mode = "valid";
  await state.check();
  assert.equal(state.state.status, "ready");
  assert.equal(state.state.version, version);
  assert.equal(ready, 1);
  const hash = (file) =>
    crypto.createHash("sha512").update(fs.readFileSync(file)).digest("hex");
  assert.equal(hash(driver.installerPath), hash(installer));
  const count = requests;
  await state.check();
  assert.equal(requests, count);
  assert.equal(autoQuit, 0);
  console.log(
    "Real update download passed: unavailable feed, SHA-512 rejection, retry, verified ready, no automatic quit",
  );
}
run().then(
  () => finish(0),
  (error) => {
    console.error(error);
    finish(1);
  },
);
function finish(code) {
  clearTimeout(deadline);
  server.close();
  // The parent removes this profile after Chromium releases its files.
  app.exit(code);
}
