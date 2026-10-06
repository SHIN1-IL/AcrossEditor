import {
  blocksForSections,
  buildPrompt,
  canCapture,
  formatCopyAll,
  layoutPages,
  outputScale,
  pairSuggestions,
  parseModelJson,
  slicePlan,
} from "./logic.js";

const settings = document.querySelector("#settings");
const serverUrlInput = document.querySelector("#server-url");
const licenseInput = document.querySelector("#license-key");
const directionInput = document.querySelector("#direction");
const businessNameInput = document.querySelector("#business-name");
const toneInput = document.querySelector("#tone");
const targetUrlInput = document.querySelector("#target-url");
const statusNode = document.querySelector("#status");
const sectionPicker = document.querySelector("#section-picker");
const sectionList = document.querySelector("#section-list");
const previewSection = document.querySelector("#preview-section");
const previewImage = document.querySelector("#preview");
const pageMeta = document.querySelector("#page-meta");
const resultsSection = document.querySelector("#results");
const pageNav = document.querySelector("#page-nav");
const resultList = document.querySelector("#result-list");
const editDialog = document.querySelector("#edit-dialog");
const editRole = document.querySelector("#edit-role");
const editOriginal = document.querySelector("#edit-original");
const editText = document.querySelector("#edit-text");
const quotaMeter = document.querySelector("#quota-meter");
const captureButton = document.querySelector("#capture");
const downloadButton = document.querySelector("#download");
const generateButton = document.querySelector("#generate");
const copyAllButton = document.querySelector("#copy-all");

const state = {
  canvas: null,
  previewUrl: "",
  sheetUrls: [],
  blocks: [],
  held: [],
  blocksTruncated: false,
  meta: null,
  rows: [],
  pages: [],
  editor: null,
  capturedCssHeight: 0,
  tabId: 0,
  capturing: false,
  copyLocked: false,
};

document.querySelector("#save-settings").addEventListener("click", () => {
  saveSettings().then(async () => {
    setStatus("설정을 저장했습니다.");
    await refreshQuota();
  });
});
document.querySelector("#select-all").addEventListener("click", () => {
  for (const input of sectionList.querySelectorAll(".section-check")) input.checked = true;
});

captureButton.addEventListener("click", startCapture);
downloadButton.addEventListener("click", downloadImage);
document.querySelector("#brief").addEventListener("submit", (event) => {
  event.preventDefault();
  startGenerate();
});
copyAllButton.addEventListener("click", () => copyText(formatCopyAll(state.rows), copyAllButton));
targetUrlInput.addEventListener("change", () => {
  saveDraft();
});
document.querySelector("#edit-close").addEventListener("click", () => editDialog.close());
document.querySelector("#edit-copy").addEventListener("click", () => saveEditor(true));
document.querySelector("#edit-apply").addEventListener("click", () => saveEditor(false));
document.querySelector("#edit-jump").addEventListener("click", () => {
  const row = state.editor?.row;
  scrollSourceTab(Number.isFinite(Number(row?.top)) ? Number(row.top) : state.editor?.page?.cssStart || 0);
});

loadStored();

async function loadStored() {
  const stored = await chrome.storage.local.get(["settings", "draft"]);
  const saved = stored.settings || {};
  serverUrlInput.value = saved.serverUrl || "http://127.0.0.1:8787";
  licenseInput.value = saved.licenseKey || "";
  if (!saved.licenseKey) settings.open = true;

  const draft = stored.draft || {};
  directionInput.value = draft.direction || "";
  businessNameInput.value = draft.businessName || "";
  if ([...toneInput.options].some((option) => option.value === draft.tone)) {
    toneInput.value = draft.tone;
  }
  targetUrlInput.value = draft.targetUrl || "";
  await refreshQuota();
}

async function saveSettings() {
  await chrome.storage.local.set({
    settings: {
      serverUrl: serverUrlInput.value.trim(),
      licenseKey: licenseInput.value.trim(),
    },
  });
}

