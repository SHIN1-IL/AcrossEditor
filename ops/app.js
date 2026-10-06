(() => {
  const TOKEN_KEY = "acrosseditor_ops_token";
  const els = {
    token: document.getElementById("token"),
    loginErr: document.getElementById("loginErr"),
    desk: document.getElementById("desk"),
    note: document.getElementById("note"),
    issueMsg: document.getElementById("issueMsg"),
    customerMsg: document.getElementById("customerMsg"),
    rows: document.getElementById("rows"),
  };
  let token = sessionStorage.getItem(TOKEN_KEY) || "";

  function showErr(msg) {
    els.loginErr.hidden = !msg;
    els.loginErr.textContent = msg || "";
  }

  async function admin(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", "X-Admin-Token": token, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function customerCopy(lic) {
    return [
      "1분에디터 키가 발급됐습니다.",
      "",
      `키: ${lic.license_key}`,
      `상품: ${lic.plan_label || lic.plan}`,
      `한도: 하루 ${lic.daily_limit}건 / 매월 ${lic.monthly_limit}건`,
      `기간: ${lic.expires_at || `처음 등록 후 ${lic.duration_days}일`} · 한 달 주기`,
      "매월 한도는 다시 채워지고, 쓰지 않은 건은 다음 달로 넘어가지 않습니다.",
      "상단에 오늘과 이번 달이 남은 건/한도로 표시됩니다.",
      "",
      "사용 방법:",
      `1) 크롬 확장 연결 설정의 서버 주소에 ${location.origin} 을 넣습니다.`,
      "2) 라이선스 키를 저장합니다.",
      "3) 참고 페이지를 캡처하고, 구간을 고른 뒤 문구 만들기를 누릅니다.",
      "4) 상단의 오늘·이번 달 숫자로 남은 건을 확인합니다.",
      "",
      "캡처와 미리보기 수정은 건수에 포함되지 않습니다.",
    ].join("\n");
  }

  async function loadList() {
    const data = await admin("/admin/licenses");
    els.rows.innerHTML = (data.licenses || []).map((lic) => {
      const key = lic.license_key;
      return `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td>${escapeHtml(lic.plan_label)}</td>
        <td>${escapeHtml(lic.started_at || "미시작")}</td>
        <td>${escapeHtml(lic.expires_at || `등록 후 ${lic.duration_days}일`)}</td>
        <td>${escapeHtml(lic.status)}</td>
        <td>${lic.daily_used}/${lic.daily_limit}</td>
        <td>${lic.monthly_used}/${lic.monthly_limit}</td>
        <td class="error-cell">${escapeHtml(lic.failure_message || "")}</td>
        <td><input class="note-edit" value="${escapeHtml(lic.note || "")}" /></td>
        <td class="actions">
          ${lic.failure_message && !lic.recovery_used ? `<button type="button" data-act="restore" data-key="${escapeHtml(key)}">1건 추가</button>` : ""}
          ${lic.recovery_used ? `<span class="plan-meta">복구 완료</span>` : ""}
          <button type="button" data-act="savenote" data-key="${escapeHtml(key)}">메모</button>
          <button type="button" data-act="copy" data-key="${escapeHtml(key)}">안내</button>
          <button type="button" data-act="extend30" data-key="${escapeHtml(key)}">+30일</button>
          <button type="button" data-act="suspend" data-key="${escapeHtml(key)}">정지</button>
          <button type="button" data-act="activate" data-key="${escapeHtml(key)}">활성</button>
        </td>
      </tr>`;
    }).join("");
  }

  const ISSUES = {
    "standard-30": { plan: "standard", days: 30, notePrefix: "스탠다드 월 9900" },
    "premium-30": { plan: "premium", days: 30, notePrefix: "프리미엄 월 19900" },
    "family-standard": { plan: "family_standard", days: 30, notePrefix: "스탠다드 지인" },
    "family-premium": { plan: "family_premium", days: 30, notePrefix: "프리미엄 지인" },
    trial: { plan: "trial", days: 30, notePrefix: "체험 1건" },
  };

  async function issue(kind) {
    const spec = ISSUES[kind];
    const extra = els.note.value.trim();
    const lic = await admin("/admin/licenses", {
      method: "POST",
      body: JSON.stringify({ plan: spec.plan, days: spec.days, note: extra ? `${spec.notePrefix} / ${extra}` : spec.notePrefix }),
    });
    els.customerMsg.value = customerCopy(lic);
    els.issueMsg.hidden = false;
    els.issueMsg.textContent = `발급됨: ${lic.license_key}`;
    await loadList();
  }

  async function loadGemini() {
    const state = await admin("/admin/gemini-key");
    document.getElementById("geminiState").textContent = state.configured
      ? `키가 저장되어 있습니다. 끝 4자 ${state.tail}`
      : "아직 Gemini 키가 없습니다.";
  }

  document.getElementById("geminiForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const apiKey = document.getElementById("geminiKey").value.trim();
    const state = await admin("/admin/gemini-key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
    document.getElementById("geminiKey").value = "";
    document.getElementById("geminiState").textContent = `키를 저장했습니다. 끝 4자 ${state.tail}`;
  });

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    token = els.token.value.trim();
    try {
      await admin("/admin/licenses");
      sessionStorage.setItem(TOKEN_KEY, token);
      showErr("");
      document.getElementById("loginCard").hidden = true;
      els.desk.hidden = false;
      await loadGemini();
      await loadList();
    } catch (error) {
      sessionStorage.removeItem(TOKEN_KEY);
      showErr(error.message);
    }
  });

  document.getElementById("copyMsgBtn").addEventListener("click", async () => {
    if (!els.customerMsg.value) return;
    await navigator.clipboard.writeText(els.customerMsg.value);
    els.issueMsg.hidden = false;
    els.issueMsg.textContent = "안내문을 복사했습니다.";
  });
  document.getElementById("refreshBtn").addEventListener("click", () => loadList().catch((error) => alert(error.message)));
  document.querySelectorAll("[data-issue]").forEach((button) => {
    button.addEventListener("click", () => issue(button.dataset.issue).catch((error) => alert(error.message)));
  });

  els.rows.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const key = button.dataset.key;
    const row = button.closest("tr");
    try {
      if (button.dataset.act === "savenote") {
        await admin(`/admin/licenses/${encodeURIComponent(key)}/note`, {
          method: "POST",
          body: JSON.stringify({ note: row.querySelector(".note-edit").value }),
        });
      }
      if (button.dataset.act === "copy") {
        const data = await admin("/admin/licenses");
        const lic = (data.licenses || []).find((item) => item.license_key === key);
        els.customerMsg.value = customerCopy(lic);
      }
      if (button.dataset.act === "extend30") {
        await admin(`/admin/licenses/${encodeURIComponent(key)}/extend`, {
          method: "POST",
          body: JSON.stringify({ days: 30 }),
        });
      }
      if (button.dataset.act === "restore") {
        await admin(`/admin/licenses/${encodeURIComponent(key)}/restore-case`, { method: "POST", body: "{}" });
      }
      if (button.dataset.act === "suspend" || button.dataset.act === "activate") {
        await admin(`/admin/licenses/${encodeURIComponent(key)}/status`, {
          method: "POST",
          body: JSON.stringify({ status: button.dataset.act === "suspend" ? "suspended" : "active" }),
        });
      }
      await loadList();
    } catch (error) {
      alert(error.message);
    }
  });

  if (token) {
    els.token.value = token;
    document.getElementById("loginForm").requestSubmit();
  }
})();
