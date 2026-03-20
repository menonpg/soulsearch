// SoulSearch background service worker
// Handles: context menus, memory sync, session tracking

// Enable side panel (don't open on action click - popup handles that)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'soulsearch-ask',
    title: 'Ask SoulSearch: "%s"',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'soulsearch-page',
    title: 'Summarize this page with SoulSearch',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'soulsearch-save',
    title: 'Save to SoulSearch memory',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  chrome.storage.local.set({
    pendingAction: {
      type: info.menuItemId,
      text: info.selectionText || '',
      url: tab?.url || '',
      title: tab?.title || '',
      timestamp: Date.now()
    }
  });
  // Open popup to handle the action
  chrome.action.openPopup().catch(() => {
    // Fallback: open side panel
    chrome.sidePanel.open({ tabId: tab.id });
  });
});

// Track browsing for memory context (domain-level only, no full URLs unless user opts in)
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || tab.url.startsWith('chrome://')) return;

  const domain = new URL(tab.url).hostname;
  const stored = await chrome.storage.local.get('visitedDomains');
  const domains = stored.visitedDomains || {};
  domains[domain] = (domains[domain] || 0) + 1;
  chrome.storage.local.set({ visitedDomains: domains });
});
