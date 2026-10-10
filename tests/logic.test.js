import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrompt,
  canCapture,
  normalizeCaptureUrl,
  formatCopyAll,
  mergeBlocks,
  layoutPages,
  outputScale,
  pairSuggestions,
  blocksForSections,
  limitSlots,
  outputTokenCap,
  zoomCrop,
  parseModelJson,
  planShot,
  sampleIndexes,
  selectCopyBlocks,
  slicePlan,
} from "../src/logic.js";

test("accepts a bare host as a capture address", () => {
  assert.equal(normalizeCaptureUrl("acrosstool.com"), "https://acrosstool.com/");
  assert.equal(normalizeCaptureUrl("https://example.com/about"), "https://example.com/about");
  assert.equal(normalizeCaptureUrl("  "), "");
  assert.throws(() => normalizeCaptureUrl("javascript:alert(1)"), /http 또는 https/);
});

test("pairs suggestions by order when ids do not match", () => {
  const paired = pairSuggestions(
    [{ id: "b1", role: "제목", original: "옛" }, { id: "b2", role: "버튼", original: "더보기" }],
    [{ id: "s1", suggestion: "새 제목" }, { id: "s2", suggestion: "지금 보기" }],
  );
  assert.equal(paired[0].suggestion, "새 제목");
  assert.equal(paired[1].suggestion, "지금 보기");
});

test("captures only web pages", () => {
  assert.equal(canCapture("https://example.com/about"), true);
  assert.equal(canCapture("http://localhost:3000"), true);
  assert.equal(canCapture("chrome://extensions"), false);
  assert.equal(canCapture(""), false);
});

test("plans full viewports and the cropped last screen", () => {
  assert.deepEqual(planShot(0, 0, 1000, 2500), { srcY: 0, srcH: 1000, destY: 0 });
  assert.deepEqual(planShot(2000, 1500, 1000, 2500), { srcY: 500, srcH: 500, destY: 2000 });
  assert.equal(planShot(2500, 1500, 1000, 2500).srcH, 0);
});

test("scales wide and very tall pages down", () => {
  assert.ok(Math.abs(outputScale(1440, 8000) - 1280 / 1440) < 0.0001);
  assert.equal(outputScale(1000, 40000), 16000 / 40000);
});

test("splits a capture into pages and keeps each line on its page", () => {
  const pages = layoutPages(
    [
      { id: "b1", top: 40, left: 0, suggestion: "위" },
      { id: "b2", top: 1000, left: 0, suggestion: "경계" },
      { id: "b3", top: 1500, left: 20, suggestion: "아래" },
      { id: "b4", top: 9000, left: 0, suggestion: "넘침" },
    ],
    { canvasHeight: 1000, capturedCssHeight: 2000, pageCssHeight: 1000 },
  );
  assert.equal(pages.length, 2);
  assert.equal(pages[0].canvasHeight, 500);
  assert.deepEqual(pages[0].rows.map((row) => row.id), ["b1"]);
  assert.deepEqual(pages[1].rows.map((row) => row.id), ["b2", "b3", "b4"]);
});

test("spreads unpositioned lines across the pages in order", () => {
  const pages = layoutPages(
    [
      { id: "s1", suggestion: "하나" },
      { id: "s2", suggestion: "둘" },
      { id: "s3", suggestion: "셋" },
      { id: "s4", suggestion: "넷" },
    ],
    { canvasHeight: 600, capturedCssHeight: 1800, pageCssHeight: 900 },
  );
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].rows.map((row) => row.id), ["s1", "s2"]);
  assert.deepEqual(pages[1].rows.map((row) => row.id), ["s3", "s4"]);
});

test("enlarges a short text crop", () => {
  const crop = zoomCrop(
    {
      top: 100,
      left: 40,
      width: 80,
      height: 24,
      lines: [{ top: 100, left: 40, width: 80, height: 24 }],
    },
    {
      canvasWidth: 1000,
      canvasHeight: 2000,
      capturedCssWidth: 1000,
      capturedCssHeight: 2000,
      maxWidth: 420,
    },
  );
  assert.ok(crop.destW > 80);
  assert.ok(crop.destW <= 420);
  assert.ok(crop.destH > 24);
});

