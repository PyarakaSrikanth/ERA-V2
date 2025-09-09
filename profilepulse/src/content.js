// ProfilePulse content script: injects sidebar UI, observes LinkedIn feed, saves trends, and drafts posts

(function initProfilePulse() {
  if (window.__PROFILE_PULSE_LOADED__) return;
  window.__PROFILE_PULSE_LOADED__ = true;

  const ACCENT = '#6B8AFB';

  const state = {
    sidebarOpen: false,
    detectedPosts: new Map(),
    scanTimer: null,
    hasApiKey: false,
  };

  function createSidebar() {
    const container = document.createElement('div');
    container.className = 'pp-sidebar';
    container.innerHTML = `
      <div class="pp-header">
        <div class="pp-logo">ProfilePulse</div>
        <button class="pp-close" aria-label="Close">✕</button>
      </div>
      <div class="pp-tabs">
        <button data-tab="insights" class="active">Insights</button>
        <button data-tab="trends">Trends</button>
        <button data-tab="composer">Composer</button>
      </div>
      <div class="pp-panels">
        <section data-panel="insights" class="active">
          <div class="pp-card">
            <div class="pp-card-title">Today</div>
            <div class="pp-grid">
              <div class="pp-metric"><div class="pp-metric-value" id="pp-metric-posts">–</div><div class="pp-metric-label">Posts scanned</div></div>
              <div class="pp-metric"><div class="pp-metric-value" id="pp-metric-trending">–</div><div class="pp-metric-label">Trending found</div></div>
            </div>
          </div>
          <div class="pp-card">
            <div class="pp-card-title">Optimal windows</div>
            <div id="pp-best-windows" class="pp-pills"></div>
          </div>
        </section>
        <section data-panel="trends">
          <div id="pp-trend-list" class="pp-list"></div>
        </section>
        <section data-panel="composer">
          <div class="pp-card">
            <div class="pp-row" style="justify-content: space-between; align-items: center;">
              <div class="pp-status" id="pp-api-status"><span class="pp-loader" id="pp-api-loader"></span><span>Checking API…</span></div>
            </div>
            <label class="pp-label">Goal</label>
            <select id="pp-goal">
              <option value="insight">Share insight</option>
              <option value="story">Tell a story</option>
              <option value="tips">Tactical tips</option>
              <option value="contrarian">Contrarian take</option>
            </select>
            <label class="pp-label">Draft</label>
            <textarea id="pp-draft" rows="8" placeholder="Paste your idea or let AI help you craft a strong hook..."></textarea>
            <div class="pp-row">
              <label class="pp-label">Tone</label>
              <select id="pp-tone">
                <option>professional</option>
                <option>friendly</option>
                <option>bold</option>
                <option>analytical</option>
              </select>
              <button id="pp-draft-ai" class="pp-primary" disabled title="Configure API key in Options to enable">Predict & Draft</button>
            </div>
            <div id="pp-ai-output" class="pp-output" hidden></div>
          </div>
        </section>
      </div>
    `;
    document.body.appendChild(container);

    const closeBtn = container.querySelector('.pp-close');
    closeBtn?.addEventListener('click', toggleSidebar);

    const tabs = container.querySelectorAll('.pp-tabs button');
    tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    const draftBtn = container.querySelector('#pp-draft-ai');
    draftBtn?.addEventListener('click', onDraftAI);

    return container;
  }

  function ensureToggle() {
    if (document.querySelector('.pp-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'pp-fab';
    fab.title = 'Open ProfilePulse';
    fab.innerHTML = '<span class="pp-fab-dot"></span>';
    fab.addEventListener('click', toggleSidebar);
    document.body.appendChild(fab);
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    const el = document.querySelector('.pp-sidebar');
    if (el) {
      el.classList.toggle('open', state.sidebarOpen);
    }
  }

  function switchTab(tab) {
    document.querySelectorAll('.pp-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.pp-panels > section').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  }

  function observeFeed() {
    const trendList = document.getElementById('pp-trend-list');
    const postsMetric = document.getElementById('pp-metric-posts');
    const trendingMetric = document.getElementById('pp-metric-trending');

    const root = document.querySelector('main') || document.body;
    const mo = new MutationObserver(() => scheduleScan());
    mo.observe(root, { childList: true, subtree: true });
    scheduleScan();

    function scheduleScan() {
      if (state.scanTimer) return;
      state.scanTimer = setTimeout(() => { state.scanTimer = null; scanNow(); }, 250);
    }

    function scanNow() {
      const posts = document.querySelectorAll('div.feed-shared-update-v2, div.occludable-update, article, div.update-components-actor');
      let trendingCount = 0;
      postsMetric && (postsMetric.textContent = String(posts.length));
      posts.forEach(node => {
        if (state.detectedPosts.has(node)) return;
        const post = extractPost(node);
        if (!post) return;
        state.detectedPosts.set(node, post);
        injectSaveButton(node, post);
        if (post.velocityScore >= 0.7) trendingCount += 1;
      });
      trendingMetric && (trendingMetric.textContent = String(trendingCount));
      renderTrendList();
      renderBestWindows();
    }

    function renderTrendList() {
      if (!trendList) return;
      const items = [...state.detectedPosts.values()]
        .filter(p => p.velocityScore >= 0.7)
        .sort((a,b) => b.velocityScore - a.velocityScore)
        .slice(0, 20);
      const trendIcon = chrome.runtime.getURL('assets/icons/trend.svg');
      const saveIcon = chrome.runtime.getURL('assets/icons/save.svg');
      const draftIcon = chrome.runtime.getURL('assets/icons/draft.svg');
      trendList.innerHTML = items.map(p => `
        <div class="pp-list-item">
          <div>
            <div class="pp-item-title"><img class="pp-icon-inline" src="${trendIcon}" alt=""/> ${escapeHtml(p.author || 'Unknown')} <span class="pp-chip">Hot</span></div>
            <div class="pp-item-sub">❤ ${p.likes}  💬 ${p.comments}  # ${p.hashtags.slice(0,3).join(' ')} • ${escapeHtml(explainWhyTrending(p))}</div>
          </div>
          <div class="pp-row">
            <button class="pp-icon-btn" title="Draft from trend" data-draft="${encodeURIComponent(p.url || location.href)}"><img class="pp-icon" src="${draftIcon}" alt="Draft"/></button>
            <button class="pp-icon-btn" title="Save note" data-save="${encodeURIComponent(p.url || location.href)}"><img class="pp-icon" src="${saveIcon}" alt="Save"/></button>
          </div>
        </div>
      `).join('');
      trendList.querySelectorAll('button[data-save]').forEach(btn => {
        btn.addEventListener('click', () => {
          const url = decodeURIComponent(btn.getAttribute('data-save'));
          const match = items.find(i => (i.url || location.href) === url);
          if (match) openSaveDialog(match);
        });
      });
      trendList.querySelectorAll('button[data-draft]').forEach(btn => {
        btn.addEventListener('click', () => {
          const url = decodeURIComponent(btn.getAttribute('data-draft'));
          const match = items.find(i => (i.url || location.href) === url);
          if (match) {
            const seed = buildDraftFromTrend(match);
            setDraftContent(seed);
            switchTab('composer');
            toggleSidebar();
            toggleSidebar();
          }
        });
      });
    }
  }

  function extractPost(node) {
    try {
      const text = (node.textContent || '').trim();
      const hashtags = Array.from(new Set((text.match(/#\w+/g) || []).map(s => s.trim())));
      const likesEl = node.querySelector('[aria-label*="reactions" i], [data-test-reactions-count], .social-counts-reactions__num');
      const commentsEl = node.querySelector('[aria-label*="comments" i], [data-test-comments-count]');
      const timeEl = node.querySelector('time, [data-test-timestamp]');
      const likes = likesEl ? parseCount(likesEl.textContent) : parseCount(text.match(/(\d+[,.]?\d*[kK]?)(?=\s*(likes|reactions))/i)?.[1]);
      const comments = commentsEl ? parseCount(commentsEl.textContent) : parseCount(text.match(/(\d+[,.]?\d*[kK]?)(?=\s*comments?)/i)?.[1]);
      let hours = 24;
      if (timeEl?.getAttribute('datetime')) {
        const dt = new Date(timeEl.getAttribute('datetime'));
        hours = Math.max(1, (Date.now() - dt.getTime()) / 36e5);
      } else {
        const match = text.match(/(\d+)\s*([smhdw])/i);
        if (match) {
          const n = parseInt(match[1], 10);
          const u = match[2].toLowerCase();
          const map = { s: 1/3600, m: 1/60, h: 1, d: 24, w: 24*7 };
          hours = Math.max(1, n * (map[u] || 1));
        }
      }
      const author = node.querySelector('span.update-components-actor__title, a.app-aware-link, span.feed-shared-actor__title')?.textContent?.trim();
      const url = node.querySelector('a.app-aware-link[href*="/feed/update/"]')?.href || location.href;
      const engagement = (likes + comments * 2);
      const velocity = engagement / Math.max(1, hours);
      const velocityScore = Math.max(0, Math.min(1, normalize(velocity, 0, 200)));
      return { text, hashtags, likes, comments, hours, author, url, velocityScore };
    } catch (e) {
      return null;
    }
  }

  function injectSaveButton(node, post) {
    const already = node.querySelector('.pp-save');
    if (already) return;
    const btn = document.createElement('button');
    btn.className = 'pp-save';
    btn.textContent = 'Pulse';
    btn.title = 'Save trend note';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSaveDialog(post);
    });
    (node.querySelector('footer') || node).appendChild(btn);
  }

  function openSaveDialog(post) {
    const dlg = document.createElement('div');
    dlg.className = 'pp-dialog';
    dlg.innerHTML = `
      <div class="pp-dialog-card">
        <div class="pp-dialog-title">Save Trend Note</div>
        <label class="pp-label">Tags</label>
        <input id="pp-tags" value="${escapeHtml(post.hashtags.join(' '))}" />
        <label class="pp-label">Angle idea</label>
        <textarea id="pp-note" rows="4" placeholder="Hook, angle, outline snippet..."></textarea>
        <div class="pp-row end">
          <button class="pp-secondary" id="pp-cancel">Cancel</button>
          <button class="pp-primary" id="pp-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector('#pp-cancel')?.addEventListener('click', () => dlg.remove());
    dlg.querySelector('#pp-save')?.addEventListener('click', async () => {
      const tags = dlg.querySelector('#pp-tags')?.value || '';
      const note = dlg.querySelector('#pp-note')?.value || '';
      const md = buildNoteMarkdown(post, note, tags);
      const metadata = buildMetadata(post, tags);
      await chrome.runtime.sendMessage({ type: 'PP_DOWNLOAD_ARTIFACTS', payload: { noteMarkdown: md, metadataJson: metadata, baseFileName: slugify((post.hashtags[0] || post.author || 'trend')) } });
      showToast('Saved to ResearchVault');
      dlg.remove();
    });
  }

  async function onDraftAI() {
    const tone = document.getElementById('pp-tone')?.value || 'professional';
    const goal = document.getElementById('pp-goal')?.value || 'insight';
    const draft = document.getElementById('pp-draft')?.value || '';
    const systemPrompt = `You are ProfilePulse, a LinkedIn post writing expert. Produce viral-leaning but credible posts with: 1) a strong but honest hook, 2) a tight body (3-6 bullets or short lines), 3) an example/story, 4) a single clear CTA, 5) 3-5 relevant hashtags. Keep it scannable.`;
    const userPrompt = `Tone: ${tone}\nGoal: ${goal}\nContext or raw draft:\n${draft}\n\nReturn TWO variants separated by a line with three dashes (---).`;
    const out = document.getElementById('pp-ai-output');
    out.hidden = false;
    out.innerHTML = '<div class="pp-status"><span class="pp-loader"></span><span>Scoring and drafting…</span></div>';
    try {
      const { ok, result, error } = await chrome.runtime.sendMessage({ type: 'PP_CALL_LLM', payload: { systemPrompt, userPrompt, temperature: 0.7, maxTokens: 450 } });
      if (!ok) throw new Error(error || 'LLM failed');
      out.innerHTML = '';
      const variants = result.split(/\n\-\-\-\n/).slice(0,2);
      variants.forEach((v, i) => {
        const card = document.createElement('div');
        card.className = 'pp-variant';
        const scored = computeViralityScore(v);
        card.innerHTML = `<div class=\"pp-variant-title\">Variant ${i+1} <span class=\"pp-score\">${scored.score}</span></div><pre class=\"pp-pre\">${escapeHtml(v.trim())}</pre><div class=\"pp-item-sub\">${escapeHtml(scored.reason)}</div><button class=\"pp-secondary\">Copy</button>`;
        card.querySelector('button')?.addEventListener('click', () => navigator.clipboard.writeText(v.trim()));
        out.appendChild(card);
      });
    } catch (e) {
      out.innerHTML = `<div class="pp-status bad">Error: ${escapeHtml(e?.message || String(e))}</div>`;
    }
  }

  function setDraftContent(text) {
    const el = document.getElementById('pp-draft');
    if (el) { el.value = text; }
  }

  function buildDraftFromTrend(p) {
    const tags = p.hashtags.slice(0,3).join(' ');
    return `HOOK: ${p.author} just sparked a conversation worth having.

3 takeaways:
- 
- 
- 

Example:

CTA: What’s your experience?

${tags}`;
  }

  function computeViralityScore(text) {
    const t = String(text || '');
    const hasHook = /^.{1,120}\n/.test(t) || /(^|\n)[A-Z][^a-z]*:/.test(t);
    const lines = t.split(/\n/).length;
    const bullets = (t.match(/^\s*[-•]/gm) || []).length;
    const hashtags = (t.match(/#\w+/g) || []).length;
    const length = t.length;
    let score = 50;
    let reasons = [];
    if (hasHook) { score += 15; reasons.push('Strong opening'); }
    if (bullets >= 3 && bullets <= 6) { score += 10; reasons.push('Skimmable body'); }
    if (hashtags >= 3 && hashtags <= 5) { score += 5; reasons.push('Good hashtag mix'); }
    if (length >= 400 && length <= 1200) { score += 8; reasons.push('Optimal length'); }
    if (lines >= 8 && lines <= 20) { score += 4; }
    score = Math.max(0, Math.min(99, Math.round(score)));
    return { score, reason: reasons.join(' • ') || 'Balanced draft' };
  }

  function buildNoteMarkdown(post, note, tags) {
    return `# Trend Note — ${post.hashtags[0] || post.author || 'LinkedIn'}\n- Source: ${post.url || location.href}\n- Author: ${post.author || 'Unknown'}\n- Captured: ${new Date().toISOString()}\n- Entities: ${post.hashtags.join(' ')}\n- Why trending: ${explainWhyTrending(post)}\n\n## My angle\n${note || '—'}\n\n## Post outline\n- Hook:\n- Insight:\n- Example:\n- CTA:\n\nTags: ${tags}`;
  }

  function buildMetadata(post, tags) {
    return {
      sourceUrl: post.url || location.href,
      author: post.author || 'Unknown',
      capturedAt: new Date().toISOString(),
      stats: { likes: post.likes, comments: post.comments, hours: post.hours, velocityScore: post.velocityScore },
      entities: { hashtags: post.hashtags, tags: (tags || '').split(/\s+/).filter(Boolean) },
      pageTitle: document.title,
    };
  }

  function parseCount(str) {
    if (!str) return 0;
    const s = String(str).replace(/[,\s]/g, '').toLowerCase();
    if (s.endsWith('k')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('m')) return Math.round(parseFloat(s) * 1000000);
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  function normalize(val, min, max) {
    return (val - min) / Math.max(1, (max - min));
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Context menu handler save from link or selection
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'PP_SAVE_FROM_LINK') {
      const post = { hashtags: [], likes: 0, comments: 0, author: 'LinkedIn', url: msg.url || location.href, velocityScore: 0 };
      openSaveDialog(post);
    }
  });

  function explainWhyTrending(p) {
    const factors = [];
    if (p.likes > 1000 || p.comments > 200) factors.push('high engagement');
    if (p.hashtags.includes('#AI') || p.hashtags.includes('#jobs')) factors.push('hot topic');
    if (p.velocityScore > 0.8) factors.push('fast velocity');
    return factors.length ? factors.join(', ') : 'above-average engagement';
  }

  // Boot
  createSidebar();
  ensureToggle();
  observeFeed();
  // API status and enable/disable composer
  chrome.runtime.sendMessage({ type: 'PP_GET_STATUS' }, (resp) => {
    const badge = document.getElementById('pp-api-status');
    const btn = document.getElementById('pp-draft-ai');
    const loader = document.getElementById('pp-api-loader');
    if (loader) loader.remove();
    if (!badge || !btn) return;
    if (!resp?.ok) {
      badge.classList.add('bad');
      badge.innerHTML = 'Error reading status';
      return;
    }
    state.hasApiKey = Boolean(resp.status?.hasKey);
    if (state.hasApiKey) {
      badge.classList.remove('bad');
      badge.innerHTML = `LLM: ${escapeHtml(resp.status.provider)} • ${escapeHtml(resp.status.model)}`;
      btn.disabled = false;
      btn.removeAttribute('title');
    } else {
      badge.classList.add('bad');
      badge.innerHTML = 'LLM not configured — set API key in Options';
      btn.disabled = true;
      btn.title = 'Configure API key in Options to enable';
    }
  });

  function renderBestWindows() {
    const el = document.getElementById('pp-best-windows');
    if (!el || el.childElementCount > 0) return;
    const windows = ['08:00–09:00','12:00–13:00','17:00–18:00'];
    el.innerHTML = windows.map(w => `<span class="pill">${w}</span>`).join('');
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'pp-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2200);
  }
})();

