import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

// Run in GitHub Actions after all build and desktop checks pass. No token is stored in the app.
const run = (args) => {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  if (result.status !== 0)
    throw Error(`GitHub CLI command failed: ${args[0]} ${args[1]}`);
  return result.stdout.trim();
};
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tag = `v${pkg.version}`;
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw Error("Only stable versions may be published");
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== tag
)
  throw Error("Release tag and package version differ");
if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || ""))
  throw Error("A specific release commit is required");
if (
  process.env.GITHUB_REF_NAME?.startsWith("release/") &&
  process.env.GITHUB_REF_NAME !== `release/${tag}`
)
  throw Error("Release branch and package version differ");
const repo = "GoahJack/Immersive-Learning";
if (process.env.GITHUB_REPOSITORY !== repo)
  throw Error("Unexpected release repository");
const base = `StudyCompanion-${pkg.version}-Setup.exe`;
const artifacts = [base, `${base}.blockmap`, "latest.yml"];
const files = artifacts.map((name) => path.join("release", name));
for (const file of files)
  if (!fs.existsSync(file)) throw Error(`Missing ${file}`);
const metadata = fs.readFileSync(files[2], "utf8");
if (!metadata.includes(`version: ${pkg.version}`) || !metadata.includes(base))
  throw Error("Update metadata does not match this build");
const installerDigest = crypto
  .createHash("sha512")
  .update(fs.readFileSync(files[0]))
  .digest("base64");
if (!metadata.includes(`sha512: ${installerDigest}`))
  throw Error("Installer and update manifest hashes differ");
const checksums =
  files
    .map(
      (file) =>
        `${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}  ${path.basename(file)}`,
    )
    .join("\n") + "\n";
fs.writeFileSync("release/SHA256SUMS.txt", checksums);
const notesPath = `docs/releases/${pkg.version}.md`;
if (!fs.existsSync(notesPath)) throw Error("Release notes are required");
// Refuse to overwrite a published version, even on a workflow rerun.
const releases = JSON.parse(
  run(["api", `repos/${repo}/releases?per_page=100`]),
);
const existing = releases.find((r) => r.tag_name === tag);
if (existing && !existing.draft)
  throw Error(`${tag} is already published; increase the version instead`);
if (!existing)
  run([
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--target",
    process.env.GITHUB_SHA,
    "--draft",
    "--title",
    `沉浸学习 ${tag}`,
    "--notes-file",
    notesPath,
  ]);
run([
  "release",
  "upload",
  tag,
  ...files,
  "release/SHA256SUMS.txt",
  "--repo",
  repo,
  "--clobber",
]);
// All assets are uploaded while the release is invisible to clients.
run([
  "release",
  "edit",
  tag,
  "--repo",
  repo,
  "--draft=false",
  "--latest",
  "--notes-file",
  notesPath,
]);
console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
