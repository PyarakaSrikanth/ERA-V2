// Background service worker for ProfilePulse

const SETTINGS_KEYS = {
  llmProvider: 'pp_llm_provider',
  apiKey: 'pp_api_key',
  model: 'pp_model',
  emailDigest: 'pp_email_digest',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([SETTINGS_KEYS.llmProvider, SETTINGS_KEYS.model], (cfg) => {
    const updates = {};
    if (!cfg[SETTINGS_KEYS.llmProvider]) updates[SETTINGS_KEYS.llmProvider] = 'openai';
    if (!cfg[SETTINGS_KEYS.model]) updates[SETTINGS_KEYS.model] = 'gpt-4o-mini';
    if (Object.keys(updates).length) chrome.storage.sync.set(updates);
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
      } else {
        sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
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
  const ts = new Date().toISOString().replaceAll(':', '-');
  const safeBase = `${baseFileName}_${ts}`;
  await chrome.downloads.download({
    url: URL.createObjectURL(new Blob([noteMarkdown], { type: 'text/markdown' })),
    filename: `ProfilePulse/ResearchVault/${safeBase}/note.md`,
    saveAs: false,
  });
  await chrome.downloads.download({
    url: URL.createObjectURL(new Blob([JSON.stringify(metadataJson, null, 2)], { type: 'application/json' })),
    filename: `ProfilePulse/ResearchVault/${safeBase}/metadata.json`,
    saveAs: false,
  });
}

