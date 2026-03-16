// SoulSearch content script — extracts page context
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CONTEXT') {
    sendResponse({ context: extractContext() });
  }
  return true;
});

function extractContext() {
  const skipTags = new Set(['SCRIPT','STYLE','NAV','FOOTER','ASIDE','NOSCRIPT','IFRAME','SVG']);

  // Try semantic containers first
  const article = document.querySelector(
    'article, [role="main"], main, .content, #content, .post-content, ' +
    '[class*="article"], [class*="post"], [class*="body"], [id*="main"]'
  );
  const root = article || document.body;

  // Tree walker approach
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

  // Fallback for SPAs / dynamic pages: use innerText which includes rendered text
  if (text.length < 200) {
    const clone = document.body.cloneNode(true);
    // Remove script/style/nav/footer from clone
    ['script','style','nav','footer','aside','noscript','iframe'].forEach(tag => {
      clone.querySelectorAll(tag).forEach(el => el.remove());
    });
    const fallback = (clone.innerText || clone.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
    if (fallback.length > text.length) text = fallback;
  }

  return {
    url: location.href,
    title: document.title,
    text,
    selection: window.getSelection()?.toString() || null,
    metaDesc: document.querySelector('meta[name="description"]')?.content || null
  };
}

// Right-click context menu: "Ask SoulSearch about this"
document.addEventListener('mouseup', () => {
  const sel = window.getSelection()?.toString().trim();
  if (sel) {
    chrome.runtime.sendMessage({ type: 'SELECTION_UPDATED', selection: sel });
  }
});