test("fits a wide text crop inside the banner", () => {
  const crop = zoomCrop(
    { top: 10, left: 0, width: 900, height: 80 },
    {
      canvasWidth: 900,
      canvasHeight: 800,
      capturedCssWidth: 900,
      capturedCssHeight: 800,
      maxWidth: 420,
    },
  );
  assert.ok(crop.destW <= 420);
  assert.ok(crop.destW > 300);
});

test("skips a crop when the text box is missing", () => {
  assert.equal(
    zoomCrop({ top: 10, left: 10 }, { canvasWidth: 400, canvasHeight: 800, capturedCssWidth: 400, capturedCssHeight: 800 }),
    null,
  );
});

test("samples image slices across the page", () => {
  assert.deepEqual(sampleIndexes(4, 6), [0, 1, 2, 3]);
  assert.deepEqual(sampleIndexes(10, 3), [0, 5, 9]);
  const slices = slicePlan(5000, 1400, 6);
  assert.equal(slices.length, 4);
  assert.equal(slices[0].start, 0);
  assert.ok(slices.at(-1).start + slices.at(-1).height <= 5000);
});

test("dedupes text slots and keeps both ends when the page is long", () => {
  const many = Array.from({ length: 100 }, (_, index) => ({
    original: `문장 ${index}`,
    top: index * 100,
    left: 0,
    tag: "p",
    role: "설명",
  }));
  const merged = mergeBlocks([many, [many[0], { original: "문장 0", top: 4, left: 0, tag: "p" }]]);
  assert.equal(merged.truncated, true);
  assert.equal(merged.blocks.length, 80);
  assert.equal(merged.blocks[0].id, "b1");
  assert.equal(merged.blocks[0].original, "문장 0");
  assert.equal(merged.blocks.at(-1).original, "문장 99");
});

test("joins overlapping text into one and keeps separated text apart", () => {
  const merged = mergeBlocks([[
    { original: "메뉴일", top: 20, left: 10, width: 40, height: 30, role: "버튼", tag: "a" },
    { original: "메뉴이", top: 40, left: 10, width: 40, height: 30, role: "버튼", tag: "a" },
    { original: "메뉴삼", top: 55, left: 12, width: 40, height: 30, role: "버튼", tag: "a" },
    { original: "떨어진 제목", top: 20, left: 200, width: 80, height: 24, role: "제목", tag: "h2" },
    { original: "아래 설명", top: 120, left: 200, width: 80, height: 24, role: "설명", tag: "p" },
  ]]);
  assert.deepEqual(merged.blocks.map((block) => block.original), ["메뉴일\n메뉴이\n메뉴삼", "떨어진 제목", "아래 설명"]);
});

test("joins a tight preview cluster and keeps a clear gap separate", () => {
  const merged = mergeBlocks([[
    { original: "첫줄", top: 10, left: 10, width: 180, height: 18, role: "설명", tag: "p" },
    { original: "둘째줄", top: 32, left: 10, width: 180, height: 18, role: "설명", tag: "p" },
    { original: "옆칸", top: 10, left: 240, width: 80, height: 18, role: "설명", tag: "p" },
    { original: "아래칸", top: 90, left: 10, width: 180, height: 18, role: "설명", tag: "p" },
  ]]);
  assert.deepEqual(merged.blocks.map((block) => block.original), ["첫줄\n둘째줄", "옆칸", "아래칸"]);
  assert.equal(merged.blocks[0].top, 10);
  assert.equal(merged.blocks[0].height, 40);
});

test("keeps advertising lines and holds login, cart, and footer text", () => {
  const merged = mergeBlocks([[
    { original: "건강한 아침", top: 10, left: 0, tag: "h1", role: "제목" },
    { original: "로그인", top: 12, left: 200, tag: "a", role: "버튼" },
    { original: "장바구니", top: 12, left: 260, tag: "a", role: "버튼" },
    { original: "당일 구운 식빵", top: 400, left: 0, tag: "p", role: "설명" },
    { original: "서울시 성동구 주소: 연무장길", top: 2400, left: 0, tag: "p", inFooter: true },
    { original: "Copyright 2026", top: 2500, left: 0, tag: "p", nearBottom: true },
  ]]);
  assert.deepEqual(merged.blocks.map((block) => block.original), ["건강한 아침", "당일 구운 식빵"]);
  assert.equal(merged.held.length, 4);

  const kept = selectCopyBlocks(merged.blocks, merged.held, "성수동 수제 빵집");
  assert.deepEqual(kept.blocks.map((block) => block.original), ["건강한 아침", "당일 구운 식빵"]);
  assert.equal(kept.omitted, 4);

  const withFooter = selectCopyBlocks(merged.blocks, merged.held, "하단 푸터의 회사 정보도 다듬어 줘");
  assert.ok(withFooter.blocks.some((block) => block.inFooter));
  assert.ok(withFooter.blocks.every((block) => block.original !== "로그인"));
});

