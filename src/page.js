(() => {
  function metrics() {
    const root = document.scrollingElement || document.documentElement;
    return {
      totalHeight: Math.max(
        root.scrollHeight,
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      ),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      scrollY: window.scrollY,
    };
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isShown(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }

  function hideFixedElements() {
    const nodes = document.body?.querySelectorAll("*") || [];
    for (const el of nodes) {
      if (el.dataset.aeHidden === "1") continue;
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > window.innerHeight * 0.85 || rect.width < 8 || rect.height < 8) continue;
      el.dataset.aeHidden = "1";
      el.dataset.aeVisibility = el.style.getPropertyValue("visibility");
      el.dataset.aePriority = el.style.getPropertyPriority("visibility");
      el.style.setProperty("visibility", "hidden", "important");
    }
  }

  function restore() {
    for (const el of document.querySelectorAll('[data-ae-hidden="1"]')) {
      if (el.dataset.aeVisibility) {
        el.style.setProperty("visibility", el.dataset.aeVisibility, el.dataset.aePriority || "");
      } else {
        el.style.removeProperty("visibility");
      }
      delete el.dataset.aeHidden;
      delete el.dataset.aeVisibility;
      delete el.dataset.aePriority;
    }
    if (savedScroll !== null) {
      window.scrollTo(0, savedScroll);
      savedScroll = null;
    }
  }

  function roleHint(tag, text) {
    const name = String(tag || "").toLowerCase();
    const length = [...text].length;
    if (name === "h1") return "제목";
    if (name === "button" || (name === "a" && length <= 24)) return "버튼";
    if (/^h[2-4]$/.test(name) && length <= 40) return "배너";
    if (/^h[2-6]$/.test(name)) return "소제목";
    if (length <= 28) return "배너";
    return "설명";
  }

  function blockHost(start) {
    let host = start;
    while (host.parentElement && host.parentElement !== document.body) {
      if (/^(h[1-6]|p|li|button|a)$/i.test(host.tagName)) break;
      const parent = host.parentElement;
      const same = cleanText(parent.innerText) === cleanText(host.innerText);
      const hostInline = /^(span|strong|em|b|i|u|font|small|mark|abbr)$/i.test(host.tagName);
      const parentBlock = /^(h[1-6]|p|li|button|a|td|th|dt|dd|figcaption|blockquote|label|div)$/i.test(parent.tagName);
      if (same) {
        host = parent;
        if (/^(h[1-6]|p|li|button|a)$/i.test(host.tagName)) break;
        continue;
      }
      if (hostInline && parentBlock && cleanText(parent.innerText).length <= 500) {
        host = parent;
      }
      break;
    }
    const parent = host.parentElement;
    if (parent && /^(h[1-6]|button|a)$/i.test(parent.tagName) && cleanText(parent.innerText).length <= 80) {
      host = parent;
    }
    return host;
  }

  function roleTag(el) {
    const special = el.closest("h1,h2,h3,h4,h5,h6,button,a,[role='button']");
    if (!special) return el.tagName.toLowerCase();
    if (special.getAttribute("role") === "button") return "button";
    return special.tagName.toLowerCase();
  }

  function textBounds(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((rect) => rect.width >= 2 && rect.height >= 2);
    const boxes = rects.length ? rects : [el.getBoundingClientRect()];
    const top = Math.min(...boxes.map((rect) => rect.top));
    const left = Math.min(...boxes.map((rect) => rect.left));
    const right = Math.max(...boxes.map((rect) => rect.right));
    const bottom = Math.max(...boxes.map((rect) => rect.bottom));
    return {
      top,
      left,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
      lines: boxes.slice(0, 8).map((rect) => ({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      })),
    };
  }

  function collectBlocks() {
    const blocks = [];
    const seen = new Set();
    if (!document.body) return blocks;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (cleanText(node.nodeValue).length < 2) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("svg, script, style, noscript, textarea")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      const host = blockHost(node.parentElement);
      node = walker.nextNode();
      if (!host || seen.has(host)) continue;
      seen.add(host);
      if (host.closest("svg, script, style, noscript, textarea")) continue;
      if (!isShown(host)) continue;
      const original = cleanText(host.innerText);
      if (original.length < 2 || original.length > 500) continue;
      const bounds = textBounds(host);
      const top = bounds.top + window.scrollY;
      const tag = roleTag(host);
      const pageHeight = metrics().totalHeight;
      blocks.push({
        role: roleHint(tag, original),
        original,
        top,
        left: bounds.left + window.scrollX,
        width: bounds.width,
        height: bounds.height,
        lines: bounds.lines,
        tag,
        inFooter: Boolean(host.closest("footer, [role='contentinfo'], [class*='footer' i], [id*='footer' i]")),
        nearBottom: pageHeight > 0 && top > pageHeight * 0.9,
      });
    }
    blocks.sort((a, b) => a.top - b.top || a.left - b.left);
    return blocks;
  }

  function waitForSettle() {
    const pending = [...document.images].filter((img) => {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && !img.complete;
    });
    const loaded = Promise.all(
      pending.map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }),
      ),
    );
    return Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 900))]).then(
      () => new Promise((resolve) => setTimeout(resolve, 120)),
    );
  }

  let savedScroll = null;

  async function prepare(covered, hideFixed) {
    if (savedScroll === null) savedScroll = window.scrollY;
    if (hideFixed) hideFixedElements();
    const before = metrics();
    const maxScroll = Math.max(0, before.totalHeight - before.viewportHeight);
    window.scrollTo(0, Math.min(covered, maxScroll));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await waitForSettle();
    return metrics();
  }

  globalThis.__acrossEditor = {
    metrics,
    prepare,
    collectBlocks,
    restore,
  };
})();
