/**
 * NotePilot AI backend: a Cloudflare Worker that keeps your Gemini API key secret.
 *
 * Endpoints (POST, JSON):
 *   /read      { image: "<base64 jpeg/png>", mediaType: "image/jpeg" } -> { text }
 *   /generate  { format: "flashcards"|"guide"|"exam", title, notes: [{ title, text }] } -> { items }
 *   /health    (GET) -> { ok, limits }
 *
 * Setup (Cloudflare dashboard):
 *   - Secret   GEMINI_API_KEY  = your free key from aistudio.google.com
 *   - KV bind  LIMITS          = a KV namespace (used for daily usage limits)
 */

// Free-tier Gemini models, tried in order. If one hits its free daily quota or is retired, the next is used.
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const ALLOWED_ORIGINS = [
  "https://jackhindy123.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];
// Usage limits protect your API credits if the public link gets shared widely.
const PER_VISITOR_DAILY = 80;  // AI requests per visitor (IP address) per day
const GLOBAL_DAILY = 900;      // AI requests for the whole site per day (KV free plan allows 1,000 writes/day)
const MAX_NOTES_CHARS = 60000; // ~25 pages of notes per study set
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    if (request.method === "GET" && (path === "" || path === "/health")) {
      return json({ ok: true, models: MODELS, keyConfigured: !!env.GEMINI_API_KEY, limitsConfigured: !!env.LIMITS });
    }
    if (request.method !== "POST") return json({ error: "Not found" }, 404);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "This AI service only works from the NotePilot site." }, 403);
    if (!env.GEMINI_API_KEY) return json({ error: "The AI key isn't set up yet." }, 503);

    const limited = await checkLimits(request, env);
    if (limited) return json({ error: limited }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

    try {
      if (path === "/read") return json(await readImage(body, env));
      if (path === "/generate") return json(await generate(body, env));
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.publicMessage || "The AI couldn't finish that request. Try again in a moment." }, err.status || 502);
    }
  },
};

async function checkLimits(request, env) {
  if (!env.LIMITS) return null; // limits not configured; Gemini free-tier quotas still cap usage
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `ip:${day}:${ip}`, allKey = `all:${day}`;
  const [ipCount, allCount] = await Promise.all([env.LIMITS.get(ipKey), env.LIMITS.get(allKey)]);
  if (+allCount >= GLOBAL_DAILY) return "NotePilot's AI has hit its daily limit. It resets at midnight UTC; rule-based mode still works.";
  if (+ipCount >= PER_VISITOR_DAILY) return "You've used today's AI allowance. It resets at midnight UTC; rule-based mode still works.";
  try {
    await Promise.all([
      env.LIMITS.put(ipKey, String(+ipCount + 1), { expirationTtl: 172800 }),
      env.LIMITS.put(allKey, String(+allCount + 1), { expirationTtl: 172800 }),
    ]);
  } catch {
    return "NotePilot's AI has hit its daily limit. It resets at midnight UTC; rule-based mode still works.";
  }
  return null;
}

function fail(publicMessage, status = 400) {
  const e = new Error(publicMessage);
  e.publicMessage = publicMessage;
  e.status = status;
  return e;
}

// parts: Gemini content parts, e.g. [{ text }, { inline_data: { mime_type, data } }]
async function ai(env, parts, { json = false } = {}) {
  let lastError = null;
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: 16384, temperature: 0.3, ...(json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const cand = (data.candidates || [])[0];
      const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("").trim();
      if (text) return text;
      lastError = fail(cand && cand.finishReason === "SAFETY" ? "The AI declined to process that content." : "The AI returned an empty answer. Try again.", 502);
      continue;
    }
    const detail = await res.text();
    console.log("Gemini error", model, res.status, detail.slice(0, 500));
    if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(detail)) throw fail("The AI key is invalid. Check the GEMINI_API_KEY secret.", 503);
    if (res.status === 403) throw fail("The AI key doesn't have access. Check the GEMINI_API_KEY secret.", 503);
    // 404 = model retired, 429 = this model's free quota is used up, 5xx = busy: try the next model
    if ([404, 429, 500, 503].includes(res.status)) {
      lastError = fail(res.status === 429 ? "The free AI quota is used up for today. Rule-based mode still works." : "The AI is busy right now. Try again in a minute.", 503);
      continue;
    }
    throw fail("The AI couldn't finish that request. Try again in a moment.", 502);
  }
  throw lastError || fail("The AI couldn't finish that request.", 502);
}

