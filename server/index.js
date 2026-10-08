import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, outputTokenCap, pairSuggestions, parseModelJson } from "../src/logic.js";
import { readPublicPage } from "./read-page.js";
import { CASE_COUNT } from "./plans.js";
import { grantFailedCase, issueLicense, listLicenses, openRetry, recordFinalFailure, releaseSections, reserveSections, takeRetry, updateLicense } from "./store.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8787);
const adminToken = process.env.ADMIN_TOKEN || "editor-dev";
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const geminiFile = process.env.LICENSE_PATH
  ? path.join(path.dirname(process.env.LICENSE_PATH), "gemini.key")
  : path.join(root, "server/data/gemini.key");

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

async function readableLicense(licenseKey) {
  const key = String(licenseKey || "").trim();
  const licenses = await listLicenses();
  const found = licenses.find((item) => item.license_key === key);
  if (!found) throw new Error("키를 찾지 못했습니다.");
  if (found.status !== "active") throw new Error("정지된 키입니다.");
  if (found.expires_at && todayKst() > found.expires_at) throw new Error("사용 기간이 끝났습니다.");
  return found;
}

function sanitizeBlocks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((block, index) => ({
    id: String(block?.id || `b${index + 1}`),
    role: String(block?.role || "설명").slice(0, 20),
    original: String(block?.original || "").replace(/\s+/g, " ").trim().slice(0, 500),
    top: Number(block?.top) || index * 40,
    left: 0,
  })).filter((block) => block.original.length >= 2);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function authorized(req) {
  return req.headers["x-admin-token"] === adminToken;
}

async function currentGeminiKey() {
  const fromEnv = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (fromEnv.trim()) return fromEnv.trim();
  try {
    return (await readFile(geminiFile, "utf8")).trim();
  } catch {
    return "";
  }
}

async function gemini(prompt, images, slotCount) {
  const geminiKey = await currentGeminiKey();
  if (!geminiKey) throw new Error("서버에 Gemini 키가 없습니다. 운영 콘솔에서 키를 저장해 주세요.");
  const parts = [];
  if (images?.length) parts.push({ text: "참고 페이지 캡처다. 이미지는 페이지 위쪽부터 순서대로다." });
  for (const image of images || []) parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
  parts.push({ text: prompt });
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: outputTokenCap(slotCount),
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "LOW" },
        },
      }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Gemini 요청이 실패했습니다.");
  const out = data.candidates?.[0]?.content?.parts || [];
  const visible = out.filter((part) => part.text && !part.thought).map((part) => part.text).join("");
  const text = visible || out.filter((part) => part.text).map((part) => part.text).join("");
  if (!text) throw new Error("모델이 문구를 반환하지 않았습니다.");
  return text;
}

