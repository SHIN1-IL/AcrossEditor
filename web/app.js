const STORAGE = "acrosseditor-customer";

const els = {
  quotaMeter: document.querySelector("#quotaMeter"),
  licenseHint: document.querySelector("#licenseHint"),
  settingsDot: document.querySelector("#settingsDot"),
  settingsLayer: document.querySelector("#settingsLayer"),
  licenseBadge: document.querySelector("#licenseBadge"),
  usageCard: document.querySelector("#usageCard"),
  licenseKey: document.querySelector("#licenseKey"),
  licenseError: document.querySelector("#licenseError"),
  direction: document.querySelector("#direction"),
  businessName: document.querySelector("#business-name"),
  tone: document.querySelector("#tone"),
  targetUrl: document.querySelector("#target-url"),
  status: document.querySelector("#status"),
  previewSection: document.querySelector("#preview-section"),
  previewImage: document.querySelector("#preview"),
  pageText: document.querySelector("#page-text"),
  pageMeta: document.querySelector("#page-meta"),
  sectionPicker: document.querySelector("#section-picker"),
  sectionList: document.querySelector("#section-list"),
  results: document.querySelector("#results"),
  resultList: document.querySelector("#result-list"),
  captureButton: document.querySelector("#capture"),
  generateButton: document.querySelector("#generate"),
};

const page = { blocks: [], title: "", url: "" };

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || "{}");
  } catch {
    return {};
  }
}

function save(next) {
  localStorage.setItem(STORAGE, JSON.stringify(next));
}

function applyFont(size) {
  document.documentElement.dataset.fontSize = size || "md";
  for (const button of document.querySelectorAll("[data-font]")) {
    button.classList.toggle("is-on", button.dataset.font === (size || "md"));
  }
}

function daysLeft(expires) {
  if (!expires) return "등록 전";
  const end = new Date(`${expires}T00:00:00+09:00`);
  const now = new Date();
  const diff = Math.ceil((end - now) / 86400000);
  return diff >= 0 ? `${diff}일` : "만료";
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

function showQuota(status) {
  const dailyLeft = Math.max(0, status.daily_limit - status.daily_used);
  const monthLeft = Math.max(0, status.monthly_limit - status.monthly_used);
  els.quotaMeter.hidden = false;
  els.quotaMeter.replaceChildren();
  const plan = document.createElement("span");
  plan.className = "quota-plan";
  plan.textContent = status.plan_label || "라이선스";
  els.quotaMeter.append(plan, quotaBlock("오늘", dailyLeft, status.daily_limit), quotaBlock("이번달", monthLeft, status.monthly_limit));
  els.quotaMeter.setAttribute("aria-label", `${plan.textContent} 오늘 ${dailyLeft}/${status.daily_limit} 이번달 ${monthLeft}/${status.monthly_limit}`);
  els.licenseHint.hidden = true;
  els.settingsDot.hidden = true;
  els.licenseBadge.className = "badge active";
  els.licenseBadge.textContent = status.status === "active" ? "라이선스 등록됨" : status.status;
  els.usageCard.hidden = false;
  document.querySelector("#usagePlan").textContent = status.plan_label;
  document.querySelector("#usageStart").textContent = status.started_at || "처음 사용일에 시작";
  document.querySelector("#usageDays").textContent = daysLeft(status.expires_at);
  document.querySelector("#usageDaily").textContent = `${dailyLeft} / ${status.daily_limit}`;
  document.querySelector("#usageMonthly").textContent = `${monthLeft} / ${status.monthly_limit}`;
}

function clearQuota() {
  els.quotaMeter.hidden = true;
  els.licenseHint.hidden = false;
  els.settingsDot.hidden = false;
  els.licenseBadge.className = "badge inactive";
  els.licenseBadge.textContent = "라이선스 미등록";
  els.usageCard.hidden = true;
}

async function refresh(key) {
  if (!key) {
    clearQuota();
    return;
  }
  const response = await fetch("/api/license", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey: key }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "키를 확인하지 못했습니다.");
  showQuota(data);
  return data;
}

function openSettings(open) {
  els.settingsLayer.hidden = !open;
  document.body.classList.toggle("settings-open", open);
}

document.querySelector("#settingsBtn").addEventListener("click", () => openSettings(true));
document.querySelector("#openSettingsLink").addEventListener("click", () => openSettings(true));
document.querySelector("#settingsClose").addEventListener("click", () => openSettings(false));
document.querySelector("#settingsBackdrop").addEventListener("click", () => openSettings(false));

