import type { SiteTemplate } from '../types/content';

type RuntimeMessage =
  | { type: 'FETCH_CONTENT'; tabId?: number }
  | { type: 'START_PICKER'; tabId?: number }
  | { type: 'SAVE_TEMPLATE'; template: SiteTemplate }
  | { type: 'GET_TEMPLATES' }
  | { type: 'DELETE_TEMPLATE'; domain: string }
  | { type: 'GET_DOMAIN'; tabId?: number };

type GenericResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

function sendToTab(tabId: number, message: { type: string }, sendResponse: (r: GenericResponse) => void) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      sendResponse({ ok: false, error: lastError.message });
      return;
    }
    sendResponse(response ?? { ok: false, error: 'EMPTY_RESPONSE' });
  });
}

function ensureContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_DOMAIN' }, (response) => {
      if (chrome.runtime.lastError) {
        chrome.scripting
          .executeScript({ target: { tabId }, files: ['content.js'] })
          .then(() => resolve())
          .catch(reject);
      } else if (response) {
        resolve();
      } else {
        resolve();
      }
    });
  });
}

function getTargetTabId(message: { tabId?: number }, sender: chrome.runtime.MessageSender): number | undefined {
  return message.tabId ?? sender.tab?.id;
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === 'FETCH_CONTENT') {
    const tabId = getTargetTabId(message, sender);
    if (!tabId) { sendResponse({ ok: false, error: 'NO_ACTIVE_TAB' }); return; }

    ensureContentScript(tabId)
      .then(() => sendToTab(tabId, { type: 'EXTRACT_CONTENT' }, sendResponse))
      .catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
    return true;
  }

  if (message.type === 'START_PICKER') {
    const tabId = getTargetTabId(message, sender);
    if (!tabId) { sendResponse({ ok: false, error: 'NO_ACTIVE_TAB' }); return; }

    ensureContentScript(tabId)
      .then(() => sendToTab(tabId, { type: 'START_PICKER' }, sendResponse))
      .catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
    return true;
  }

  if (message.type === 'GET_DOMAIN') {
    const tabId = getTargetTabId(message, sender);
    if (!tabId) { sendResponse({ ok: false, error: 'NO_ACTIVE_TAB' }); return; }

    ensureContentScript(tabId)
      .then(() => sendToTab(tabId, { type: 'GET_DOMAIN' }, sendResponse))
      .catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
    return true;
  }

  if (message.type === 'SAVE_TEMPLATE') {
    chrome.storage.local.get('siteTemplates', (result) => {
      const templates: Record<string, SiteTemplate> = result.siteTemplates ?? {};
      templates[message.template.domain] = message.template;
      chrome.storage.local.set({ siteTemplates: templates }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (message.type === 'GET_TEMPLATES') {
    chrome.storage.local.get('siteTemplates', (result) => {
      sendResponse({ ok: true, data: result.siteTemplates ?? {} });
    });
    return true;
  }

  if (message.type === 'DELETE_TEMPLATE') {
    chrome.storage.local.get('siteTemplates', (result) => {
      const templates: Record<string, SiteTemplate> = result.siteTemplates ?? {};
      delete templates[message.domain];
      chrome.storage.local.set({ siteTemplates: templates }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  return false;
});
