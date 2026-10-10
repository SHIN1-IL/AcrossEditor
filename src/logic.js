export const BLOCK_LIMIT = 80;

export const PROVIDERS = {
  gemini: {
    label: "Gemini",
    defaultModel: "gemini-3.5-flash",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4.1-mini",
  },
};

export function canCapture(url) {
  return /^https?:\/\//i.test(url || "");
}

export function normalizeCaptureUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("주소 형식이 아닙니다. example.com 처럼 입력해 주세요.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http 또는 https 주소만 열 수 있습니다.");
  }
  if (url.username || url.password) throw new Error("이 주소는 열 수 없습니다.");
  return url.href;
}

export function planShot(covered, scrollY, viewportHeight, totalHeight) {
  const srcY = Math.max(0, covered - scrollY);
  const srcH = Math.max(0, Math.min(viewportHeight - srcY, totalHeight - covered));
  return { srcY, srcH, destY: covered };
}

export function outputScale(viewportWidth, totalHeight, maxWidth = 1280, maxHeight = 16000) {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, totalHeight);
  let scale = Math.min(1, maxWidth / width);
  if (height * scale > maxHeight) scale = maxHeight / height;
  return scale;
}

export function sampleIndexes(count, max) {
  if (count <= max) return Array.from({ length: count }, (_, index) => index);
  const last = count - 1;
  const indexes = [];
  for (let step = 0; step < max; step += 1) {
    indexes.push(Math.round((step * last) / (max - 1)));
  }
  return [...new Set(indexes)];
}

function compactLines(lines) {
  if (!Array.isArray(lines)) return undefined;
  const compact = lines
    .filter((line) => ["top", "left", "width", "height"].every((key) => Number.isFinite(Number(line?.[key]))))
    .slice(0, 8)
    .map((line) => ({
      top: Number(line.top),
      left: Number(line.left),
      width: Number(line.width),
      height: Number(line.height),
    }));
  return compact.length ? compact : undefined;
}

export function zoomCrop(row, {
  canvasWidth,
  canvasHeight,
  capturedCssWidth,
  capturedCssHeight,
  padX = 12,
  padY = 8,
  maxWidth = 420,
} = {}) {
  const width = Number(row?.width);
  const height = Number(row?.height);
  const left = Number(row?.left);
  const top = Number(row?.top);
  const boxW = Math.max(0, Number(canvasWidth) || 0);
  const boxH = Math.max(0, Number(canvasHeight) || 0);
  if (boxW < 2 || boxH < 2) return null;
  if (![width, height, left, top].every((value) => Number.isFinite(value)) || width < 2 || height < 2) return null;

  const scaleX = boxW / Math.max(1, Number(capturedCssWidth) || boxW);
  const scaleY = boxH / Math.max(1, Number(capturedCssHeight) || boxH);
  const x = left * scaleX;
  const y = top * scaleY;
  const w = Math.max(1, width * scaleX);
  const h = Math.max(1, height * scaleY);
  let srcX = x - padX * scaleX;
  let srcY = y - padY * scaleY;
  let srcW = w + padX * scaleX * 2;
  let srcH = h + padY * scaleY * 2;
  srcX = Math.min(boxW - 1, Math.max(0, srcX));
  srcY = Math.min(boxH - 1, Math.max(0, srcY));
  srcW = Math.min(srcW, boxW - srcX);
  srcH = Math.min(srcH, boxH - srcY);
  if (srcW < 1 || srcH < 1) return null;

  const fit = maxWidth / srcW;
  const readable = Math.max(1, 64 / h);
  let zoom = Math.min(fit, readable, 4);
  if (srcW < 200) zoom = Math.min(4, fit, Math.max(zoom, Math.min(3, 200 / srcW)));
  zoom = Math.max(0.2, zoom);

  return {
    srcX,
    srcY,
    srcW,
    srcH,
    destW: Math.max(1, Math.round(srcW * zoom)),
    destH: Math.max(1, Math.round(srcH * zoom)),
  };
}

