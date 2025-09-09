# ProfilePulse — LinkedIn Co‑Pilot (Chrome Extension)

Elite, minimalist LinkedIn companion that surfaces real‑time insights, saves trends to a local research vault, and helps you compose viral‑ready posts with LLM assistance.

## Install (Developer Mode)
1. Build not required. This is a no‑build MV3 extension.
2. Go to chrome://extensions → Enable Developer mode.
3. Click "Load unpacked" → select this folder (`/workspace/profilepulse`).
4. Open LinkedIn and click the ProfilePulse action in the toolbar.

## Configure LLM
- Open the extension Options page.
- Add your API key (OpenAI supported) and set your preferred model (e.g., `gpt-4o-mini`).

## Use on LinkedIn
- A floating button appears bottom-right. Click to toggle the right sidebar.
- Insights tab: shows posts scanned and trending count as you scroll.
- Trends tab: save trending posts as a Markdown note + JSON metadata.
- Composer tab: paste ideas and click "Predict & Draft" for AI variants.

## Privacy
- Local-first. Data stays on your machine unless you explicitly call LLMs.
- Your API key is stored via `chrome.storage.sync` (encrypted at rest by Chrome).

## Limitations
- LinkedIn DOM can change. If selectors break, update `src/content.js` heuristics.
- Some analytics are approximations; rationale and confidence are surfaced instead of exact values.

## License
MIT