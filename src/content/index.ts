import { buildMarkdownPayload, isDocumentReady, initTemplateFromStorage, loadTemplate, setTemplate } from './extractor';
import { startPicker, isPickerActive } from './picker';
import type { SiteTemplate } from '../types/content';

type MessageRequest =
  | { type: 'EXTRACT_CONTENT' }
  | { type: 'START_PICKER' }
  | { type: 'GET_DOMAIN' };

type MessageResponse = {
  ok: boolean;
  data?: ReturnType<typeof buildMarkdownPayload> | SiteTemplate | string;
  error?: string;
};

initTemplateFromStorage();

function doExtract(sendResponse: (response: MessageResponse) => void) {
  try {
    const payload = buildMarkdownPayload();
    sendResponse({ ok: true, data: payload });
  } catch (error) {
    console.error('[ContentPicker] 提取失败', error);
    sendResponse({ ok: false, error: (error as Error).message });
  }
}

function handleExtractContent(sendResponse: (response: MessageResponse) => void) {
  if (loadTemplate() !== null) {
    doExtract(sendResponse);
  } else {
    initTemplateFromStorage().then(() => doExtract(sendResponse));
  }
  return true;
}

chrome.runtime.onMessage.addListener((message: MessageRequest, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTENT') {
    return handleExtractContent(sendResponse);
  }

  if (message.type === 'GET_DOMAIN') {
    sendResponse({ ok: true, data: location.hostname });
    return false;
  }

  if (message.type === 'START_PICKER') {
    if (isPickerActive()) {
      sendResponse({ ok: false, error: '选择器已激活' });
      return false;
    }

    startPicker().then((tpl) => {
      if (tpl) {
        setTemplate(tpl);
        chrome.runtime.sendMessage({ type: 'SAVE_TEMPLATE', template: tpl });
      }
      sendResponse({ ok: true, data: tpl ?? undefined });
    });
    return true;
  }

  return false;
});
