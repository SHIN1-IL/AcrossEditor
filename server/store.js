import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, SAFETY_WON, planOf } from "./plans.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const file = path.join(root, "licenses.json");

function todayKst(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthKey(iso) {
  return iso.slice(0, 7);
}

function storeFile() {
  return process.env.LICENSE_PATH || process.env.EDITOR_STORE || file;
}

async function load() {
  try {
    return JSON.parse(await readFile(storeFile(), "utf8"));
  } catch {
    return { licenses: [] };
  }
}

async function save(data) {
  const target = storeFile();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(data, null, 2));
}

function freshUsage(license, day) {
  if (license.daily_date !== day) {
    license.daily_date = day;
    license.daily_used = 0;
  }
  const month = monthKey(day);
  if (license.monthly_key !== month) {
    license.monthly_key = month;
    license.monthly_used = 0;
    license.spend_won = 0;
  }
}

export function publicLicense(license) {
  const day = todayKst();
  freshUsage(license, day);
  return {
    license_key: license.license_key,
    plan: license.plan,
    plan_label: license.plan_label,
    status: license.status,
    started_at: license.started_at || "",
    expires_at: license.expires_at || "",
    duration_days: license.duration_days,
    daily_used: license.daily_used || 0,
    daily_limit: license.daily_limit,
    monthly_used: license.monthly_used || 0,
    monthly_limit: license.monthly_limit,
    note: license.note || "",
    failure_message: license.failure_report?.message || "",
    failure_at: license.failure_report?.at || "",
    failure_sections: license.failure_report?.sections || 0,
    failure_restored: Boolean(license.failure_report?.restored),
    recovery_used: Boolean(license.recovery_used),
  };
}

export async function listLicenses() {
  const data = await load();
  return data.licenses.map(publicLicense);
}

export async function issueLicense({ plan, days, note }) {
  const spec = planOf(plan);
  if (!spec) throw new Error("없는 플랜입니다.");
  const data = await load();
  const license = {
    license_key: (() => {
      const raw = randomBytes(6).toString("hex").toUpperCase();
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    })(),
    plan,
    plan_label: spec.label,
    status: "active",
    duration_days: Number(days) || 30,
    started_at: "",
    expires_at: "",
    daily_limit: spec.daily,
    monthly_limit: spec.monthly,
    spend_cap: spec.spendCap,
    daily_date: "",
    daily_used: 0,
    monthly_key: "",
    monthly_used: 0,
    spend_won: 0,
    note: note || "",
  };
  data.licenses.unshift(license);
  await save(data);
  return publicLicense(license);
}

function findMutable(data, key) {
  const license = data.licenses.find((item) => item.license_key === key);
  if (!license) throw new Error("키를 찾지 못했습니다.");
  return license;
}

export async function updateLicense(key, patch) {
  const data = await load();
  const license = findMutable(data, key);
  if (patch.note !== undefined) license.note = String(patch.note);
  if (patch.status) license.status = patch.status;
  if (patch.extendDays) {
    const day = todayKst();
    const base = license.expires_at && license.expires_at > day ? license.expires_at : day;
    license.expires_at = addDays(base, Number(patch.extendDays));
    if (!license.started_at) license.started_at = day;
  }
  await save(data);
  return publicLicense(license);
}

function readyLicense(license, count) {
  if (license.status !== "active") throw new Error("정지된 키입니다.");
  const day = todayKst();
  if (!license.started_at) {
    license.started_at = day;
    license.expires_at = addDays(day, license.duration_days || 30);
  }
  if (license.expires_at && day > license.expires_at) throw new Error("사용 기간이 끝났습니다.");
  freshUsage(license, day);
  if (license.daily_used + count > license.daily_limit) {
    throw new Error(`오늘 한도 ${license.daily_limit}건을 넘습니다. 내일 다시 만들 수 있습니다.`);
  }
  if (license.monthly_used + count > license.monthly_limit) {
    throw new Error(`이번 달 한도 ${license.monthly_limit}건을 넘습니다. 추가 건이 필요하면 운영자에게 문의하세요.`);
  }
  const nextSpend = (license.spend_won || 0) + count * SAFETY_WON;
  const cap = planOf(license.plan)?.spendCap || license.spend_cap || 3600;
  if (nextSpend > cap) {
    throw new Error("이번 달 포함 생성이 원가 상한에 닿았습니다. 추가 건으로 이어갈 수 있습니다.");
  }
  return nextSpend;
}

export async function reserveSections(key, sectionCount) {
  const count = Math.max(1, Number(sectionCount) || 1);
  const data = await load();
  const license = findMutable(data, key.trim());
  const nextSpend = readyLicense(license, count);
  license.daily_used += count;
  license.monthly_used += count;
  license.spend_won = nextSpend;
  await save(data);
  return publicLicense(license);
}

export async function releaseSections(key, sectionCount) {
  const count = Math.max(1, Number(sectionCount) || 1);
  const data = await load();
  const license = findMutable(data, String(key || "").trim());
  license.daily_used = Math.max(0, (license.daily_used || 0) - count);
  license.monthly_used = Math.max(0, (license.monthly_used || 0) - count);
  license.spend_won = Math.max(0, (license.spend_won || 0) - count * SAFETY_WON);
  await save(data);
}

export async function takeRetry(key) {
  const data = await load();
  const license = findMutable(data, String(key || "").trim());
  const retrying = Boolean(license.retry_open);
  if (retrying) {
    license.retry_open = false;
    await save(data);
  }
  return retrying;
}

export async function openRetry(key) {
  const data = await load();
  const license = findMutable(data, String(key || "").trim());
  license.retry_open = true;
  await save(data);
}

export async function recordFinalFailure(key, { message, sections }) {
  const data = await load();
  const license = findMutable(data, String(key || "").trim());
  license.retry_open = false;
  const canRestore = !license.recovery_used && !license.failure_report;
  if (canRestore) {
    license.failure_report = {
      message: String(message || ""),
      at: new Date().toISOString(),
      sections: Math.max(1, Number(sections) || 1),
      restored: false,
    };
  }
  await save(data);
  return { canRestore };
}

export async function grantFailedCase(key) {
  const data = await load();
  const license = findMutable(data, String(key || "").trim());
  if (license.recovery_used) throw new Error("실패 건 추가는 한 번만 할 수 있습니다.");
  if (!license.failure_report || license.failure_report.restored) throw new Error("보고된 실패 건이 없습니다.");
  const count = Math.max(1, Number(license.failure_report.sections) || 1);
  freshUsage(license, todayKst());
  license.daily_used = Math.max(0, (license.daily_used || 0) - count);
  license.monthly_used = Math.max(0, (license.monthly_used || 0) - count);
  license.spend_won = Math.max(0, (license.spend_won || 0) - count * SAFETY_WON);
  license.recovery_used = true;
  license.failure_report = { ...license.failure_report, restored: true };
  license.retry_open = false;
  await save(data);
  return publicLicense(license);
}

export { PLANS };
