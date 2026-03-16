// SoulSearch content script -- extracts page context + browser automation
var _snapshotMap = {}; // elementId -> DOM element, persists between messages

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'GET_CONTEXT') {
    sendResponse({ context: extractContext() });
    return true;
  }
  if (msg.type === 'GET_SNAPSHOT') {
    sendResponse({ snapshot: getSnapshot() });
    return true;
  }
  if (msg.type === 'EXECUTE_ACTION') {
    executeAction(msg.action, msg.elementId, msg.value)
      .then(function(r) { sendResponse({ result: r }); })
      .catch(function(e) { sendResponse({ error: e.message }); });
    return true; // async response
  }
  return false;
});

// ---- Context extraction (plain text for Q&A) ---------------------------

function extractContext() {
  var url = location.href;
  var title = document.title;
  var metaDesc = null;
  var metaEl = document.querySelector('meta[name="description"]');
  if (metaEl) metaDesc = metaEl.content;
  var selection = null;
  if (window.getSelection) selection = window.getSelection().toString() || null;

  var skip = document.querySelectorAll('script,style,nav,header,footer,aside,noscript,iframe');
  var tempRemoved = [];
  skip.forEach(function(el) {
    if (el.parentNode) {
      tempRemoved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      el.parentNode.removeChild(el);
    }
  });

  var text = (document.body.innerText || document.body.textContent || '').trim();
  text = text.replace(/\t| {3,}/g, ' ').replace(/\n{4,}/g, '\n\n').slice(0, 8000);

  // Restore removed elements
  tempRemoved.forEach(function(item) {
    item.parent.insertBefore(item.el, item.next);
  });

  return { url: url, title: title, text: text, selection: selection, metaDesc: metaDesc };
}

// ---- Snapshot (numbered interactive elements for agent) ----------------

function getSnapshot() {
  _snapshotMap = {};
  var id = 1;
  var elements = [];

  var sel = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), ' +
            'textarea:not([disabled]), select:not([disabled]), [role="button"], [role="link"]';

  document.querySelectorAll(sel).forEach(function(el) {
    if (!isVisible(el)) return;
    var info = {
      id: id,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      text: getElementLabel(el),
      href: el.href || null
    };
    _snapshotMap[id] = el;
    elements.push(info);
    id++;
  });

  return {
    url: location.href,
    title: document.title,
    elements: elements,
    pageText: (document.body.innerText || '').slice(0, 1500)
  };
}

function isVisible(el) {
  var rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  var style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function getElementLabel(el) {
  var text = (el.getAttribute('aria-label') || el.getAttribute('title') ||
              el.getAttribute('placeholder') || el.value || el.innerText || el.textContent || '').trim();
  return text.slice(0, 80);
}

// ---- Action execution --------------------------------------------------

async function executeAction(action, elementId, value) {
  if (action === 'scroll') {
    var amount = 350;
    if (value === 'down') window.scrollBy(0, amount);
    else if (value === 'up') window.scrollBy(0, -amount);
    else if (value === 'top') window.scrollTo(0, 0);
    else if (value === 'bottom') window.scrollTo(0, document.body.scrollHeight);
    return { done: true, scrolled: value };
  }

  if (action === 'navigate') {
    window.location.href = value;
    return { done: true, navigating: value };
  }

  var el = _snapshotMap[elementId];
  if (!el) throw new Error('Element ' + elementId + ' not found -- take a new snapshot first');

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(150);

  if (action === 'click') {
    el.focus();
    el.click();
    await sleep(300);
    return { done: true, clicked: getElementLabel(el) };
  }

  if (action === 'type') {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { done: true, typed: value, into: getElementLabel(el) };
  }

  if (action === 'select') {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { done: true, selected: value };
  }

  throw new Error('Unknown action: ' + action);
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Right-click selection tracking
document.addEventListener('mouseup', function() {
  if (window.getSelection) {
    var sel = window.getSelection().toString().trim();
    if (sel) chrome.runtime.sendMessage({ type: 'SELECTION_UPDATED', selection: sel });
  }
});