async function saveDraft() {
  await chrome.storage.local.set({
    draft: {
      direction: directionInput.value.trim(),
      businessName: businessNameInput.value.trim(),
      tone: toneInput.value,
      targetUrl: targetUrlInput.value.trim(),
    },
  });
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}

function setBusy(capturing, generating) {
  captureButton.disabled = capturing || generating;
  generateButton.disabled = capturing || generating || state.copyLocked;
  captureButton.textContent = capturing ? "캡처 중…" : "전체 페이지 캡처";
  generateButton.textContent = generating ? "문구 작성 중…" : (state.copyLocked ? "문구 만들기 완료" : "문구 만들기");
}

async function startCapture() {
  if (state.capturing) return;
  state.capturing = true;
  state.copyLocked = false;
  state.canvas = null;
  state.rows = [];
  clearSheets();
  resultsSection.hidden = true;
  const frames = [];
  setBusy(true, false);
  setStatus("페이지 맨 위부터 내려가며 캡처합니다.");

  let port;
  let tab;
  try {
    tab = await activeWebTab();
    port = chrome.runtime.connect({ name: "panel" });
  } catch (error) {
    state.capturing = false;
    setBusy(false, false);
    setStatus(error?.message || "캡처할 탭을 찾지 못했습니다.", true);
    return;
  }

  const timeout = setTimeout(() => {
    if (!state.capturing) return;
    state.capturing = false;
    setBusy(false, false);
    setStatus("캡처가 너무 오래 걸립니다. 페이지를 새로고침한 뒤 다시 눌러 주세요.", true);
    port.disconnect();
  }, 90000);

  port.onMessage.addListener(async (message) => {
    if (message.type === "progress") {
      setStatus(`캡처 중 ${message.shots}화면 · ${message.covered.toLocaleString("ko-KR")}px`);
      return;
    }
    if (message.type === "frame") {
      frames.push(message);
      return;
    }
    if (message.type === "error") {
      clearTimeout(timeout);
      state.capturing = false;
      setBusy(false, false);
      setStatus(message.message, true);
      return;
    }
    if (message.type === "done") {
      clearTimeout(timeout);
      try {
        state.canvas = await stitchFrames(frames);
        state.capturedCssHeight = frames.at(-1).destY + frames.at(-1).srcH;
        state.tabId = tab.id;
        state.blocks = message.blocks || [];
        state.held = message.held || [];
        state.blocksTruncated = message.blocksTruncated;
        state.meta = message;
        showPreview();
        renderSections();
        const notes = ["전체 페이지를 저장했습니다"];
        notes.push(`글자 칸 ${state.blocks.length}개`);
        if (message.truncated) notes.push("아주 긴 페이지라 상단부터 일부만 저장했습니다");
        if (message.blocksTruncated) notes.push("칸이 많아 위쪽과 아래쪽을 우선 담았습니다");
        setStatus(notes.join(" · "));
      } catch (error) {
        setStatus(error?.message || "캡처 이미지를 합치지 못했습니다.", true);
      } finally {
        state.capturing = false;
        setBusy(false, false);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    if (!state.capturing) return;
    clearTimeout(timeout);
    state.capturing = false;
    setBusy(false, false);
    setStatus("캡처가 중단되었습니다. 홈페이지 탭을 앞에 두고 다시 눌러 주세요.", true);
  });
  port.postMessage({ type: "capture", tabId: tab.id, windowId: tab.windowId });
}

async function activeWebTab() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current?.id && current.url && canCapture(current.url)) return current;
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = focused?.id ? focused : current;
  if (!tab?.id) throw new Error("캡처할 탭을 찾지 못했습니다. 홈페이지 탭을 앞에 두고 다시 눌러 주세요.");
  if (!tab.url) {
    throw new Error("이 탭에 접근할 수 없습니다. 확장 프로그램 설정에서 1분에디터의 사이트 액세스를 모든 사이트로 바꾼 뒤 다시 시도해 주세요.");
  }
  if (!canCapture(tab.url)) {
    throw new Error("http 또는 https 홈페이지 탭을 앞에 둔 뒤 다시 캡처해 주세요. 확장 프로그램 설정 화면에서는 캡처되지 않습니다.");
  }
  return tab;
}

function showPreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  previewSection.hidden = false;
  state.canvas.toBlob((blob) => {
    if (!blob) return;
    state.previewUrl = URL.createObjectURL(blob);
    previewImage.src = state.previewUrl;
  }, "image/jpeg", 0.8);
  pageMeta.textContent = state.meta?.title || state.meta?.url || "";
  pageMeta.title = state.meta?.url || "";
}

async function stitchFrames(frames) {
  if (!frames.length) throw new Error("캡처된 화면이 없습니다.");
  const images = await Promise.all(frames.map((frame) => loadImage(frame.dataUrl)));
  const totalHeight = frames.at(-1).destY + frames.at(-1).srcH;
  const scale = outputScale(frames[0].viewportWidth, totalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frames[0].viewportWidth * scale));
  canvas.height = Math.max(1, Math.round(totalHeight * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  frames.forEach((frame, index) => {
    const image = images[index];
    const pixelY = image.height / frame.viewportHeight;
    const sourceY = Math.min(image.height, frame.srcY * pixelY);
    const sourceH = Math.max(1, Math.min(image.height - sourceY, frame.srcH * pixelY));
    context.drawImage(
      image,
      0,
      sourceY,
      image.width,
      sourceH,
      0,
      frame.destY * scale,
      canvas.width,
      frame.srcH * scale,
    );
  });
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("캡처 이미지를 읽지 못했습니다."));
    image.src = src;
  });
}

