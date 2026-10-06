import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("a standard key stops after the daily section cap", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editor-store-"));
  const storePath = path.join(dir, "licenses.json");
  process.env.EDITOR_STORE = storePath;
  const store = await import(`../server/store.js?case=${Date.now()}`);
  const issued = await store.issueLicense({ plan: "standard", days: 30, note: "테스트" });
  assert.equal(issued.monthly_limit, 15);
  assert.equal(issued.daily_limit, 8);
  await store.reserveSections(issued.license_key, 8);
  await assert.rejects(() => store.reserveSections(issued.license_key, 1), /오늘 한도/);
  await rm(dir, { recursive: true });
});

test("one capture counts as one case", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editor-store-"));
  process.env.EDITOR_STORE = path.join(dir, "licenses.json");
  const store = await import(`../server/store.js?one=${Date.now()}`);
  const issued = await store.issueLicense({ plan: "standard", days: 30, note: "1건" });
  await store.reserveSections(issued.license_key, 1);
  const listed = await store.listLicenses();
  const row = listed.find((item) => item.license_key === issued.license_key);
  assert.equal(row.daily_used, 1);
  assert.equal(row.monthly_used, 1);
  await rm(dir, { recursive: true });
});

test("a second failure is reported once and restored once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editor-store-"));
  const storePath = path.join(dir, "licenses.json");
  process.env.EDITOR_STORE = storePath;
  const store = await import(`../server/store.js?retry=${Date.now()}`);
  const issued = await store.issueLicense({ plan: "standard", days: 30, note: "재시도" });
  const key = issued.license_key;
  await store.reserveSections(key, 2);
  await store.releaseSections(key, 2);
  await store.openRetry(key);
  assert.equal(await store.takeRetry(key), true);
  assert.equal(await store.takeRetry(key), false);
  await store.reserveSections(key, 2);
  const reported = await store.recordFinalFailure(key, { message: "Gemini 오류", sections: 2 });
  assert.equal(reported.canRestore, true);
  const again = await store.recordFinalFailure(key, { message: "또 실패", sections: 2 });
  assert.equal(again.canRestore, false);
  const listed = await store.listLicenses();
  const row = listed.find((item) => item.license_key === key);
  assert.equal(row.failure_message, "Gemini 오류");
  assert.equal(row.monthly_used, 2);
  const restored = await store.grantFailedCase(key);
  assert.equal(restored.monthly_used, 0);
  assert.equal(restored.recovery_used, true);
  await assert.rejects(() => store.grantFailedCase(key), /한 번만/);
  await rm(dir, { recursive: true });
});