test("parses a json object wrapped in extra model text", () => {
  const parsed = parseModelJson('작성 결과입니다. {"blocks":[{"id":"b2","role":"버튼","original":"더 보기","suggestion":"메뉴 보기"}]} 끝');
  assert.equal(parsed[0].suggestion, "메뉴 보기");
});

test("parses fenced model json and pairs it onto the captured slots", () => {
  const parsed = parseModelJson("```json\n{\"blocks\":[{\"id\":\"b1\",\"role\":\"제목\",\"original\":\"옛 제목\",\"suggestion\":\"새 제목\"}]}\n```");
  const paired = pairSuggestions(
    [{ id: "b1", role: "설명", original: "옛 제목" }, { id: "b2", role: "버튼", original: "더 보기" }],
    parsed,
  );
  assert.equal(paired[0].suggestion, "새 제목");
  assert.equal(paired[0].role, "제목");
  assert.equal(paired[1].suggestion, "");
  assert.match(formatCopyAll(paired), /\[제목\]\n새 제목/);
});

test("prompt carries the new site direction and forbids invented facts", () => {
  const prompt = buildPrompt({
    direction: "성수동 수제 빵집",
    businessName: "오전빵",
    tone: "담백하게",
    pageKind: "메인 탭",
    pageTitle: "참고 홈",
    pageUrl: "https://example.com",
    blocks: [{ id: "b1", role: "제목", original: "건강한 아침" }],
  });
  assert.match(prompt, /성수동 수제 빵집/);
  assert.match(prompt, /오전빵/);
  assert.match(prompt, /세련되고 멋진 광고 문장/);
  assert.match(prompt, /\[직접 입력\]/);
  assert.match(prompt, /"id":"b1"/);
  assert.match(prompt, /"suggestion":"\.\.\."/);
  assert.match(prompt, /id와 suggestion만/);
  assert.match(prompt, /이미지는 첨부하지 않는다/);
});

test("keeps at most nine slots on one screen by merging the closest", () => {
  const blocks = Array.from({ length: 10 }, (_, index) => ({
    original: `줄${index}`,
    top: index * 30,
    left: 10,
    width: 80,
    height: 18,
    role: "설명",
  }));
  const limited = limitSlots(blocks, 9);
  assert.equal(limited.length, 9);
  assert.ok(limited.some((block) => block.original.includes("\n")));
});

test("bills only the selected sections and caps each one", () => {
  const blocks = Array.from({ length: 12 }, (_, index) => ({
    original: `구간글${index}`,
    top: index < 6 ? 40 + index * 20 : 900 + index * 20,
    left: 12,
    width: 100,
    height: 16,
    role: "설명",
    tag: "p",
  }));
  const picked = blocksForSections(blocks, [], "성수동 빵집", {
    capturedCssHeight: 1800,
    pageCssHeight: 800,
    selectedIndexes: [0],
    maxSlots: 9,
  });
  assert.equal(picked.sectionCount, 1);
  assert.ok(picked.blocks.length <= 9);
  assert.ok(picked.blocks.every((block) => Number(block.top) < 800));
});

test("caps output tokens with the slot count", () => {
  assert.equal(outputTokenCap(1), 768);
  assert.equal(outputTokenCap(9), 1620);
  assert.equal(outputTokenCap(80), 8192);
});

test("prompt asks for fresh sections when the page has no text slots", () => {
  const prompt = buildPrompt({
    direction: "성수동 수제 빵집",
    businessName: "",
    tone: "담백하게",
    pageKind: "상세 탭",
    pageTitle: "",
    pageUrl: "",
    blocks: [],
  });
  assert.match(prompt, /글자 칸을 찾지 못했다/);
  assert.match(prompt, /성수동 수제 빵집/);
  assert.match(prompt, /"id":"s1"/);
});
