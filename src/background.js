import { canCapture, mergeBlocks, planShot } from "./logic.js";

const MAX_SHOTS = 30;
const MAX_CSS_HEIGHT = 20000;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  let closed = false;
  port.onDisconnect.addListener(() => {
    closed = true;
  });
  port.onMessage.addListener((message) => {
    if (message?.type === "capture") {
      captureTab(port, () => closed, message).catch((error) => {
        send(port, { type: "error", message: explainCaptureError(error) });
      });
    }
  });
});

function send(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The panel closed while the capture was still running.
  }
}

function explainCaptureError(error) {
  const message = error?.message || "";
  if (/MAX_CAPTURE_VISIBLE_TAB|quota/i.test(message)) {
    return "화면을 너무 빠르게 찍어 캡처가 멈췄습니다. 한 번만 더 눌러 주세요.";
  }
  if (/all_urls|activeTab/i.test(message)) {
    return "이 페이지를 캡처할 권한이 없습니다. 확장 프로그램 설정에서 1분에디터의 사이트 액세스를 모든 사이트로 바꾼 뒤 다시 시도해 주세요.";
  }
  if (/Cannot access contents|cannot be scripted|error page/i.test(message)) {
    return "이 화면은 캡처할 수 없습니다. 일반 홈페이지 탭을 연 뒤 다시 시도해 주세요.";
  }
  if (/collectBlocks|__acrossEditor|prepare is not/i.test(message)) {
    return "페이지에 연결하지 못했습니다. 새로고침한 뒤 다시 캡처해 주세요.";
  }
  return message || "캡처에 실패했습니다.";
}

async function resolveTab(requested) {
  if (requested?.tabId) {
    try {
      return await chrome.tabs.get(requested.tabId);
    } catch {
      // The tab closed between the click and the capture.
    }
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return focused;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastShotAt = 0;

async function captureShot(windowId) {
  const gap = 600 - (Date.now() - lastShotAt);
  if (lastShotAt && gap > 0) await wait(gap);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 62 });
    lastShotAt = Date.now();
    return dataUrl;
  } catch (error) {
    if (!/MAX_CAPTURE_VISIBLE_TAB|quota/i.test(error?.message || "")) throw error;
    await wait(1100);
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 62 });
    lastShotAt = Date.now();
    return dataUrl;
  }
}

async function captureTab(port, isClosed, requested) {
  const tab = await resolveTab(requested);
  if (!tab?.id) {
    send(port, { type: "error", message: "캡처할 탭을 찾지 못했습니다. 홈페이지 탭을 앞에 두고 다시 눌러 주세요." });
    return;
  }
  if (!canCapture(tab.url)) {
    send(port, {
      type: "error",
      message: tab.url
        ? "http 또는 https 홈페이지 탭을 앞에 둔 뒤 다시 캡처해 주세요."
        : "이 탭에 접근할 수 없습니다. 확장 프로그램 설정에서 1분에디터의 사이트 액세스를 모든 사이트로 바꾼 뒤 다시 시도해 주세요.",
    });
    return;
  }

  const tabId = tab.id;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/page.js"] });
    const firstBlocks = await runInPage(tabId, () => globalThis.__acrossEditor.collectBlocks());
    let covered = 0;
    let shots = 0;
    let truncated = false;
    let viewportWidth = 0;
    let viewportHeight = 0;

    while (shots < MAX_SHOTS && covered < MAX_CSS_HEIGHT) {
      if (isClosed()) return;
      const prep = await runInPage(tabId, (target, hideFixed) => globalThis.__acrossEditor.prepare(target, hideFixed), [
        covered,
        covered > 0,
      ]);
      viewportWidth = prep.viewportWidth;
      viewportHeight = prep.viewportHeight;
      const shot = planShot(covered, prep.scrollY, prep.viewportHeight, prep.totalHeight);
      if (shot.srcH < 2) {
        truncated = covered < prep.totalHeight - 2;
        break;
      }

      let dataUrl;
      try {
        dataUrl = await captureShot(tab.windowId);
      } catch (error) {
        if (!shots) throw error;
        truncated = true;
        break;
      }
      send(port, {
        type: "frame",
        dataUrl,
        srcY: shot.srcY,
        srcH: shot.srcH,
        destY: shot.destY,
        viewportWidth: prep.viewportWidth,
        viewportHeight: prep.viewportHeight,
      });
      covered += shot.srcH;
      shots += 1;
      send(port, {
        type: "progress",
        shots,
        covered: Math.round(covered),
        totalHeight: Math.round(prep.totalHeight),
      });
      if (covered >= prep.totalHeight - 2) break;
    }

    if (shots >= MAX_SHOTS || covered >= MAX_CSS_HEIGHT) {
      const finalMetrics = await runInPage(tabId, () => globalThis.__acrossEditor.metrics());
      truncated = covered < finalMetrics.totalHeight - 2;
    }

    const lastBlocks = await runInPage(tabId, () => globalThis.__acrossEditor.collectBlocks());
    const merged = mergeBlocks([firstBlocks, lastBlocks]);
    const latest = await chrome.tabs.get(tabId);

    send(port, {
      type: "done",
      blocks: merged.blocks,
      held: merged.held,
      blocksTruncated: merged.truncated,
      title: latest.title || "",
      url: latest.url || tab.url,
      truncated,
      covered: Math.round(covered),
      viewportWidth,
      viewportHeight,
    });
  } finally {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => globalThis.__acrossEditor?.restore(),
      })
      .catch(() => {});
  }
}

async function runInPage(tabId, func, args) {
  const details = { target: { tabId }, func };
  if (args) details.args = args;
  const [injected] = await chrome.scripting.executeScript(details);
  if (!injected) throw new Error("페이지에 연결하지 못했습니다.");
  return injected.result;
}
