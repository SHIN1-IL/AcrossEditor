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
      "1분에디터 설치판 키가 발급됐습니다.",
      "",
      `키: ${lic.license_key}`,
      "상품: 설치판 · 79,000원 · 1회",
      "기간: 무기한. 키는 처음 문구를 만든 크롬 Google 계정에 묶입니다.",
      "",
      "사용 방법:",
      "1) 구매한 ZIP을 풀고 사용방법 PDF를 읽습니다.",
      "2) 크롬 확장의 설정에 이 키와 본인 제미나이 키를 저장합니다.",
      "3) 참고할 홈페이지 탭을 연 뒤 전체 페이지 캡처를 누릅니다.",
      "4) 구간을 고르고 문구 만들기를 누릅니다.",
      "",
      "Windows와 Mac의 크롬에서 사용합니다. 핸드폰, 아이패드, 갤럭시탭에는 설치되지 않습니다.",
    ].join("\n");
  }

  async function loadList() {
    const data = await admin("/admin/licenses");
    const list = data.licenses || [];
    if (!list.length) {
      els.rows.innerHTML = `<tr><td colspan="6" class="empty-row">표시할 라이선스가 없습니다.</td></tr>`;
      return;
    }
    els.rows.innerHTML = list.map((lic) => {
      const key = lic.license_key;
      const rowClass = lic.status === "suspended" ? "row-suspended" : "";
      return `<tr class="${rowClass}">
        <td><code>${escapeHtml(key)}</code></td>
        <td>${escapeHtml(lic.started_at || "미시작")}</td>
        <td><span class="status-badge status-${escapeHtml(lic.status)}">${escapeHtml(lic.status)}</span></td>
        <td class="note-cell">${escapeHtml(lic.bound_email || "미등록")}</td>
        <td class="note-cell"><input class="note-edit" value="${escapeHtml(lic.note || "")}" /></td>
        <td class="actions">
          <button type="button" data-act="savenote" data-key="${escapeHtml(key)}">메모</button>
          <button type="button" data-act="copy" data-key="${escapeHtml(key)}">안내</button>
          ${lic.bound_email ? `<button type="button" data-act="unbind" data-key="${escapeHtml(key)}">계정 해제</button>` : ""}
          <button type="button" class="btn-danger" data-act="suspend" data-key="${escapeHtml(key)}">정지</button>
          <button type="button" data-act="activate" data-key="${escapeHtml(key)}">활성</button>
        </td>
      </tr>`;
    }).join("");
  }

  async function issue() {
    const extra = els.note.value.trim();
    const lic = await admin("/admin/licenses", {
      method: "POST",
      body: JSON.stringify({ plan: "install", days: 0, note: extra ? `설치판 79000 / ${extra}` : "설치판 79000" }),
    });
    els.customerMsg.value = customerCopy(lic);
    els.issueMsg.hidden = false;
    els.issueMsg.textContent = `발급됨: ${lic.license_key}`;
    await loadList();
  }

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    token = els.token.value.trim();
    try {
      await admin("/admin/licenses");
      sessionStorage.setItem(TOKEN_KEY, token);
      showErr("");
      document.getElementById("loginCard").hidden = true;
      els.desk.hidden = false;
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
  document.getElementById("issueBtn").addEventListener("click", () => issue().catch((error) => alert(error.message)));

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
      if (button.dataset.act === "unbind") {
        await admin(`/admin/licenses/${encodeURIComponent(key)}/unbind`, { method: "POST", body: "{}" });
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