function downloadImage() {
  if (!state.canvas) return;
  state.canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `1분에디터-${stamp()}.jpg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, "image/jpeg", 0.86);
}

async function startGenerate() {
  if (state.copyLocked) {
    setStatus("이 캡처는 문구 만들기가 끝났습니다. 다시 만들려면 페이지를 새로 캡처해 주세요.", true);
    return;
  }
  if (!state.canvas) {
    setStatus("먼저 전체 페이지를 캡처해 주세요.", true);
    return;
  }
  const direction = directionInput.value.trim();
  if (!direction) {
    setStatus("새 홈페이지 방향을 적어 주세요.", true);
    directionInput.focus();
    return;
  }

  const selectedIndexes = selectedSections();
  if (!selectedIndexes.length) {
    setStatus("문구를 만들 구간을 하나 이상 선택해 주세요.", true);
    return;
  }

  await saveSettings();
  await saveDraft();
  const stored = await chrome.storage.local.get("settings");
  const saved = stored.settings || {};
  setBusy(false, true);
  setStatus("선택한 구간의 글자 칸을 읽고 문구를 작성합니다.");

  try {
    const pageCssHeight = sectionHeight();
    const copy = blocksForSections(state.blocks, state.held, direction, {
      capturedCssHeight: state.capturedCssHeight || state.canvas.height,
      pageCssHeight,
      selectedIndexes,
    });
    const includeImages = copy.blocks.length === 0;
    if (!copy.blocks.length) {
      setStatus("광고로 바꿀 글자는 찾지 못했고, 선택한 구간 화면을 보고 문구를 작성합니다.");
    }
    const prompt = buildPrompt({
      direction,
      businessName: businessNameInput.value.trim(),
      tone: toneInput.value,
      pageKind: "",
      pageTitle: state.meta?.title || "",
      pageUrl: state.meta?.url || "",
      blocks: copy.blocks,
      includeImages,
    });
    const images = includeImages ? sliceCanvas(state.canvas) : [];
    const text = await requestCopy({
      saved,
      prompt,
      images,
      slotCount: Math.max(1, copy.blocks.length),
      sectionCount: 1,
    });
    const suggestions = parseModelJson(text);
    state.rows = copy.blocks.length
      ? pairSuggestions(copy.blocks, suggestions)
      : suggestions.map((item, index) => ({
          id: item.id || `s${index + 1}`,
          role: item.role || "설명",
          original: item.original,
          suggestion: item.suggestion,
        }));
    state.omitted = copy.omitted;
    await renderResults(selectedIndexes);
    const filled = state.rows.filter((row) => row.suggestion).length;
    const omittedNote = state.omitted
      ? " 로그인, 장바구니, 하단 푸터는 빼 두었습니다. 방향에 적으면 그 문구도 넣습니다."
      : "";
    state.copyLocked = true;
    setStatus(`선택한 ${copy.sectionCount}구간에 문구 ${filled}개를 올려 두었습니다. 이번 생성은 1건입니다. 글자를 누르면 복사하고 수정할 수 있습니다. 이 캡처는 다시 만들지 않습니다.${omittedNote}`);
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (error?.lock) state.copyLocked = true;
    setStatus(error?.message || "문구 생성에 실패했습니다.", true);
  } finally {
    setBusy(false, false);
    await refreshQuota();
  }
}

function renderQuota(status) {
  quotaMeter.replaceChildren();
  if (!status || !Number.isFinite(Number(status.daily_limit))) {
    quotaMeter.hidden = true;
    return;
  }
  const dailyLeft = Math.max(0, Number(status.daily_limit) - Number(status.daily_used || 0));
  const monthLeft = Math.max(0, Number(status.monthly_limit) - Number(status.monthly_used || 0));
  const plan = document.createElement("span");
  plan.className = "quota-plan";
  plan.textContent = status.plan_label || "라이선스";
  quotaMeter.append(
    plan,
    quotaBlock("오늘", dailyLeft, status.daily_limit),
    quotaBlock("이번달", monthLeft, status.monthly_limit),
  );
  quotaMeter.hidden = false;
  quotaMeter.setAttribute(
    "aria-label",
    `${plan.textContent} 오늘 ${dailyLeft}/${status.daily_limit} 이번달 ${monthLeft}/${status.monthly_limit}`,
  );
}

function quotaBlock(label, left, limit) {
  const block = document.createElement("span");
  block.className = "quota-block";
  const name = document.createElement("span");
  name.className = "quota-label";
  name.textContent = label;
  block.append(name, document.createTextNode(`${left}/${limit}`));
  return block;
}

async function refreshQuota() {
  const server = String(serverUrlInput.value || "http://127.0.0.1:8787").replace(/\/$/, "");
  const licenseKey = licenseInput.value.trim();
  if (!licenseKey) {
    renderQuota(null);
    return;
  }
  try {
    const response = await fetch(`${server}/api/license`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey }),
    });
    const data = await response.json().catch(() => ({}));
    renderQuota(response.ok ? data : null);
  } catch {
    renderQuota(null);
  }
}

function sliceCanvas(canvas) {
  return slicePlan(canvas.height, 1400, 6).map((slice) => {
    const tile = document.createElement("canvas");
    tile.width = canvas.width;
    tile.height = slice.height;
    tile.getContext("2d").drawImage(
      canvas,
      0,
      slice.start,
      canvas.width,
      slice.height,
      0,
      0,
      canvas.width,
      slice.height,
    );
    return tile.toDataURL("image/jpeg", 0.72).split(",")[1];
  });
}

function clearSheets() {
  for (const url of state.sheetUrls) URL.revokeObjectURL(url);
  state.sheetUrls = [];
  state.pages = [];
  state.editor = null;
  if (editDialog.open) editDialog.close();
  pageObserver?.disconnect();
  pageNav.replaceChildren();
  pageNav.hidden = true;
  resultList.replaceChildren();
}

function sectionHeight() {
  return Math.min(1100, Math.max(700, state.meta?.viewportHeight || 900));
}

function selectedSections() {
  const checked = [...sectionList.querySelectorAll(".section-check:checked")].map((input) => Number(input.value));
  if (checked.length || sectionList.childElementCount) return checked;
  const cssHeight = state.capturedCssHeight || state.canvas?.height || 1;
  const count = Math.max(1, Math.ceil(cssHeight / sectionHeight()));
  return Array.from({ length: count }, (_, index) => index);
}

function renderSections() {
  sectionList.replaceChildren();
  const pageCss = sectionHeight();
  const cssHeight = Math.max(1, state.capturedCssHeight || state.canvas.height);
  const scale = state.canvas.height / cssHeight;
  const count = Math.max(1, Math.ceil(cssHeight / pageCss));
  for (let index = 0; index < count; index += 1) {
    const cssStart = index * pageCss;
    const cssEnd = Math.min(cssHeight, cssStart + pageCss);
    const canvasStart = Math.round(cssStart * scale);
    const canvasEnd = index === count - 1 ? state.canvas.height : Math.round(cssEnd * scale);
    const tile = document.createElement("canvas");
    const tileScale = Math.min(1, 220 / state.canvas.width);
    tile.width = Math.max(1, Math.round(state.canvas.width * tileScale));
    tile.height = Math.max(1, Math.round((canvasEnd - canvasStart) * tileScale));
    tile.getContext("2d").drawImage(
      state.canvas,
      0,
      canvasStart,
      state.canvas.width,
      Math.max(1, canvasEnd - canvasStart),
      0,
      0,
      tile.width,
      tile.height,
    );
    const label = document.createElement("label");
    label.className = "section-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "section-check";
    input.value = String(index);
    input.checked = true;
    const image = document.createElement("img");
    image.alt = `${index + 1}구간`;
    image.src = tile.toDataURL("image/jpeg", 0.5);
    const caption = document.createElement("span");
    caption.textContent = `${index + 1}구간`;
    label.append(input, image, caption);
    sectionList.append(label);
  }
  sectionPicker.hidden = false;
}

async function requestCopy({ saved, prompt, images, slotCount, sectionCount }) {
  const server = String(saved.serverUrl || "http://127.0.0.1:8787").replace(/\/$/, "");
  const licenseKey = String(saved.licenseKey || "").trim();
  if (!licenseKey) throw new Error("연결 설정에 라이선스 키를 저장해 주세요.");
  const response = await fetch(`${server}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey, prompt, images, slotCount, sectionCount }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "서버에서 문구를 만들지 못했습니다.");
    error.lock = Boolean(data.lock);
    throw error;
  }
  return data.text;
}

