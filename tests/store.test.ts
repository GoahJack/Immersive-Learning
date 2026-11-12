import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshData } from "../core/engine";
import { IncompatibleDataError, parseData, Store } from "../core/store";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Store(dir);
}
test("save reload and recover valid backup while preserving damaged primary", (t) => {
  const store = fixture(t);
  const d = freshData();
  store.save(d);
  d.settings.stages = true;
  store.save(d);
  assert.equal(store.load().settings.stages, true);
  fs.writeFileSync(store.file, "broken");
  const recovered = store.load();
  assert.equal(recovered.settings.stages, false);
  assert.ok(store.notice);
  assert.ok(
    fs
      .readdirSync(path.dirname(store.file))
      .some((x) => x.includes(".damaged-")),
  );
});
test("both damaged files stop load without overwriting originals", (t) => {
  const store = fixture(t);
  fs.writeFileSync(store.file, "broken");
  fs.writeFileSync(store.file + ".bak", "also broken");
  assert.throws(() => store.load(), /无法读取/);
  assert.equal(fs.readFileSync(store.file, "utf8"), "broken");
});
test("future version is rejected instead of silently loading an old backup", (t) => {
  const store = fixture(t);
  store.save(freshData());
  store.save(freshData());
  fs.writeFileSync(store.file, JSON.stringify({ schemaVersion: 2 }));
  assert.throws(() => store.load(), IncompatibleDataError);
  assert.equal(
    JSON.parse(fs.readFileSync(store.file, "utf8")).schemaVersion,
    2,
  );
});
test("invalid nested state rejected; write failure preserves previous data", (t) => {
  const store = fixture(t);
  store.save(freshData());
  const d = freshData();
  (d.settings as unknown as Record<string, unknown>).sound = "yes";
  assert.throws(() => parseData(JSON.stringify(d)));
  assert.throws(() => store.save(d));
  assert.equal(store.load().settings.sound, false);
  fs.mkdirSync(store.file + ".tmp");
  assert.throws(() => store.save(freshData()));
  assert.equal(store.load().settings.sound, false);
});