export function layoutPages(rows, { canvasHeight, capturedCssHeight, pageCssHeight }) {
  const cssHeight = Math.max(1, Number(capturedCssHeight) || Number(canvasHeight) || 1);
  const height = Math.max(1, Number(canvasHeight) || cssHeight);
  const scale = height / cssHeight;
  const pageCss = Math.max(1, Number(pageCssHeight) || cssHeight);
  const count = Math.max(1, Math.ceil(cssHeight / pageCss));
  const pages = [];
  for (let index = 0; index < count; index += 1) {
    const cssStart = index * pageCss;
    const cssEnd = Math.min(cssHeight, cssStart + pageCss);
    const canvasStart = Math.round(cssStart * scale);
    const canvasEnd = index === count - 1 ? height : Math.round(cssEnd * scale);
    pages.push({
      index,
      canvasStart,
      canvasHeight: Math.max(1, canvasEnd - canvasStart),
      cssStart,
      cssEnd,
      rows: [],
    });
  }

  const positioned = [];
  const loose = [];
  for (const row of rows || []) {
    if (Number.isFinite(Number(row?.top))) positioned.push(row);
    else loose.push(row);
  }
  for (const row of positioned) {
    const top = Number(row.top);
    let index = pages.findIndex((page, pageIndex) => top < page.cssEnd || pageIndex === pages.length - 1);
    if (index < 0) index = top < pages[0].cssStart ? 0 : pages.length - 1;
    pages[index].rows.push(row);
  }
  if (!positioned.length) {
    const size = Math.ceil(loose.length / pages.length) || 1;
    loose.forEach((row, index) => {
      pages[Math.min(pages.length - 1, Math.floor(index / size))].rows.push(row);
    });
  } else {
    pages[0].rows.push(...loose);
  }
  for (const page of pages) {
    page.rows.sort((a, b) => {
      const at = Number(a.top);
      const bt = Number(b.top);
      if (!Number.isFinite(at) || !Number.isFinite(bt)) return 0;
      return at - bt || (Number(a.left) || 0) - (Number(b.left) || 0);
    });
  }
  return pages;
}

export const SLOT_CAP = 9;

function boxGap(a, b) {
  const left = blockBox(a);
  const right = blockBox(b);
  const gapX = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
  const gapY = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
  return gapX + gapY;
}

export function limitSlots(blocks, max = SLOT_CAP) {
  const cap = Math.max(1, Number(max) || SLOT_CAP);
  let items = [...(blocks || [])];
  while (items.length > cap) {
    let pair = [0, 1];
    let best = Infinity;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const gap = boxGap(items[i], items[j]);
        if (gap < best) {
          best = gap;
          pair = [i, j];
        }
      }
    }
    const [first, second] = pair;
    const fused = fuseTextGroup(
      [items[first], items[second]].sort((a, b) => (Number(a.top) || 0) - (Number(b.top) || 0) || (Number(a.left) || 0) - (Number(b.left) || 0)),
    );
    items = items.filter((_, index) => index !== first && index !== second);
    items.push(fused);
  }
  return items.sort((a, b) => (Number(a.top) || 0) - (Number(b.top) || 0) || (Number(a.left) || 0) - (Number(b.left) || 0));
}

export function blocksForSections(blocks, held, direction, {
  capturedCssHeight,
  pageCssHeight,
  selectedIndexes,
  maxSlots = SLOT_CAP,
} = {}) {
  const copy = selectCopyBlocks(blocks, held, direction);
  const pages = layoutPages(copy.blocks, {
    canvasHeight: capturedCssHeight,
    capturedCssHeight,
    pageCssHeight,
  });
  const wanted = new Set((selectedIndexes || pages.map((page) => page.index)).map(Number));
  const chosen = pages.filter((page) => wanted.has(page.index));
  const limited = chosen.flatMap((page) => limitSlots(page.rows, maxSlots));
  return {
    omitted: copy.omitted,
    sectionCount: chosen.length,
    blocks: limited.map((block, index) => ({ ...block, id: `b${index + 1}` })),
  };
}

export function outputTokenCap(slotCount) {
  const slots = Math.max(1, Number(slotCount) || 1);
  return Math.min(8192, Math.max(768, slots * 180));
}