async function renderResults(selectedIndexes) {
  clearSheets();
  resultsSection.hidden = false;
  const pageCssHeight = sectionHeight();
  const pages = layoutPages(state.rows, {
    canvasHeight: state.canvas.height,
    capturedCssHeight: state.capturedCssHeight || state.canvas.height,
    pageCssHeight,
  }).filter((page) => selectedIndexes.includes(page.index));
  state.pages = pages;
  renderPageNav(pages);
  for (const page of pages) {
    const url = await pageImageUrl(state.canvas, page, true);
    if (url) state.sheetUrls.push(url);
    resultList.append(renderSheet(page, url, pages.length));
  }
  watchPages();
}

function renderPageNav(pages) {
  pageNav.replaceChildren();
  pageNav.hidden = pages.length < 1;
  const label = document.createElement("span");
  label.className = "page-nav-label";
  label.textContent = "페이지";
  pageNav.append(label);
  for (const page of pages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-jump";
    button.textContent = String(page.index + 1);
    button.setAttribute("aria-label", `${page.index + 1}구간으로 이동`);
    button.addEventListener("click", () => {
      document.getElementById(`page-${page.index + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActivePage(page.index);
    });
    pageNav.append(button);
  }
  if (pages[0]) setActivePage(pages[0].index);
}

function setActivePage(index) {
  for (const button of pageNav.querySelectorAll(".page-jump")) {
    const active = button.textContent === String(index + 1);
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

let pageObserver;

function watchPages() {
  pageObserver?.disconnect();
  pageObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const index = Number(visible.target.dataset.pageIndex);
    if (Number.isFinite(index)) setActivePage(index);
  }, { threshold: [0.2, 0.45] });
  for (const sheet of resultList.querySelectorAll(".sheet")) pageObserver.observe(sheet);
}

function pageImageUrl(canvas, page, edited) {
  const maxWidth = 480;
  const tileScale = Math.min(1, maxWidth / canvas.width);
  const tile = document.createElement("canvas");
  tile.width = Math.max(1, Math.round(canvas.width * tileScale));
  tile.height = Math.max(1, Math.round(page.canvasHeight * tileScale));
  const context = tile.getContext("2d");
  context.drawImage(
    canvas,
    0,
    page.canvasStart,
    canvas.width,
    page.canvasHeight,
    0,
    0,
    tile.width,
    tile.height,
  );
  if (edited) {
    page.tileWidth = tile.width;
    page.tileHeight = tile.height;
    page.boxes = textBoxes(page, canvas, tileScale).filter((box) => box.y < tile.height && box.y + box.h > 0);
    for (const box of page.boxes) paintSuggestion(context, box.text, box.x, box.y, box.w, box.h);
  }
  return blobUrl(tile, "image/jpeg", 0.5);
}

function renderSheet(page, url, total) {
  const sheet = document.createElement("article");
  sheet.className = "sheet";
  sheet.id = `page-${page.index + 1}`;
  sheet.dataset.pageIndex = String(page.index);

  const head = document.createElement("div");
  head.className = "sheet-head";
  const label = document.createElement("p");
  label.textContent = `${page.index + 1}구간`;
  const jump = document.createElement("button");
  jump.type = "button";
  jump.textContent = "이 위치로";
  jump.addEventListener("click", () => scrollSourceTab(page.cssStart));
  head.append(label, jump);

  const frame = document.createElement("div");
  frame.className = "sheet-frame";
  const image = document.createElement("img");
  image.alt = `${page.index + 1}페이지. 수정할 글자가 표시된 화면`;
  image.src = url;
  page.image = image;
  frame.append(image);
  for (const box of page.boxes || []) frame.append(hotspot(box, page));

  sheet.append(head, frame);
  const loose = page.rows.filter((row) => row.suggestion && !Number.isFinite(Number(row.top)));
  if (!page.rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "이 구간에서 바꿀 글자를 찾지 못했습니다.";
    sheet.append(empty);
  }
  for (const row of loose) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "loose-row";
    button.textContent = row.suggestion;
    button.addEventListener("click", () => openEditor(row, page));
    sheet.append(button);
  }
  return sheet;
}

function hotspot(box, page) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hotspot";
  button.style.left = `${(box.x / page.tileWidth) * 100}%`;
  button.style.top = `${(box.y / page.tileHeight) * 100}%`;
  button.style.width = `${(box.w / page.tileWidth) * 100}%`;
  button.style.height = `${(box.h / page.tileHeight) * 100}%`;
  button.setAttribute("aria-label", box.text);
  button.addEventListener("click", () => openEditor(box.row, page));
  return button;
}

function textBoxes(page, canvas, tileScale) {
  const scaleX = canvas.width / Math.max(1, state.meta?.viewportWidth || canvas.width);
  const scaleY = canvas.height / Math.max(1, state.capturedCssHeight || canvas.height);
  return page.rows.flatMap((row) => {
    if (!row.suggestion || !Number.isFinite(Number(row.top))) return [];
    const width = Number(row.width) >= 8 ? Number(row.width) : 140;
    const height = Number(row.height) >= 8 ? Number(row.height) : 28;
    return [{
      row,
      text: row.suggestion,
      x: Number(row.left || 0) * scaleX * tileScale,
      y: (Number(row.top) * scaleY - page.canvasStart) * tileScale,
      w: Math.max(12, width * scaleX * tileScale),
      h: Math.max(12, height * scaleY * tileScale),
    }];
  });
}

function paintSuggestion(context, text, x, y, w, h) {
  const pad = Math.max(3, Math.min(8, h * 0.14));
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, w, h);
  const innerW = Math.max(4, w - pad * 2);
  const innerH = Math.max(4, h - pad * 2);
  let size = Math.max(9, Math.min(22, Math.floor(innerH * 0.72)));
  let lines = [];
  while (size >= 9) {
    context.font = `700 ${size}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    lines = wrapLines(context, text, innerW);
    if (lines.length * size * 1.25 <= innerH || size === 9) break;
    size -= 1;
  }
  context.fillStyle = "#10233f";
  context.textBaseline = "top";
  const lineH = size * 1.25;
  const maxLines = Math.max(1, Math.floor(innerH / lineH));
  const shown = lines.slice(0, maxLines);
  if (lines.length > shown.length && shown.length) shown[shown.length - 1] = trimLine(context, shown.at(-1), innerW);
  shown.forEach((line, index) => context.fillText(line, x + pad, y + pad + index * lineH));
}

function wrapLines(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || "").split("\n")) {
    let line = "";
    for (const char of [...paragraph]) {
      const next = line + char;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function trimLine(context, line, maxWidth) {
  const ellipsis = "…";
  let value = line;
  while (value && context.measureText(value + ellipsis).width > maxWidth) value = [...value].slice(0, -1).join("");
  return `${value}${ellipsis}`;
}

async function openEditor(row, page) {
  state.editor = { row, page };
  editRole.textContent = row.role || "문구";
  editText.value = row.suggestion || "";
  await refreshEditorPreview();
  if (!editDialog.open) editDialog.showModal();
}

async function refreshEditorPreview() {
  const row = state.editor?.row;
  if (!row) {
    editOriginal.hidden = true;
    return;
  }
  setDialogImage(editOriginal, await originalBannerUrl(row.original || ""));
}

function setDialogImage(image, url) {
  if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
  if (!url) {
    image.hidden = true;
    image.removeAttribute("src");
    return;
  }
  state.sheetUrls.push(url);
  image.src = url;
  image.hidden = false;
}

async function saveEditor(copy) {
  const row = state.editor?.row;
  const page = state.editor?.page;
  if (!row) return;
  row.suggestion = editText.value.trim();
  if (page) await refreshPageImage(page);
  await refreshEditorPreview();
  if (copy) await copyText(row.suggestion, document.querySelector("#edit-copy"));
}

async function refreshPageImage(page) {
  const url = await pageImageUrl(state.canvas, page, true);
  if (!url || !page.image) return;
  const previous = page.image.src;
  page.image.src = url;
  state.sheetUrls.push(url);
  if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
  const frame = page.image.parentElement;
  if (!frame) return;
  frame.querySelectorAll(".hotspot").forEach((button) => button.remove());
  for (const box of page.boxes || []) frame.append(hotspot(box, page));
}

function originalBannerUrl(text) {
  const width = 640;
  const pad = 28;
  const size = 32;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `700 ${size}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  const lines = wrapLines(measure, text || "", width - pad * 2);
  const lineH = size * 1.4;
  const height = Math.max(300, Math.min(520, Math.ceil(lines.length * lineH + pad * 2)));
  const tile = document.createElement("canvas");
  tile.width = width;
  tile.height = height;
  const context = tile.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.font = measure.font;
  context.fillStyle = "#10233f";
  context.textBaseline = "top";
  const maxLines = Math.max(1, Math.floor((height - pad * 2) / lineH));
  const shown = lines.slice(0, maxLines);
  if (lines.length > shown.length && shown.length) shown[shown.length - 1] = trimLine(context, shown.at(-1), width - pad * 2);
  shown.forEach((line, index) => context.fillText(line, pad, pad + index * lineH));
  return blobUrl(tile, "image/jpeg", 0.86);
}

function blobUrl(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ""), type, quality);
  });
}

async function scrollSourceTab(cssTop) {
  if (!state.tabId) {
    setStatus("원래 탭을 찾지 못했습니다. 캡처를 다시 해 주세요.", true);
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      func: (top) => window.scrollTo({ top, behavior: "smooth" }),
      args: [Math.max(0, Math.round(cssTop))],
    });
    setStatus("그 구간으로 이동했습니다. 문구를 복사해 그 위치에 붙여 넣으면 됩니다.");
  } catch {
    setStatus("해당 위치로 이동하지 못했습니다. 캡처한 탭이 아직 열려 있는지 확인해 주세요.", true);
  }
}

async function copyText(text, button) {
  if (!text) {
    setStatus("복사할 문구가 없습니다.");
    return;
  }
  await navigator.clipboard.writeText(text);
  const previous = button.textContent;
  button.textContent = "복사됨";
  setTimeout(() => {
    button.textContent = previous;
  }, 1200);
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
