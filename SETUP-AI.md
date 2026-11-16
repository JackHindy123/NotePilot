# Turning on AI (Google Gemini, free) for NotePilot

About 10 minutes, done once. **Cost: $0.** No credit card needed anywhere.

With AI on, NotePilot uses Google's Gemini (free tier) to:
- **Read photos, scans, and handwriting** much more accurately than the built-in reader
- **Write flashcards, study guides, and practice exams** from any notes, not just neatly formatted ones

If the free quota runs out for the day, the site falls back to the built-in reader and rule-based mode.

> **Privacy:** on Gemini's free tier, Google may use what's sent to it to improve its products. The site tells users this. Rule-based mode and text uploads never leave the browser.

---

## 1. Get a free Gemini API key

1. Go to **aistudio.google.com** and sign in with your Google account.
2. Click **Get API key** (left sidebar or top right), then **Create API key**. If it asks for a project, let it create one.
3. **Copy the key** (it starts with `AIza`). Keep it somewhere temporary. Don't put it in GitHub or share it.
4. Don't set up billing. Without billing, the key stays on the free tier and can never charge you.

## 2. Create the backend (Cloudflare Worker, free)

1. Go to **dash.cloudflare.com** and sign up (free plan, no card needed).
2. In the left sidebar choose **Compute (Workers) → Workers & Pages → Create → Create Worker** (pick "Start with Hello World" if asked).
3. Name it `notepilot-ai` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste in the full contents of [`worker/worker.js`](worker/worker.js) from this repo, and click **Deploy**.

## 3. Add your key as a secret

1. Open your `notepilot-ai` Worker → **Settings → Variables and Secrets → Add**.
2. Type: **Secret**. Name: `GEMINI_API_KEY`. Value: paste your `AIza…` key.
3. Click **Deploy** (or Save).

## 4. Add usage limits

1. In the Cloudflare sidebar choose **Storage & Databases → Workers KV → Create** (namespace). Name it `notepilot-limits`.
2. Go back to your Worker → **Settings → Bindings → Add → KV namespace**.
3. Variable name: `LIMITS`. Namespace: `notepilot-limits`. Click **Deploy**.

This shares the free quota fairly: 80 AI requests per visitor per day and 900 for the whole site. Change `PER_VISITOR_DAILY` and `GLOBAL_DAILY` at the top of the Worker code if needed.

## 5. Check the backend

Copy your Worker's URL from its overview page (like `https://notepilot-ai.yourname.workers.dev`) and open
`https://notepilot-ai.yourname.workers.dev/health`. You should see `"keyConfigured":true` and `"limitsConfigured":true`.
If either is `false`, redo step 3 or 4.

## 6. Connect the site

1. In the GitHub repo, open **config.js** → click the ✏️ pencil.
2. Put your Worker URL between the quotes:
   ```js
   aiEndpoint: "https://notepilot-ai.yourname.workers.dev",
   ```
3. Commit. After about a minute, hard-refresh the site (Cmd+Shift+R). The Generation mode menu now shows **AI (Gemini)**.

---

### Notes
- **Models:** the Worker tries `gemini-3.8-flash` first, then `gemini-3.5-flash-lite`, then `gemini-2.5-flash`. Each has its own free daily quota, and a retired model is skipped automatically. Edit the `MODELS` list in the Worker to change them.
- **Your free limits:** see aistudio.google.com → your project's rate-limit page.
- **Other sites can't use your Worker:** it only accepts requests from `jackhindy123.github.io`. If you move the site, add the new address to `ALLOWED_ORIGINS` at the top of the Worker.
- **Turning AI off:** set `aiEndpoint: ""` in config.js.