export function slicePlan(height, sliceHeight, maxSlices) {
  const count = Math.max(1, Math.ceil(height / sliceHeight));
  return sampleIndexes(count, maxSlices).map((index) => {
    const start = Math.min(index * sliceHeight, Math.max(0, height - 1));
    const end = Math.min(height, start + sliceHeight);
    return { start, height: Math.max(1, end - start) };
  });
}

export function roleHint(tag, text) {
  const name = String(tag || "").toLowerCase();
  const length = [...text].length;
  if (name === "h1") return "제목";
  if (name === "button" || (name === "a" && length <= 24)) return "버튼";
  if (/^h[2-4]$/.test(name) && length <= 40) return "배너";
  if (/^h[2-6]$/.test(name)) return "소제목";
  if (length <= 28) return "배너";
  return "설명";
}

const CHROME_EXACT = new Set([
  "로그인", "로그아웃", "회원가입", "가입하기", "장바구니", "카트", "cart",
  "검색", "search", "마이페이지", "mypage", "주문조회", "주문배송조회",
  "찜", "찜하기", "위시리스트", "관심상품", "공유", "공유하기",
  "맨위로", "top", "로그인/가입", "signin", "login",
]);

export function isChromeText(text) {
  const raw = String(text || "").trim();
  const compact = raw.replace(/\s+/g, "").toLowerCase();
  if (!compact || [...raw].length > 18) return false;
  if (CHROME_EXACT.has(compact)) return true;
  return /로그인|로그아웃|회원가입|장바구니|마이페이지|주문조회|위시리스트/.test(raw);
}

export function isFooterText(text) {
  return /copyright|all rights reserved|©|사업자\s*등록|통신판매|개인정보\s*처리|이용약관|이메일\s*무단/i.test(text || "");
}

function isContactLine(text) {
  const raw = String(text || "").trim();
  if ([...raw].length > 80) return false;
  return /(주소|대표|전화|팩스|이메일|운영시간|영업시간|고객센터)\s*[:：]/.test(raw) || /^\d{2,3}-\d{3,4}-\d{4}$/.test(raw);
}

export function skipKind(block) {
  const text = block?.original || "";
  if (block?.inFooter || isFooterText(text) || (block?.nearBottom && isContactLine(text))) return "footer";
  if (/장바구니|카트|cart/i.test(text) && isChromeText(text)) return "cart";
  if (/(로그인|로그아웃|회원가입|마이페이지|주문조회)/.test(text) && isChromeText(text)) return "account";
  if (isChromeText(text)) return "chrome";
  return "";
}

export function keepRequested(direction) {
  const text = String(direction || "");
  return {
    footer: /푸터|바닥글|하단\s*(정보|영역|문구|부분)|저작권|사업자/.test(text),
    account: /로그인|로그아웃|회원가입|마이페이지/.test(text),
    cart: /장바구니|카트/.test(text),
    chrome: /검색\s*버튼|메뉴\s*문구|기능\s*문구|공유\s*버튼/.test(text),
  };
}

export function selectCopyBlocks(blocks, held, direction) {
  const keep = keepRequested(direction);
  const picked = [];
  let omitted = 0;
  const consider = [...(blocks || []), ...(held || [])];
  for (const block of consider) {
    const kind = skipKind(block);
    if (kind && !keep[kind]) {
      omitted += 1;
      continue;
    }
    picked.push(block);
  }
  picked.sort((a, b) => {
    const at = Number(a.top);
    const bt = Number(b.top);
    if (!Number.isFinite(at) || !Number.isFinite(bt)) return 0;
    return at - bt || (Number(a.left) || 0) - (Number(b.left) || 0);
  });
  return {
    omitted,
    blocks: joinConnectedBlocks(picked).map((block, index) => ({ ...block, id: `b${index + 1}` })),
  };
}