async function readImage(body, env) {
  const { image, mediaType = "image/jpeg" } = body || {};
  if (typeof image !== "string" || !image) throw fail("No image was sent.");
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) throw fail("Unsupported image type.");
  if (image.length * 0.75 > MAX_IMAGE_BYTES) throw fail("That image is too large.");
  const text = await ai(env, [
    { inline_data: { mime_type: mediaType, data: image } },
    {
      text:
        "This is a photo or scan of a student's class notes (they may be handwritten). Transcribe every piece of text exactly as written, in reading order.\n" +
        "- Keep one idea per line. Start headings or titles with '# '.\n" +
        "- Write definitions as 'Term: definition' when the notes pair a term with its meaning.\n" +
        "- For diagrams, arrows, or tables, write a short plain-text description in [square brackets].\n" +
        "- If a word is illegible, write [illegible]. Don't add, fix, or explain content.\n" +
        "Output only the transcription.",
    },
  ]);
  return { text };
}

const FORMAT_SPECS = {
  flashcards: {
    spec:
      'Return {"items":[{"front":"...","back":"...","section":"..."}]}. ' +
      "Make one card per important term, fact, process, or cause-and-effect in the notes (usually 15–60 cards). " +
      "Front: a term or a short, specific question. Back: a concise answer (1–2 sentences). Section: the topic heading it came from.",
  },
  guide: {
    spec:
      'Return {"items":[{"title":"...","terms":[{"term":"...","def":"..."}],"points":["..."]}]}. ' +
      "One item per major topic, in the order of the notes. Terms: key vocabulary with clear definitions. " +
      "Points: the most important ideas, processes, and relationships, each a complete sentence.",
  },
  exam: {
    spec:
      'Return {"items":[{"q":"...","a":"...","section":"..."}]}. ' +
      "Write 10–15 short-answer exam questions spread across all topics. Mix recall, explanation, and application questions. " +
      "a: a model answer of 1–3 sentences. Section: the topic it tests.",
  },
};

async function generate(body, env) {
  const { format, notes, title } = body || {};
  const fmt = FORMAT_SPECS[format];
  if (!fmt) throw fail("Unknown study format.");
  if (!Array.isArray(notes) || !notes.length) throw fail("No notes were sent.");
  let text = notes.map((n) => `=== ${String(n.title || "Notes").slice(0, 200)} ===\n${String(n.text || "")}`).join("\n\n");
  if (text.length > MAX_NOTES_CHARS) text = text.slice(0, MAX_NOTES_CHARS);

  const prompt =
    `You are building study material for a college student${title ? ` titled "${String(title).slice(0, 200)}"` : ""}. ` +
    "Use only facts from the notes below; don't invent content. Write in clear, student-friendly language.\n\n" +
    fmt.spec +
    "\nRespond with only the JSON object, no other text.\n\n<notes>\n" + text + "\n</notes>";

  const out = await ai(env, [{ text: prompt }], { json: true });
  const items = parseItems(out);
  if (!items.length) throw fail("The AI didn't return any study items. Try again or use rule-based mode.", 502);
  return { items: clean(format, items) };
}

function parseItems(out) {
  const body = out.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  let obj = tryParse(body);
  if (!obj) {
    const a = body.indexOf("{"), b = body.lastIndexOf("}");
    if (a >= 0 && b > a) obj = tryParse(body.slice(a, b + 1));
  }
  if (!obj) {
    const a = body.indexOf("["), b = body.lastIndexOf("]");
    if (a >= 0 && b > a) obj = tryParse(body.slice(a, b + 1));
  }
  if (Array.isArray(obj)) return obj;
  return obj && Array.isArray(obj.items) ? obj.items : [];
}

function clean(format, items) {
  const s = (v, n = 2000) => String(v ?? "").trim().slice(0, n);
  if (format === "flashcards")
    return items.map((c) => ({ front: s(c.front, 500), back: s(c.back), section: s(c.section, 200) || "Notes" })).filter((c) => c.front && c.back);
  if (format === "guide")
    return items.map((g) => ({
      title: s(g.title, 200) || "Notes",
      terms: (Array.isArray(g.terms) ? g.terms : []).map((t) => ({ term: s(t.term, 200), def: s(t.def) })).filter((t) => t.term),
      points: (Array.isArray(g.points) ? g.points : []).map((p) => s(p)).filter(Boolean),
    })).filter((g) => g.terms.length || g.points.length);
  return items.map((q) => ({ q: s(q.q, 1000), a: s(q.a), section: s(q.section, 200) || "Notes" })).filter((q) => q.q && q.a);
}
