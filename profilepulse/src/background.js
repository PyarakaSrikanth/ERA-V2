// Background service worker for ProfilePulse

const SETTINGS_KEYS = {
  llmProvider: 'pp_llm_provider',
  apiKey: 'pp_api_key',
  model: 'pp_model',
  saveAs: 'pp_save_as',
  emailDigest: 'pp_email_digest',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([SETTINGS_KEYS.llmProvider, SETTINGS_KEYS.model, SETTINGS_KEYS.saveAs], (cfg) => {
    const updates = {};
    if (!cfg[SETTINGS_KEYS.llmProvider]) updates[SETTINGS_KEYS.llmProvider] = 'openai';
    if (!cfg[SETTINGS_KEYS.model]) updates[SETTINGS_KEYS.model] = 'gpt-4o-mini';
    if (typeof cfg[SETTINGS_KEYS.saveAs] === 'undefined') updates[SETTINGS_KEYS.saveAs] = true;
    if (Object.keys(updates).length) chrome.storage.sync.set(updates);
  });

  chrome.contextMenus.create({
    id: 'pp-save-linkedin',
    title: 'Save to ProfilePulse',
    contexts: ['link', 'selection', 'page'],
    documentUrlPatterns: ['https://www.linkedin.com/*']
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'PP_CALL_LLM') {
        const result = await callLLM(message.payload);
        sendResponse({ ok: true, result });
      } else if (message?.type === 'PP_GET_STATUS') {
        const cfg = await chrome.storage.sync.get([SETTINGS_KEYS.llmProvider, SETTINGS_KEYS.apiKey, SETTINGS_KEYS.model]);
        sendResponse({ ok: true, status: {
          provider: cfg[SETTINGS_KEYS.llmProvider] || 'openai',
          model: cfg[SETTINGS_KEYS.model] || 'gpt-4o-mini',
          hasKey: Boolean(cfg[SETTINGS_KEYS.apiKey])
        }});
      } else if (message?.type === 'PP_DOWNLOAD_ARTIFACTS') {
        await downloadArtifacts(message.payload);
        sendResponse({ ok: true });
      } else if (message?.type === 'PP_GET_PREFS') {
        const cfg = await chrome.storage.sync.get([SETTINGS_KEYS.saveAs]);
        sendResponse({ ok: true, prefs: { saveAs: Boolean(cfg[SETTINGS_KEYS.saveAs]) }});
      } else {
        sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'pp-save-linkedin' && tab?.id) {
      const url = info.linkUrl || info.pageUrl;
      chrome.tabs.sendMessage(tab.id, { type: 'PP_SAVE_FROM_LINK', url, selectionText: info.selectionText || '' });
    }
  } catch (e) {
    // no-op
  }
});

async function callLLM({ systemPrompt, userPrompt, temperature = 0.7, maxTokens = 600 }) {
  const cfg = await chrome.storage.sync.get([SETTINGS_KEYS.llmProvider, SETTINGS_KEYS.apiKey, SETTINGS_KEYS.model]);
  const provider = cfg[SETTINGS_KEYS.llmProvider] || 'openai';
  const apiKey = cfg[SETTINGS_KEYS.apiKey];
  const model = cfg[SETTINGS_KEYS.model] || 'gpt-4o-mini';
  if (!apiKey) throw new Error('Missing API key. Set it in Options.');

  if (provider === 'openai') {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          systemPrompt ? { role: 'system', content: systemPrompt } : null,
          { role: 'user', content: userPrompt }
        ].filter(Boolean),
      }),
    });
    if (!resp.ok) {
      if (resp.status === 401) throw new Error('Unauthorized. Check your API key.');
      if (resp.status === 429) throw new Error('Rate limited. Please try again later.');
      throw new Error(`LLM HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

async function downloadArtifacts({ noteMarkdown, metadataJson, baseFileName = 'profilepulse_note' }) {
  const { [SETTINGS_KEYS.saveAs]: saveAsPref } = await chrome.storage.sync.get([SETTINGS_KEYS.saveAs]);
  const ts = new Date().toISOString().replaceAll(':', '-');
  const safeBase = `${baseFileName}_${ts}`;
  await chrome.downloads.download({
    url: URL.createObjectURL(new Blob([noteMarkdown], { type: 'text/markdown' })),
    filename: `ProfilePulse/ResearchVault/${safeBase}/note.md`,
    saveAs: Boolean(saveAsPref),
  });
  await chrome.downloads.download({
    url: URL.createObjectURL(new Blob([JSON.stringify(metadataJson, null, 2)], { type: 'application/json' })),
    filename: `ProfilePulse/ResearchVault/${safeBase}/metadata.json`,
    saveAs: false,
  });
}