function shapeBlock(block, index, prefix) {
  return {
    id: `${prefix}${index + 1}`,
    role: block.role || roleHint(block.tag, block.original),
    original: block.original,
    top: block.top,
    left: block.left,
    width: Number(block.width) || 0,
    height: Number(block.height) || 0,
    lines: compactLines(block.lines),
    tag: block.tag,
    inFooter: Boolean(block.inFooter),
    nearBottom: Boolean(block.nearBottom),
  };
}

function blockBox(block) {
  const top = Number(block.top) || 0;
  const left = Number(block.left) || 0;
  const width = Number(block.width) > 0 ? Number(block.width) : 80;
  const height = Number(block.height) > 0 ? Number(block.height) : 22;
  return { top, left, width, height, right: left + width, bottom: top + height };
}

const PREVIEW_GAP = 12;

function canJoinText(a, b) {
  const left = blockBox(a);
  const right = blockBox(b);
  const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return overlapX > -PREVIEW_GAP && overlapY > -PREVIEW_GAP;
}

export function joinConnectedBlocks(blocks) {
  const items = [...(blocks || [])];
  const used = new Set();
  const groups = [];
  for (let index = 0; index < items.length; index += 1) {
    if (used.has(index)) continue;
    const group = [items[index]];
    used.add(index);
    let grew = true;
    while (grew) {
      grew = false;
      for (let other = 0; other < items.length; other += 1) {
        if (used.has(other)) continue;
        const joinedLength = [...group.map((block) => block.original).join(""), items[other].original || ""].length;
        if (joinedLength > 480) continue;
        if (!group.some((member) => canJoinText(member, items[other]))) continue;
        group.push(items[other]);
        used.add(other);
        grew = true;
      }
    }
    groups.push(group.sort((a, b) => (Number(a.top) || 0) - (Number(b.top) || 0) || (Number(a.left) || 0) - (Number(b.left) || 0)));
  }
  return groups.map(fuseTextGroup);
}

function fuseTextGroup(group) {
  if (group.length === 1) return group[0];
  const boxes = group.map(blockBox);
  const top = Math.min(...boxes.map((box) => box.top));
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  const role = ["제목", "배너", "소제목", "설명", "광고"].find((name) => group.some((block) => block.role === name)) || group[0].role;
  return {
    ...group[0],
    role,
    original: group.map((block) => block.original).join("\n"),
    top,
    left,
    width: right - left,
    height: bottom - top,
    lines: group.flatMap((block) => block.lines || []).slice(0, 8),
  };
}

function takeBlockWindow(blocks, limit) {
  if (blocks.length <= limit) return { truncated: false, blocks };
  const headCount = Math.ceil(limit * 0.65);
  return {
    truncated: true,
    blocks: [...blocks.slice(0, headCount), ...blocks.slice(-(limit - headCount))],
  };
}

