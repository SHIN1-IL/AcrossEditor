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
};

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

document.querySelector("#capture").addEventListener("click", () => {
  const state = load();
  if (!state.licenseKey) {
    setStatus("먼저 설정에서 라이선스 키를 등록해 주세요.", true);
    openSettings(true);
    return;
  }
  setStatus("참고할 홈페이지 탭에서 크롬 확장 1분에디터의 전체 페이지 캡처를 누르세요. 캡처 뒤 구간을 고르고 문구를 만듭니다.");
});

document.querySelector("#brief").addEventListener("submit", (event) => {
  event.preventDefault();
  const state = load();
  state.direction = els.direction.value.trim();
  state.businessName = els.businessName.value.trim();
  state.tone = els.tone.value;
  state.targetUrl = els.targetUrl.value.trim();
  save(state);
  if (!state.licenseKey) {
    setStatus("먼저 설정에서 라이선스 키를 등록해 주세요.", true);
    openSettings(true);
    return;
  }
  if (!state.direction) {
    setStatus("새 홈페이지 방향을 적어 주세요.", true);
    els.direction.focus();
    return;
  }
  setStatus("먼저 전체 페이지를 캡처해 주세요. 캡처는 참고 홈페이지를 연 탭의 크롬 확장에서 합니다.", true);
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
