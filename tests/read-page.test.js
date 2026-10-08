import assert from "node:assert/strict";
import test from "node:test";
import { extractHtmlBlocks, isPublicAddress, normalizePageUrl } from "../server/read-page.js";

test("adds https to a bare host", () => {
  assert.equal(normalizePageUrl("www.acrossflare.com").href, "https://www.acrossflare.com/");
});

test("rejects local addresses", () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("10.0.0.8"), false);
  assert.equal(isPublicAddress("192.168.0.1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("::1"), false);
});

test("reads headings and paragraphs from html", () => {
  const page = extractHtmlBlocks(`
    <html><head><title>봄 자켓</title><style>body{}</style></head>
    <body>
      <script>alert(1)</script>
      <h1>당일출고 자켓</h1>
      <p>가벼운 봄 자켓을 오늘 보냅니다.</p>
      <a href="/cart">장바구니</a>
      <button>구매하기</button>
    </body></html>
  `);
  assert.equal(page.title, "봄 자켓");
  assert.ok(page.blocks.some((block) => block.original.includes("당일출고")));
  assert.equal(page.blocks.some((block) => block.original === "장바구니"), false);
});
