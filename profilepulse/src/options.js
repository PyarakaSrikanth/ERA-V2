const KEYS = {
  provider: 'pp_llm_provider',
  model: 'pp_model',
  api: 'pp_api_key',
  saveAs: 'pp_save_as',
};

function $(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await chrome.storage.sync.get([KEYS.provider, KEYS.model, KEYS.api]);
  $('provider').value = cfg[KEYS.provider] || 'openai';
  $('model').value = cfg[KEYS.model] || 'gpt-4o-mini';
  $('api').value = cfg[KEYS.api] || '';
  const cfg2 = await chrome.storage.sync.get([KEYS.saveAs]);
  const saveAs = typeof cfg2[KEYS.saveAs] === 'undefined' ? true : Boolean(cfg2[KEYS.saveAs]);
  if (document.getElementById('saveAs')) document.getElementById('saveAs').checked = saveAs;
});

$('save').addEventListener('click', async () => {
  const updates = {};
  updates[KEYS.provider] = $('provider').value;
  updates[KEYS.model] = $('model').value;
  updates[KEYS.api] = $('api').value;
  const saveAsEl = document.getElementById('saveAs');
  if (saveAsEl) updates[KEYS.saveAs] = Boolean(saveAsEl.checked);
  await chrome.storage.sync.set(updates);
  const status = document.getElementById('status');
  status.textContent = 'Saved. You can now use AI drafting in the sidebar.';
  setTimeout(() => status.textContent = '', 3000);
});