async function staticFile(res, filePath) {
  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    send(res, 200, body, types[ext] || "application/octet-stream");
  } catch {
    send(res, 404, { message: "페이지를 찾지 못했습니다." });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/license") {
      const body = await readBody(req);
      const licenses = await listLicenses();
      const found = licenses.find((item) => item.license_key === String(body.licenseKey || "").trim());
      if (!found) {
        send(res, 404, { message: "키를 찾지 못했습니다." });
        return;
      }
      send(res, 200, found);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/read-page") {
      const body = await readBody(req);
      await readableLicense(body.licenseKey);
      send(res, 200, await readPublicPage(body.url));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readBody(req);
      const key = String(body.licenseKey || "").trim();
      const sectionCount = CASE_COUNT;
      let page = null;
      let blocks = sanitizeBlocks(body.blocks);
      const givenPrompt = String(body.prompt || "").trim();
      if (!givenPrompt && !blocks.length) {
        if (!body.url) throw new Error("캡처할 주소를 넣어 주세요.");
        page = await readPublicPage(body.url);
        blocks = page.blocks;
      }
      const retrying = await takeRetry(key);
      let reserved = false;
      const prompt = givenPrompt || buildPrompt({
        direction: body.direction,
        businessName: body.businessName,
        tone: body.tone,
        pageTitle: body.pageTitle || page?.title || "",
        pageUrl: body.pageUrl || page?.url || body.url || "",
        blocks,
      });
      try {
        const usage = await reserveSections(key, sectionCount);
        reserved = true;
        const text = await gemini(prompt, body.images, body.slotCount || blocks.length);
        const rows = pairSuggestions(blocks, parseModelJson(text));
        send(res, 200, { text, rows, title: page?.title || body.pageTitle || "", url: page?.url || body.pageUrl || "", ...usage });
      } catch (error) {
        if (!reserved) {
          if (retrying) await openRetry(key);
          throw error;
        }
        if (!retrying) {
          await releaseSections(key, sectionCount);
          await openRetry(key);
          const retryError = new Error(`${error.message || "문구 생성에 실패했습니다."} 한 번만 더 만들 수 있습니다.`);
          retryError.retry = true;
          throw retryError;
        }
        const outcome = await recordFinalFailure(key, { message: error.message, sections: sectionCount });
        const finalError = new Error(outcome.canRestore
          ? "처음부터 새로 만드세요. 실패한 건수는 자동으로 관리자에게 보고되고, 관리자의 승인 후에 다시 추가됩니다."
          : "처음부터 새로 만드세요. 실패 건 추가는 한 번만 되어 더는 추가되지 않습니다.");
        finalError.lock = true;
        throw finalError;
      }
      return;
    }
    if (url.pathname.startsWith("/admin/")) {
      if (!authorized(req)) {
        send(res, 401, { message: "관리자 토큰이 맞지 않습니다." });
        return;
      }
      if (req.method === "GET" && url.pathname === "/admin/gemini-key") {
        const key = await currentGeminiKey();
        send(res, 200, { configured: Boolean(key), tail: key ? key.slice(-4) : "" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/admin/gemini-key") {
        const body = await readBody(req);
        const apiKey = String(body.apiKey || "").trim();
        if (apiKey.length < 10) {
          send(res, 400, { message: "Gemini 키를 입력해 주세요." });
          return;
        }
        await mkdir(path.dirname(geminiFile), { recursive: true });
        await writeFile(geminiFile, apiKey);
        send(res, 200, { configured: true, tail: apiKey.slice(-4) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/admin/licenses") {
        send(res, 200, { licenses: await listLicenses() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/admin/licenses") {
        const body = await readBody(req);
        send(res, 200, await issueLicense(body));
        return;
      }
      const note = url.pathname.match(/^\/admin\/licenses\/([^/]+)\/note$/);
      const extend = url.pathname.match(/^\/admin\/licenses\/([^/]+)\/extend$/);
      const status = url.pathname.match(/^\/admin\/licenses\/([^/]+)\/status$/);
      const restore = url.pathname.match(/^\/admin\/licenses\/([^/]+)\/restore-case$/);
      if (req.method === "POST" && note) {
        const body = await readBody(req);
        send(res, 200, await updateLicense(decodeURIComponent(note[1]), { note: body.note }));
        return;
      }
      if (req.method === "POST" && extend) {
        const body = await readBody(req);
        send(res, 200, await updateLicense(decodeURIComponent(extend[1]), { extendDays: body.days || 30 }));
        return;
      }
      if (req.method === "POST" && status) {
        const body = await readBody(req);
        send(res, 200, await updateLicense(decodeURIComponent(status[1]), { status: body.status }));
        return;
      }
      if (req.method === "POST" && restore) {
        send(res, 200, await grantFailedCase(decodeURIComponent(restore[1])));
        return;
      }
    }
    if (req.method === "GET" && (url.pathname === "/privacy" || url.pathname === "/privacy/")) {
      await staticFile(res, path.join(root, "web/privacy.html"));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/app" || url.pathname === "/app/")) {
      await staticFile(res, path.join(root, "web/index.html"));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/ops" || url.pathname === "/ops/")) {
      await staticFile(res, path.join(root, "ops/index.html"));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/ops/")) {
      await staticFile(res, path.join(root, "ops", path.basename(url.pathname)));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/web/")) {
      await staticFile(res, path.join(root, url.pathname.slice(1)));
      return;
    }
    send(res, 404, { message: "경로를 찾지 못했습니다." });
  } catch (error) {
    send(res, 400, {
      message: error.message || "요청을 처리하지 못했습니다.",
      lock: Boolean(error.lock),
      retry: Boolean(error.retry),
    });
  }
});

server.listen(port, () => {
  console.log(`1분에디터 고객 웹  http://127.0.0.1:${port}/`);
  console.log(`운영 콘솔          http://127.0.0.1:${port}/ops/`);
  if (!process.env.ADMIN_TOKEN) console.log("ADMIN_TOKEN 미설정. 로컬 토큰은 editor-dev 입니다.");
  currentGeminiKey().then((key) => {
    if (!key) console.log("Gemini 키 없음. 운영 콘솔에서 저장하거나 GEMINI_API_KEY를 넣으세요.");
  });
});

