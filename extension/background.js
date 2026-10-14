const DATATRACE_ORIGIN = "https://tv.datatracetitle.com";

// Disable side panel globally by default so non-DataTrace tabs (Google Sheets, etc.) never show it
chrome.sidePanel.setOptions({ enabled: false }).catch(console.error);

// Enable side panel only on DataTrace tabs
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;
  try {
    const url = new URL(tab.url);
    if (url.origin === DATATRACE_ORIGIN) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'panel.html',
        enabled: true
      });
    } else {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false
      });
    }
  } catch {}
});

// When user clicks the extension action icon on a DataTrace tab, open the side panel for that tab specifically
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return;
  try {
    const url = new URL(tab.url);
    if (url.origin === DATATRACE_ORIGIN) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (err) {
    console.error('Error opening side panel for tab:', err);
  }
});
