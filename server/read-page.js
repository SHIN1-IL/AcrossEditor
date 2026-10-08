import { lookup } from "node:dns/promises";
import { mergeBlocks } from "../src/logic.js";

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;

export function normalizePageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("캡처할 주소를 넣어 주세요.");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("주소 형식이 아닙니다.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http 또는 https 주소만 읽을 수 있습니다.");
  }
  if (url.username || url.password) throw new Error("이 주소는 읽을 수 없습니다.");
  return url;
}

export function isPublicAddress(address) {
  const host = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "::1" || host === "0.0.0.0") return false;
  const mapped = host.startsWith("::ffff:") ? host.slice(7) : host;
  const parts = mapped.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  return host.includes(":");
}

async function assertPublic(url) {
  if (isNameBlocked(url.hostname)) throw new Error("이 주소는 읽을 수 없습니다.");
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(literal) && !isPublicAddress(literal)) throw new Error("이 주소는 읽을 수 없습니다.");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("이 주소는 읽을 수 없습니다.");
  }
}

function isIpLiteral(host) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
}

function isNameBlocked(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(parseInt(code, 16)));
}

function safeCodePoint(code) {
  if (!Number.isInteger(code) || code < 32 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

function plainText(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function extractHtmlBlocks(html) {
  const source = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const title = plainText((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const blocks = [];
  const seen = new Set();
  const pattern = /<(h[1-6]|p|li|button|a|dt|dd|figcaption|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(source)) && blocks.length < 80) {
    const original = plainText(match[2]);
    if (original.length < 2 || original.length > 500 || seen.has(original)) continue;
    seen.add(original);
    blocks.push({
      original,
      tag: match[1].toLowerCase(),
      top: blocks.length * 40,
      left: 0,
      width: 320,
      height: 28,
    });
  }
  const merged = mergeBlocks([blocks]);
  return { title, blocks: merged.blocks };
}

async function fetchHtml(start) {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(current);
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "AcrossEditor/1.0",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("페이지 이동 주소를 읽지 못했습니다.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error("페이지를 열지 못했습니다.");
    const type = response.headers.get("content-type") || "";
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new Error("이 주소는 글이 있는 홈페이지가 아닙니다.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error("페이지가 너무 커서 읽지 못했습니다.");
    const charset = (type.match(/charset=([^;]+)/i)?.[1] || "utf-8").trim().replace(/^"|"$/g, "");
    try {
      return { url: current.href, html: new TextDecoder(charset).decode(bytes) };
    } catch {
      return { url: current.href, html: bytes.toString("utf8") };
    }
  }
  throw new Error("페이지 이동이 너무 많습니다.");
}

export async function readPublicPage(value) {
  const url = normalizePageUrl(value);
  const page = await fetchHtml(url);
  const extracted = extractHtmlBlocks(page.html);
  if (!extracted.blocks.length && !extracted.title) {
    throw new Error("이 주소에서 글자를 찾지 못했습니다. 화면이 스크립트로만 그려지는 페이지일 수 있습니다.");
  }
  return { url: page.url, title: extracted.title, blocks: extracted.blocks };
}
