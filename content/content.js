// SoulSearch content script — extracts page context
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CONTEXT') {
    sendResponse({ context: extractContext() });
  }
  return true;
});

function extractContext() {
  const url = location.href;
  const title = document.title;
  const metaDesc = document.querySelector('meta[name="description"]')?.content || null;
  const selection = window.getSelection()?.toString() || null;

  // ── Colab-specific extraction ────────────────────────────────────────────
  if (url.includes('colab.research.google.com') || url.includes('colab.google')) {
    const chunks = [];

    // Markdown/text cells
    document.querySelectorAll(
      '.text-cell-preview, .cell-text-output, colab-rich-text-cell'
    ).forEach(el => {
      const t = el.innerText || el.textContent || '';
      if (t.trim().length > 10) chunks.push(t.trim());
    });

    // Code cells
    document.querySelectorAll(
      'pre.CodeMirror-line, .view-line, .codecell-input, colab-code-cell'
    ).forEach(el => {
      const t = el.innerText || el.textContent || '';
      if (t.trim().length > 5) chunks.push(t.trim());
    });

    // Cell outputs
    document.querySelectorAll('.output-container, .cell-output-ipywidget-background').forEach(el => {
      const t = el.innerText || '';
      if (t.trim().length > 10) chunks.push('[Output] ' + t.trim().slice(0, 500));
    });

    const text = chunks.join('\n').slice(0, 8000);
    if (text.length > 100) {
      return { url, title, text, selection, metaDesc };
    }
  }

  // ── General extraction ───────────────────────────────────────────────────
  const skipTags = new Set(['SCRIPT','STYLE','NAV','FOOTER','ASIDE','NOSCRIPT','IFRAME','SVG']);

  const article = document.querySelector(
    'article, [role="main"], main, .content, #content, .post-content, ' +
    '[class*="article"], [class*="post-body"], [id*="main-content"]'
  );
  const root = article || document.body;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el) {
        if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return node.textContent.trim().length > 15
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  const chunks = [];
  let node;
  while ((node = walker.nextNode()) && chunks.join(' ').length < 8000) {
    chunks.push(node.textContent.trim());
  }

  let text = chunks.join(' ').replace(/\s+/g, ' ').trim();

  // SPA fallback: use innerText when tree walker yields thin content
  if (text.length < 300) {
    try {
      const clone = document.body.cloneNode(true);
      ['script','style','nav','footer','aside','noscript','iframe'].forEach(tag => {
        clone.querySelectorAll(tag).forEach(el => el.remove());
      });
      const fallback = (clone.innerText || clone.textContent || '')
        .replace(/\s+/g, ' ').trim().slice(0, 8000);
      if (fallback.length > text.length) text = fallback;
    } catch(e) { /* fallback failed */ }
  }

  return { url, title, text, selection, metaDesc };
}

// Right-click selection tracking
document.addEventListener('mouseup', () => {
  const sel = window.getSelection()?.toString().trim();
  if (sel) chrome.runtime.sendMessage({ type: 'SELECTION_UPDATED', selection: sel });
});