export function mergeBlocks(groups, limit = BLOCK_LIMIT) {
  const seen = new Set();
  const all = [];
  for (const group of groups) {
    for (const block of group || []) {
      const original = String(block.original || "").replace(/\s+/g, " ").trim();
      if (original.length < 2) continue;
      const key = `${original}@@${Math.round(Number(block.top) / 24)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...block, original });
    }
  }
  all.sort((a, b) => a.top - b.top || a.left - b.left);
  const content = [];
  const held = [];
  for (const block of all) {
    if (skipKind(block)) held.push(block);
    else content.push(block);
  }
  const chosen = takeBlockWindow(joinConnectedBlocks(content), limit);
  return {
    truncated: chosen.truncated,
    blocks: chosen.blocks.map((block, index) => shapeBlock(block, index, "b")),
    held: held.slice(0, 40).map((block, index) => shapeBlock(block, index, "h")),
  };
}

export function buildPrompt({ direction, businessName, tone, pageKind, pageTitle, pageUrl, blocks, includeImages = false }) {
  const list = (blocks || []).map((block) => ({
    id: block.id,
    role: block.role,
    length: [...block.original].length,
    text: block.original,
  }));

  const lines = [
    "너는 한국어 홈페이지 문구 작성자다.",
    includeImages
      ? "첨부 이미지는 참고 페이지를 위에서 아래까지 캡처한 화면이다. 위쪽 조각부터 순서대로 이어진다."
      : "글자 칸 목록이 있으므로 이미지는 첨부하지 않는다. 아래 블록만 보고 쓴다.",
    "실제 글자는 아래 블록 목록을 기준으로 한다.",
    "같은 id마다 새 홈페이지에 붙여 넣을 문구를 작성한다.",
    "",
    ...(pageKind ? [`페이지 종류: ${pageKind}`] : []),
    `페이지 제목: ${pageTitle || "(없음)"}`,
    `주소: ${pageUrl || "(없음)"}`,
    `상호: ${businessName || "(없음)"}`,
    `말투: ${tone}`,
    `새 홈페이지 방향: ${direction}`,
    "",
    "작성 규칙:",
    "- 참고 문장을 조금 고친 문장으로 두지 말고, 새 홈페이지 방향에서 새로 쓴다.",
    "- 제목, 상품명, 배너, 상세 설명은 세련되고 멋진 광고 문장으로 쓴다.",
    "- 말투 설정은 그 광고 문장의 온도만 조절한다. 건조한 안내문이나 기능 설명처럼 쓰지 않는다.",
    "- 각 문구의 글자 수는 참고 문장의 0.7배에서 1.3배 사이에 맞춘다.",
    "- 한 칸의 참고 문장이 여러 줄이어도 suggestion은 하나의 광고 문구로 쓴다.",
    "- 구매로 이어지는 짧은 버튼은 광고 문구답게 짧고 또렷하게 쓴다.",
    "- role은 제목, 배너, 소제목, 설명, 버튼, 광고 중에서 칸의 역할에 맞게 고를 수 있다.",
    "- 가격, 후기, 순위, 인증, 전화번호, 주소, 사람 이름은 방향에 적힌 사실만 쓴다. 없으면 suggestion을 \"[직접 입력]\"으로 둔다.",
    "- 응답에는 id와 suggestion만 넣는다.",
  ];

  if (!list.length) {
    lines.push(
      "- 이 페이지에서는 글자 칸을 찾지 못했다. 캡처 화면의 구성을 보고 새 홈페이지에 쓸 문구를 6개에서 10개 작성한다.",
      "- id는 s1부터 순서대로 붙이고 original은 빈 문자열로 둔다.",
      "- JSON만 반환한다. 형식은 {\"blocks\":[{\"id\":\"s1\",\"suggestion\":\"...\"}]} 이다.",
    );
    return lines.join("\n");
  }

  lines.push(
    "- JSON만 반환한다. 형식은 {\"blocks\":[{\"id\":\"b1\",\"suggestion\":\"...\"}]} 이다.",
    "",
    JSON.stringify({ blocks: list }),
  );
  return lines.join("\n");
}

export function parseModelJson(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("문구 형식을 읽지 못했습니다. 다시 만들어 주세요.");
    }
    try {
      data = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new Error("문구 형식을 읽지 못했습니다. 다시 만들어 주세요.");
    }
  }
  const source = Array.isArray(data) ? data : data?.blocks;
  if (!Array.isArray(source)) {
    throw new Error("문구 목록을 찾지 못했습니다.");
  }
  return source
    .filter((item) => item && item.id)
    .map((item) => ({
      id: String(item.id),
      role: String(item.role || "").trim(),
      original: String(item.original || "").trim(),
      suggestion: String(item.suggestion || "").trim(),
    }));
}

export function pairSuggestions(blocks, suggestions) {
  const byId = new Map(suggestions.map((item) => [item.id, item]));
  const paired = blocks.map((block) => {
    const match = byId.get(block.id);
    return {
      ...block,
      role: match?.role || block.role,
      suggestion: match?.suggestion || "",
    };
  });
  if (paired.some((row) => row.suggestion) || !suggestions.length) return paired;
  return blocks.map((block, index) => {
    const match = suggestions[index];
    return {
      ...block,
      role: match?.role || block.role,
      suggestion: match?.suggestion || "",
    };
  });
}

export function formatCopyAll(blocks) {
  return blocks
    .filter((block) => block.suggestion)
    .map((block) => `[${block.role}]\n${block.suggestion}`)
    .join("\n\n");
}
