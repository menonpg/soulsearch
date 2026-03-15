// SoulSearch content script — extracts page context
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CONTEXT') {
    sendResponse({ context: extractContext() });
  }
  return true;
});

function extractContext() {
  // Extract meaningful text — skip nav, footer, scripts, ads
  const skipTags = new Set(['SCRIPT','STYLE','NAV','FOOTER','HEADER','ASIDE','NOSCRIPT','IFRAME']);
  const article = document.querySelector('article, [role="main"], main, .content, #content, .post-content');
  const root = article || document.body;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el) {
        if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return node.textContent.trim().length > 20
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  const chunks = [];
  let node;
  while ((node = walker.nextNode()) && chunks.join(' ').length < 8000) {
    chunks.push(node.textContent.trim());
  }

  return {
    url: location.href,
    title: document.title,
    text: chunks.join(' ').replace(/\s+/g, ' ').trim(),
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