document.querySelector("#planToggle").addEventListener("click", (event) => {
  const notice = document.querySelector("#planNotice");
  const open = notice.hidden;
  notice.hidden = !open;
  event.currentTarget.classList.toggle("open", open);
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

for (const button of document.querySelectorAll("[data-font]")) {
  button.addEventListener("click", () => {
    const state = load();
    state.fontSize = button.dataset.font;
    save(state);
    applyFont(state.fontSize);
  });
}

document.querySelector("#verifyBtn").addEventListener("click", async () => {
  const key = els.licenseKey.value.trim().toUpperCase();
  els.licenseError.hidden = true;
  try {
    await refresh(key);
    const state = load();
    state.licenseKey = key;
    save(state);
    openSettings(false);
  } catch (error) {
    els.licenseError.hidden = false;
    els.licenseError.textContent = error.message;
  }
});

function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle("error", Boolean(isError));
}

els.captureButton.addEventListener("click", () => {
  readPage().catch((error) => setStatus(error.message, true));
});

document.querySelector("#brief").addEventListener("submit", (event) => {
  event.preventDefault();
  const state = rememberDraft();
  if (!state.licenseKey) {
    setStatus("먼저 설정에서 라이선스 키를 등록해 주세요.", true);
    openSettings(true);
    return;
  }
  if (!state.targetUrl) {
    setStatus("캡처할 주소를 넣어 주세요.", true);
    els.targetUrl.focus();
    return;
  }
  if (!state.direction) {
    setStatus("새 홈페이지 방향을 적어 주세요.", true);
    els.direction.focus();
    return;
  }
  writeCopy(state).catch((error) => setStatus(error.message, true));
});

function rememberDraft() {
  const state = load();
  state.direction = els.direction.value.trim();
  state.businessName = els.businessName.value.trim();
  state.tone = els.tone.value;
  state.targetUrl = els.targetUrl.value.trim();
  save(state);
  return state;
}

function selectedBlocks() {
  const checked = [...els.sectionList.querySelectorAll(".section-check:checked")].map((input) => input.value);
  if (!checked.length) return page.blocks;
  return page.blocks.filter((block) => checked.includes(block.id));
}

async function readPage() {
  const state = rememberDraft();
  if (!state.licenseKey) {
    setStatus("먼저 설정에서 라이선스 키를 등록해 주세요.", true);
    openSettings(true);
    return;
  }
  if (!state.targetUrl) {
    setStatus("캡처할 주소를 넣어 주세요.", true);
    els.targetUrl.focus();
    return;
  }
  els.captureButton.disabled = true;
  setStatus("주소에서 글자를 읽고 있습니다.");
  try {
    const response = await fetch("/api/read-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey: state.licenseKey, url: state.targetUrl }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "주소를 읽지 못했습니다.");
    page.blocks = data.blocks || [];
    page.title = data.title || "";
    page.url = data.url || state.targetUrl;
    showPage();
    setStatus(`${page.title || page.url}에서 글자 ${page.blocks.length}칸을 읽었습니다. 방향을 적고 문구 만들기를 누르세요.`);
  } finally {
    els.captureButton.disabled = false;
  }
}

function showPage() {
  els.previewSection.hidden = false;
  els.previewImage.hidden = true;
  document.querySelector("#download").hidden = true;
  els.pageText.hidden = false;
  els.pageText.textContent = page.blocks.map((block) => block.original).join("\n");
  els.pageMeta.textContent = page.title ? `${page.title} · ${page.url}` : page.url;
  els.sectionList.replaceChildren();
  for (const block of page.blocks) {
    const label = document.createElement("label");
    label.className = "section-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "section-check";
    input.value = block.id;
    input.checked = true;
    const caption = document.createElement("span");
    caption.textContent = `${block.role} · ${block.original}`;
    label.append(input, caption);
    els.sectionList.append(label);
  }
  els.sectionPicker.hidden = page.blocks.length < 1;
}

async function writeCopy(state) {
  els.generateButton.disabled = true;
  setStatus("문구를 만들고 있습니다.");
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: state.licenseKey,
        url: state.targetUrl,
        direction: state.direction,
        businessName: state.businessName,
        tone: state.tone,
        pageTitle: page.title,
        pageUrl: page.url,
        blocks: selectedBlocks(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "문구를 만들지 못했습니다.");
    if (data.daily_limit) showQuota(data);
    renderRows(data.rows || []);
    setStatus("문구를 만들었습니다. 칸마다 복사해 붙여 넣으세요.");
  } finally {
    els.generateButton.disabled = false;
  }
}

function renderRows(rows) {
  els.results.hidden = false;
  els.resultList.replaceChildren();
  for (const row of rows) {
    if (!row.suggestion) continue;
    const card = document.createElement("article");
    card.className = "copy-row";
    const title = document.createElement("h3");
    title.textContent = row.role || "문구";
    const original = document.createElement("p");
    original.className = "original";
    original.textContent = row.original || "";
    const suggestion = document.createElement("p");
    suggestion.textContent = row.suggestion;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "복사";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(row.suggestion);
      button.textContent = "복사됨";
    });
    card.append(title, original, suggestion, button);
    els.resultList.append(card);
  }
  if (!els.resultList.childElementCount) {
    const empty = document.createElement("p");
    empty.textContent = "만든 문구가 없습니다. 주소를 확인한 뒤 다시 눌러 주세요.";
    els.resultList.append(empty);
  }
}

document.querySelector("#copy-all").addEventListener("click", async () => {
  const text = [...els.resultList.querySelectorAll(".copy-row p:not(.original)")].map((node) => node.textContent).join("\n\n");
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus("전체 문구를 복사했습니다.");
});

document.querySelector("#select-all").addEventListener("click", () => {
  for (const input of document.querySelectorAll(".section-check")) input.checked = true;
});

const stored = load();
applyFont(stored.fontSize || "md");
els.direction.value = stored.direction || "";
els.businessName.value = stored.businessName || "";
els.targetUrl.value = stored.targetUrl || "";
if (stored.tone) els.tone.value = stored.tone;
els.licenseKey.value = stored.licenseKey || "";
if (stored.licenseKey) {
  refresh(stored.licenseKey).catch(() => clearQuota());
} else {
  clearQuota();
  openSettings(true);
}
