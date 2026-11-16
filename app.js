/* NotePilot app: hash routing, local storage, and views. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_FILE = 15 * 1024 * 1024, MAX_FILES = 12;
  const FORMATS = {
    flashcards: { label: "Flashcards", plural: "Flashcards", unit: "cards", icon: "▤" },
    guide: { label: "Study guide", plural: "Study guides", unit: "sections", icon: "▦" },
    exam: { label: "Practice exam", plural: "Practice exams", unit: "questions", icon: "✓" },
  };

  /* ---------- storage ---------- */
  const mem = {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem("np_" + k); return v ? JSON.parse(v) : d; } catch { return k in mem ? mem[k] : d; } },
    set(k, v) { try { localStorage.setItem("np_" + k, JSON.stringify(v)); } catch { mem[k] = v; } },
  };
  let notes = store.get("notes", []);
  let sets = store.get("sets", []);
  let selected = new Set(store.get("selected", []));
  const save = () => { store.set("notes", notes); store.set("sets", sets); store.set("selected", [...selected]); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
  }
  function modal(title, body) {
    $("#modal-title").textContent = title;
    $("#modal-body").textContent = body;
    $("#modal").classList.remove("hidden");
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) $("#modal").classList.add("hidden"); });

  function addNote(title, text, filename) {
    text = text.replace(/\u0000/g, "").trim();
    if (!text) { toast(`No readable text found in ${filename || "that note"}.`); return null; }
    const n = { id: uid(), title: title || filename || "Untitled notes", filename: filename || null, text, createdAt: Date.now() };
    notes.unshift(n);
    selected.add(n.id);
    save();
    return n;
  }

  /* ---------- file reading ---------- */
  async function readFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (["txt", "md", "markdown", "text", "csv"].includes(ext)) return file.text();
    const buf = await file.arrayBuffer();
    if (ext === "pdf") {
      if (!window.pdfjsLib) throw new Error("PDF reader didn't load. Check your connection.");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        let line = "", lines = [], lastY = null;
        tc.items.forEach((it) => {
          const y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 4) { lines.push(line); line = ""; }
          line += it.str + (it.hasEOL ? "" : "");
          lastY = y;
        });
        lines.push(line);
        pages.push(lines.map((l) => l.trim()).filter(Boolean).join("\n"));
      }
      return pages.join("\n\n");
    }
    if (ext === "docx") {
      if (!window.mammoth) throw new Error("Word reader didn't load. Check your connection.");
      return (await mammoth.extractRawText({ arrayBuffer: buf })).value;
    }
    if (ext === "pptx") {
      if (!window.JSZip) throw new Error("PowerPoint reader didn't load. Check your connection.");
      const zip = await JSZip.loadAsync(buf);
      const slides = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
      const out = [];
      for (const s of slides) {
        const xml = await zip.file(s).async("string");
        const paras = xml.split(/<\/a:p>/).map((p) => (p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.replace(/<\/?a:t>/g, "")).join("")).map((t) => decodeXml(t).trim()).filter(Boolean);
        if (!paras.length) continue;
        out.push("# " + paras[0] + "\n" + paras.slice(1).join("\n"));
      }
      return out.join("\n\n");
    }
    throw new Error(`.${ext} files aren't supported. Use PDF, PowerPoint, Word, Markdown, or plain text.`);
  }
  const decodeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (files.length > MAX_FILES) { toast(`Up to ${MAX_FILES} files per upload.`); return; }
    let added = 0;
    for (const f of files) {
      if (f.size > MAX_FILE) { toast(`${f.name} is over 15 MB.`); continue; }
      try {
        const text = await readFile(f);
        if (addNote(f.name.replace(/\.[^.]+$/, ""), text, f.name)) added++;
      } catch (err) { toast(err.message || `Couldn't read ${f.name}.`); }
    }
    if (added) { toast(`Added ${added} note${added > 1 ? "s" : ""}.`); render(); }
  }

  /* ---------- shared bits ---------- */
  function steps(active) {
    const s = ["Add notes", "Choose a format", "Start studying"];
    return `<div class="steps">${s.map((t, i) => `<span class="step ${i + 1 === active ? "active" : ""}"><b>${i + 1}</b>${t}</span>${i < 2 ? '<span class="bar"></span>' : ""}`).join("")}</div>`;
  }
  function noteMeta(n) {
    const st = NoteGen.stats(n.text);
    return `${st.sections} text section${st.sections === 1 ? "" : "s"} · ${st.chars.toLocaleString()} characters`;
  }
  function noteRow(n, opts = {}) {
    return `<div class="note-row ${selected.has(n.id) ? "selected" : ""}" data-note="${n.id}">
      <input type="checkbox" ${selected.has(n.id) ? "checked" : ""} aria-label="Select ${esc(n.title)}" data-select="${n.id}" />
      <div class="file-icon">▤</div>
      <div class="meta"><b>${esc(n.filename || n.title)}</b><span>${noteMeta(n)}</span></div>
      <button class="btn-link" data-preview="${n.id}">Preview</button>
      ${opts.noDelete ? "" : `<button class="icon-btn" data-remove-note="${n.id}" aria-label="Remove ${esc(n.title)}">✕</button>`}
    </div>`;
  }
  function bindNoteRows(root) {
    $$("[data-select]", root).forEach((cb) => cb.addEventListener("change", () => {
      cb.checked ? selected.add(cb.dataset.select) : selected.delete(cb.dataset.select);
      save(); cb.closest(".note-row").classList.toggle("selected", cb.checked);
      const go = $("#go-format"); if (go) go.disabled = !selected.size;
    }));
    $$("[data-preview]", root).forEach((b) => b.addEventListener("click", () => {
      const n = notes.find((x) => x.id === b.dataset.preview); if (n) modal(n.title, n.text);
    }));
    $$("[data-remove-note]", root).forEach((b) => b.addEventListener("click", () => {
      notes = notes.filter((x) => x.id !== b.dataset.removeNote); selected.delete(b.dataset.removeNote); save(); render();
    }));
  }

  /* ---------- views ---------- */
  function viewUpload() {
    app.innerHTML = `
      <p class="eyebrow">Your notes. Your next breakthrough.</p>
      <h1 class="hero">Less prep.<span class="accent">More learning.</span></h1>
      <p class="lede">Turn lecture slides and class notes into study materials. Spend your time understanding, not reformatting.</p>
      ${steps(1)}
      <div class="grid-2">
        <section class="card">
          <div class="dropzone" id="drop">
            <div class="drop-icon">↑</div>
            <h3>Drag and drop your notes here</h3>
            <p class="muted small" style="margin:0 0 14px">PDF, PowerPoint, Word, Markdown, or plain text</p>
            <button class="btn btn-primary" id="browse">Browse files</button>
            <input type="file" id="file" multiple accept=".pdf,.pptx,.docx,.md,.markdown,.txt" hidden />
            <p class="muted small" style="margin:14px 0 0">15 MB per file · 12 files per upload · Text-based documents only</p>
          </div>
          <div class="divider">or start with text</div>
          <label class="lbl" for="ntitle">Notes title</label>
          <input class="input" id="ntitle" placeholder="e.g. Biology — Cell respiration" />
          <label class="lbl" for="ntext">Paste your class notes</label>
          <textarea class="input" id="ntext" placeholder="Paste notes, definitions, or a lecture outline…"></textarea>
          <div class="row" style="margin-top:12px">
            <button class="btn btn-ghost" id="savepaste">Save pasted notes</button>
            <button class="btn-link" id="sample">Load sample notes</button>
          </div>
        </section>
        <aside class="stack">
          <div class="card">
            <p class="eyebrow" style="margin-bottom:6px">Built for your study flow</p>
            <h2>From lecture to practice.</h2>
            <div class="flow-item"><span class="num">01</span><div><h4>Bring your own material</h4><p>Keep the class content you actually need in one place.</p></div></div>
            <div class="flow-item"><span class="num">02</span><div><h4>Choose how you learn</h4><p>Flashcards, a study guide, or a short-answer practice exam.</p></div></div>
            <div class="flow-item"><span class="num">03</span><div><h4>Make it work for you</h4><p>Open source excerpts, flip and mark cards, and edit confusing explanations.</p></div></div>
          </div>
          <div class="card soft small">
            <b>Private by design</b>
            <p style="margin:6px 0 0">Your notes are processed right here in your browser with rule-based generation. Nothing is uploaded to a server.</p>
          </div>
        </aside>
      </div>
      <section style="margin-top:40px">
        <div class="row between">
          <div><h2>Your source notes</h2><p class="muted" style="margin:0">Select saved notes to create another study set.</p></div>
          <button class="btn btn-primary" id="go-format" ${selected.size ? "" : "disabled"}>Choose study format →</button>
        </div>
        <div id="notes">${notes.length ? notes.map((n) => noteRow(n)).join("") : '<div class="empty">No notes yet. Upload a file, paste notes, or load the sample.</div>'}</div>
      </section>`;

    const drop = $("#drop"), file = $("#file");
    $("#browse").onclick = () => file.click();
    file.onchange = () => handleFiles(file.files);
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
    drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
    $("#savepaste").onclick = () => {
      const text = $("#ntext").value, title = $("#ntitle").value.trim();
      if (!text.trim()) { toast("Paste some notes first."); return; }
      if (addNote(title || "Pasted notes", text)) { toast("Notes saved."); render(); }
    };
    $("#sample").onclick = () => {
      if (notes.some((n) => n.filename === "sample_notes.txt")) { toast("Sample notes are already loaded."); return; }
      addNote("Biology — Cellular respiration", NoteGen.SAMPLE, "sample_notes.txt"); toast("Sample notes loaded."); render();
    };
    $("#go-format").onclick = () => (location.hash = "#/create");
    bindNoteRows(app);
  }

  function viewCreate() {
    let format = store.get("lastFormat", "flashcards");
    app.innerHTML = `
      <a class="backlink" href="#/">← Back to notes</a>
      <p class="eyebrow">Step 2 — Make it yours</p>
      <h1 class="page">What would you like?</h1>
      <p class="lede">Choose your sources and turn them into something you can study.</p>
      ${steps(2)}
      <div class="grid-2 even">
        <section class="card">
          <div class="row" style="gap:10px"><h2 style="margin:0">Choose source notes</h2><span class="badge" id="selcount">${selected.size} selected</span></div>
          <p class="muted small">Use one lecture or combine notes from the same course.</p>
          <div id="notes">${notes.length ? notes.map((n) => noteRow(n, { noDelete: true })).join("") : '<div class="empty">No notes saved yet.</div>'}</div>
          <p style="margin:16px 0 0"><a href="#/">+ Add more notes</a></p>
        </section>
        <section class="card">
          <label class="lbl" for="stitle" style="margin-top:0">Study set title</label>
          <input class="input" id="stitle" placeholder="e.g. Biology 101 — Exam 1" />
          <label class="lbl">What would you like to generate?</label>
          <div id="formats">
            ${opt("flashcards", "Flashcards", "Cover all selected notes; card count is determined by the content.", "▤")}
            ${opt("guide", "Study guide", "Organized sections with key terms and points you can review and edit.", "▦")}
            ${opt("exam", "Practice exam", "Short-answer questions with revealable model answers.", "✓")}
          </div>
          <label class="lbl" for="mode">Generation mode</label>
          <select class="input" id="mode"><option>Rule-based (no AI)</option></select>
          <div class="info" id="fmtinfo"></div>
          <button class="btn btn-primary btn-block" id="gen" style="margin-top:18px">Generate study material →</button>
        </section>
      </div>`;
    function opt(k, t, d, ico) {
      return `<label class="option ${format === k ? "selected" : ""}" data-fmt="${k}"><input type="radio" name="fmt" value="${k}" ${format === k ? "checked" : ""}/><div class="txt"><b>${t}</b><span>${d}</span></div><span class="ico">${ico}</span></label>`;
    }
    const infos = {
      flashcards: "Flashcards turn every definition into a term card and every key fact into a fill-in-the-blank card. Rule-based mode only uses what's in your notes, so check the deck against them.",
      guide: "Study guides group your notes by section, pulling out key terms with their definitions and listing the remaining key points.",
      exam: "Practice exams pick up to 15 short-answer questions, spread across your sections. Write your answer, then reveal the model answer to check yourself.",
    };
    const setInfo = () => ($("#fmtinfo").textContent = infos[format]);
    setInfo();
    $$("[data-fmt]").forEach((l) => l.addEventListener("click", () => {
      format = l.dataset.fmt; store.set("lastFormat", format);
      $$("[data-fmt]").forEach((x) => x.classList.toggle("selected", x === l)); setInfo();
    }));
    bindNoteRows(app);
    $$("[data-select]").forEach((cb) => cb.addEventListener("change", () => ($("#selcount").textContent = `${selected.size} selected`)));
    $("#gen").onclick = () => {
      const src = notes.filter((n) => selected.has(n.id));
      if (!src.length) { toast("Select at least one note."); return; }
      const items = NoteGen.generate(src, format);
      if (!items.length) { toast("Couldn't find definitions or key points in those notes. Try notes with one idea per line."); return; }
      const title = $("#stitle").value.trim() || (src.length === 1 ? src[0].title : `${src[0].title} + ${src.length - 1} more`);
      const set = { id: uid(), title, format, items, noteIds: src.map((n) => n.id), known: [], createdAt: Date.now(), updatedAt: Date.now() };
      sets.unshift(set); save();
      location.hash = "#/set/" + set.id;
    };
  }

  function viewLibrary() {
    let filter = "all", q = "";
    app.innerHTML = `
      <div class="row between" style="align-items:flex-end">
        <div><p class="eyebrow">Your personal workspace</p><h1 class="page">Your study materials</h1><p class="lede" style="margin:0">Pick up where you left off.</p></div>
        <a class="btn btn-primary" href="#/">+ Create study material</a>
      </div>
      <div class="row between" style="margin-top:28px">
        <div class="tabs">
          <button class="tab active" data-tab="all">All materials</button>
          <button class="tab" data-tab="flashcards">Flashcards</button>
          <button class="tab" data-tab="guide">Study guides</button>
          <button class="tab" data-tab="exam">Practice exams</button>
        </div>
        <input class="input" id="search" placeholder="Search study materials…" style="max-width:280px" />
      </div>
      <div class="stats" id="stats"></div>
      <div class="sets" id="sets"></div>`;
    const draw = () => {
      const list = sets.filter((s) => (filter === "all" || s.format === filter) && s.title.toLowerCase().includes(q));
      const itemCount = sets.reduce((a, s) => a + s.items.length, 0);
      $("#stats").innerHTML = `<span>${sets.length} saved study set${sets.length === 1 ? "" : "s"}</span><span>${notes.length} source document${notes.length === 1 ? "" : "s"}</span><span>${itemCount} study items</span>`;
      $("#sets").innerHTML = list.length ? list.map(setCard).join("") : `<div class="empty" style="grid-column:1/-1">${sets.length ? "No study sets match." : 'No study sets yet. <a href="#/">Add notes</a> to make your first one.'}</div>`;
      $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
        if (b.dataset.armed) { sets = sets.filter((s) => s.id !== b.dataset.del); save(); draw(); toast("Study set deleted."); }
        else { b.dataset.armed = "1"; b.textContent = "Confirm delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 3000); }
      }));
    };
    $$("[data-tab]").forEach((t) => t.addEventListener("click", () => { filter = t.dataset.tab; $$("[data-tab]").forEach((x) => x.classList.toggle("active", x === t)); draw(); }));
    $("#search").addEventListener("input", (e) => { q = e.target.value.toLowerCase(); draw(); });
    draw();
  }

  function setCard(s) {
    const f = FORMATS[s.format];
    const pct = s.items.length ? Math.round((s.known.length / s.items.length) * 100) : 0;
    const verb = s.format === "guide" ? "reviewed" : s.format === "exam" ? "answered correctly" : "marked known";
    return `<article class="card set-card">
      <div class="file-icon">${f.icon}</div>
      <h3>${esc(s.title)}</h3>
      <span class="muted small">${f.label} · ${s.items.length} ${f.unit}</span>
      <span><span class="badge gray">Rule-based</span></span>
      <span class="muted small">${s.known.length}/${s.items.length} ${verb} · Updated ${new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="row between" style="margin-top:6px"><a href="#/set/${s.id}">Open set →</a><button class="btn-danger" data-del="${s.id}">Delete</button></div>
    </article>`;
  }

  /* ---------- study views ---------- */
  function viewSet(id) {
    const s = sets.find((x) => x.id === id);
    if (!s) { app.innerHTML = `<div class="empty">That study set doesn't exist anymore. <a href="#/library">Back to your materials</a></div>`; return; }
    const touch = () => { s.updatedAt = Date.now(); save(); };
    const header = (extra = "") => `
      <a class="backlink" href="#/library">← All study materials</a>
      <p class="eyebrow">${FORMATS[s.format].label} · ${s.items.length} ${FORMATS[s.format].unit}</p>
      <div class="row between" style="align-items:flex-end;margin-bottom:24px">
        <h1 class="page" style="margin:0">${esc(s.title)}</h1>
        <div class="row">${extra}</div>
      </div>`;
    if (s.format === "flashcards") return studyFlashcards(s, header, touch);
    if (s.format === "guide") return studyGuide(s, header, touch);
    return studyExam(s, header, touch);
  }

  function sourceExcerpt(s, section) {
    const src = notes.filter((n) => s.noteIds.includes(n.id));
    for (const n of src) {
      const lines = n.text.split("\n");
      const i = lines.findIndex((l) => l.replace(/^#+\s*/, "").replace(/:$/, "").trim() === section);
      if (i >= 0) {
        let j = i + 1; while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) j++;
        return { title: `${n.title} — ${section}`, text: lines.slice(i, j).join("\n").trim() };
      }
    }
    return src[0] ? { title: src[0].title, text: src[0].text } : null;
  }

  function studyFlashcards(s, header, touch) {
    let order = s.items.map((_, i) => i), pos = 0, onlyUnknown = false;
    app.innerHTML = header(`<button class="btn btn-ghost" id="shuffle">Shuffle</button><button class="btn btn-ghost" id="unknown">Study unknown only</button><button class="btn btn-ghost" id="export">Export CSV</button>`) + `
      <div class="flash-wrap">
        <div class="row between small muted" style="margin-bottom:10px"><span id="count"></span><span id="knowncount"></span></div>
        <div class="progress" style="margin-bottom:18px"><div id="bar"></div></div>
        <div class="flashcard" id="card" tabindex="0" aria-live="polite">
          <div class="face front"><span class="face-label" id="flabel"></span><div class="face-text" id="ftext"></div><span class="source">Click or press space to flip</span></div>
          <div class="face back"><span class="face-label">Answer</span><div class="face-text" id="btext"></div><span class="source" id="bsrc"></span></div>
        </div>
        <div class="study-controls">
          <button class="btn btn-ghost" id="prev">← Previous</button>
          <button class="btn btn-known" id="known">✓ I know this</button>
          <button class="btn btn-ghost" id="next">Next →</button>
        </div>
        <div class="study-controls" style="margin-top:8px">
          <button class="btn-link" id="edit">Edit card</button>
          <button class="btn-link" id="src">Open source excerpt</button>
        </div>
        <div class="card hidden" id="editor" style="margin-top:16px">
          <label class="lbl" style="margin-top:0">Front</label><textarea class="input edit-area" id="efront"></textarea>
          <label class="lbl">Back</label><textarea class="input edit-area" id="eback"></textarea>
          <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="esave">Save card</button><button class="btn btn-ghost" id="ecancel">Cancel</button><button class="btn-danger" id="edel" style="margin-left:auto">Delete card</button></div>
        </div>
      </div>`;
    const card = $("#card");
    const cur = () => s.items[order[pos]];
    const draw = () => {
      if (!order.length) { $(".flash-wrap").innerHTML = `<div class="empty">You've marked every card as known. 🎉 <button class="btn-link" id="reset">Study all cards again</button></div>`; $("#reset").onclick = () => { onlyUnknown = false; render(); }; return; }
      pos = Math.max(0, Math.min(pos, order.length - 1));
      const c = cur();
      card.classList.remove("flipped");
      $("#flabel").textContent = c.kind === "cloze" ? "Fill in the blank" : "Term";
      $("#ftext").textContent = c.front;
      $("#btext").textContent = c.back;
      $("#bsrc").textContent = "From: " + c.section;
      $("#count").textContent = `Card ${pos + 1} of ${order.length}${onlyUnknown ? " (unknown only)" : ""}`;
      $("#knowncount").textContent = `${s.known.length}/${s.items.length} known`;
      $("#bar").style.width = (s.known.length / s.items.length) * 100 + "%";
      const k = s.known.includes(c.id);
      $("#known").classList.toggle("on", k);
      $("#known").textContent = k ? "✓ Known" : "✓ I know this";
      $("#editor").classList.add("hidden");
    };
    const flip = () => card.classList.toggle("flipped");
    card.onclick = flip;
    $("#prev").onclick = () => { pos = (pos - 1 + order.length) % order.length; draw(); };
    $("#next").onclick = () => { pos = (pos + 1) % order.length; draw(); };
    $("#known").onclick = () => {
      const c = cur(); const i = s.known.indexOf(c.id);
      i >= 0 ? s.known.splice(i, 1) : s.known.push(c.id); touch();
      if (i < 0 && order.length > 1) { pos = (pos + 1) % order.length; }
      draw();
    };
    $("#shuffle").onclick = () => { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } pos = 0; draw(); toast("Shuffled."); };
    $("#unknown").onclick = () => {
      onlyUnknown = !onlyUnknown;
      order = s.items.map((_, i) => i).filter((i) => !onlyUnknown || !s.known.includes(s.items[i].id));
      $("#unknown").textContent = onlyUnknown ? "Study all cards" : "Study unknown only"; pos = 0; draw();
    };
    $("#export").onclick = () => {
      const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
      const csv = s.items.map((c) => q(c.front) + "," + q(c.back)).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = s.title.replace(/[^\w\- ]+/g, "").trim() + ".csv"; a.click();
      toast("Exported. Import the CSV into Quizlet or Anki.");
    };
    $("#edit").onclick = () => { const c = cur(); $("#efront").value = c.front; $("#eback").value = c.back; $("#editor").classList.remove("hidden"); };
    $("#ecancel").onclick = () => $("#editor").classList.add("hidden");
    $("#esave").onclick = () => { const c = cur(); c.front = $("#efront").value.trim() || c.front; c.back = $("#eback").value.trim() || c.back; touch(); draw(); toast("Card updated."); };
    $("#edel").onclick = () => {
      const c = cur(); s.items = s.items.filter((x) => x !== c); s.known = s.known.filter((k) => k !== c.id); touch();
      if (!s.items.length) { sets = sets.filter((x) => x !== s); save(); location.hash = "#/library"; return; }
      order = s.items.map((_, i) => i); draw(); toast("Card deleted.");
    };
    $("#src").onclick = () => { const ex = sourceExcerpt(s, cur().section); if (ex) modal(ex.title, ex.text); else toast("Source notes were removed."); };
    card.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } });
    document.onkeydown = (e) => {
      if (!location.hash.startsWith("#/set/") || /input|textarea/i.test(document.activeElement.tagName)) return;
      if (e.key === "ArrowRight") $("#next")?.click();
      if (e.key === "ArrowLeft") $("#prev")?.click();
    };
    draw();
  }

  function studyGuide(s, header, touch) {
    let editing = false;
    const draw = () => {
      app.innerHTML = header(`<button class="btn ${editing ? "btn-primary" : "btn-ghost"}" id="edit">${editing ? "Save edits" : "Edit guide"}</button><button class="btn btn-ghost" id="print">Print</button>`) + `
        <div class="row small muted" style="margin-bottom:12px">${s.known.length}/${s.items.length} sections reviewed</div>
        <div class="progress" style="margin-bottom:24px"><div style="width:${(s.known.length / s.items.length) * 100}%"></div></div>
        ${s.items.map((sec, i) => `
          <section class="card guide-section" data-sec="${i}">
            <div class="row between"><h3 ${editing ? 'contenteditable="true"' : ""} data-f="title">${esc(sec.title)}</h3>
              <label class="row small" style="gap:6px"><input type="checkbox" data-rev="${sec.id}" ${s.known.includes(sec.id) ? "checked" : ""} style="accent-color:var(--accent)"/> Reviewed</label></div>
            ${sec.terms.length ? `<p class="eyebrow" style="margin:14px 0 6px">Key terms</p><ul>${sec.terms.map((t) => `<li ${editing ? 'contenteditable="true"' : ""} data-f="term"><span class="term">${esc(t.term)}</span> — ${esc(t.def)}</li>`).join("")}</ul>` : ""}
            ${sec.points.length ? `<p class="eyebrow" style="margin:14px 0 6px">Key points</p><ul>${sec.points.map((p) => `<li ${editing ? 'contenteditable="true"' : ""} data-f="point">${esc(p)}</li>`).join("")}</ul>` : ""}
          </section>`).join("")}`;
      $("#edit").onclick = () => {
        if (editing) {
          $$("[data-sec]").forEach((el) => {
            const sec = s.items[+el.dataset.sec];
            sec.title = $('[data-f="title"]', el).innerText.trim() || sec.title;
            sec.terms = $$('[data-f="term"]', el).map((li) => { const t = li.innerText.split(/\s+—\s+/); return { term: t[0].trim(), def: t.slice(1).join(" — ").trim() }; }).filter((t) => t.term);
            sec.points = $$('[data-f="point"]', el).map((li) => li.innerText.trim()).filter(Boolean);
          });
          touch(); toast("Guide saved.");
        }
        editing = !editing; draw();
      };
      $("#print").onclick = () => window.print();
      $$("[data-rev]").forEach((cb) => cb.addEventListener("change", () => {
        const i = s.known.indexOf(cb.dataset.rev);
        cb.checked && i < 0 ? s.known.push(cb.dataset.rev) : !cb.checked && i >= 0 && s.known.splice(i, 1);
        touch(); draw();
      }));
    };
    draw();
  }

  function studyExam(s, header, touch) {
    const answers = {};
    const draw = () => {
      app.innerHTML = header(`<button class="btn btn-ghost" id="revealall">Reveal all answers</button><button class="btn btn-ghost" id="reset">Reset score</button>`) + `
        <div class="row small muted" style="margin-bottom:12px">Score: ${s.known.length}/${s.items.length} correct (self-graded)</div>
        <div class="progress" style="margin-bottom:24px"><div style="width:${(s.known.length / s.items.length) * 100}%"></div></div>
        ${s.items.map((q, i) => `
          <section class="card q-card" data-q="${q.id}">
            <span class="qnum">Question ${i + 1} · ${esc(q.section)}</span>
            <p class="q">${esc(q.q)}</p>
            <textarea class="input edit-area" placeholder="Write your answer…" data-ans="${q.id}">${esc(answers[q.id] || "")}</textarea>
            <div class="row" style="margin-top:10px"><button class="btn btn-ghost" data-reveal="${q.id}">Show model answer</button>
              ${s.known.includes(q.id) ? '<span class="status ok">Marked correct</span>' : ""}</div>
            <div class="answer hidden" data-model="${q.id}"><b>Model answer:</b> ${esc(q.a)}
              <div class="row" style="margin-top:10px"><button class="btn btn-known ${s.known.includes(q.id) ? "on" : ""}" data-right="${q.id}">I got it right</button><button class="btn btn-ghost" data-wrong="${q.id}">I missed it</button></div>
            </div>
          </section>`).join("")}`;
      $$("[data-ans]").forEach((t) => t.addEventListener("input", () => (answers[t.dataset.ans] = t.value)));
      $$("[data-reveal]").forEach((b) => b.addEventListener("click", () => $(`[data-model="${b.dataset.reveal}"]`).classList.toggle("hidden")));
      const mark = (id, right) => { const i = s.known.indexOf(id); if (right && i < 0) s.known.push(id); if (!right && i >= 0) s.known.splice(i, 1); touch(); const y = scrollY; draw(); scrollTo(0, y); $(`[data-model="${id}"]`).classList.remove("hidden"); };
      $$("[data-right]").forEach((b) => b.addEventListener("click", () => mark(b.dataset.right, true)));
      $$("[data-wrong]").forEach((b) => b.addEventListener("click", () => mark(b.dataset.wrong, false)));
      $("#revealall").onclick = () => $$("[data-model]").forEach((m) => m.classList.remove("hidden"));
      $("#reset").onclick = () => { s.known = []; touch(); draw(); };
    };
    draw();
  }

  function viewAbout() {
    app.innerHTML = `
      <p class="eyebrow">MGT 103 · Problem Assignment</p>
      <h1 class="page">Why we built NotePilot</h1>
      <p class="lede">A project by team Legally Bankrupt.</p>
      <div class="team"><span>Jack Hindermann</span><span>Ryan Kropac</span><span>Maksimilian Lahu</span><span>William Parker</span></div>

      <section class="card" style="margin-top:32px">
        <p class="eyebrow">Point of view</p>
        <p class="small muted" style="margin:0 0 4px">Previous POV</p>
        <p class="pov-old" style="margin:0 0 18px">Students often know flashcards can help them study, they also know that making them manually is slow and repetitive.</p>
        <p class="small muted" style="margin:0 0 4px">New POV</p>
        <p class="pov-new" style="margin:0">College students need a more efficient way to review the material learned in class so they can get better grades on exams without sacrificing time for other responsibilities and activities.</p>
        <p class="muted small" style="margin:18px 0 0">We changed the POV because the new one defines a more specific user and more accurately describes the problem and the effect it has on those users.</p>
      </section>

      <div class="grid-2 even" style="margin-top:22px">
        <section class="card">
          <p class="eyebrow">User narrative</p>
          <ul class="narrative" style="padding-left:20px;margin:0">
            <li>Students must reread notes, identify important ideas, and write each question-and-answer pair.</li>
            <li>This takes time away from actually practicing and learning the material.</li>
            <li>Because it is annoying and time-consuming, students may skip flashcards altogether or create incomplete sets.</li>
            <li>The daunting task of formatting, copying text, structuring decks, and organizing folders also drains mental energy before studying even begins.</li>
          </ul>
        </section>
        <section class="card">
          <p class="eyebrow">How NotePilot responds</p>
          <div class="flow-item" style="margin-top:4px"><span class="num">01</span><div><h4>No more manual Q&amp;A writing</h4><p>Definitions and key facts in your notes become flashcards and exam questions automatically.</p></div></div>
          <div class="flow-item"><span class="num">02</span><div><h4>No formatting overhead</h4><p>Upload slides or paste notes; sections and decks are structured for you.</p></div></div>
          <div class="flow-item"><span class="num">03</span><div><h4>More time practicing</h4><p>Flip cards, track what you know, and self-test with a practice exam.</p></div></div>
          <p style="margin:18px 0 0"><a class="btn btn-primary" href="#/">Try it with sample notes →</a></p>
        </section>
      </div>

      <section class="card" style="margin-top:22px">
        <p class="eyebrow">AI Coach assessment</p>
        <div class="table-wrap"><table class="coach">
          <thead><tr><th>Component</th><th>Assessment</th><th>Evidence</th><th>Most important uncertainty</th></tr></thead>
          <tbody>
            <tr><td><b>User</b></td><td><span class="status ok">Supported</span></td><td>Interview 3: a college student studying finance reports spending hours organizing lecture slides, textbook pages, and review materials.</td><td>Do these frustrations apply broadly to college students, or just students in certain courses?</td></tr>
            <tr><td><b>Need</b></td><td><span class="status ok">Supported</span></td><td>Interview 5: a student reported that gathering study materials was tedious and time-consuming, causing him to skip creating study guides.</td><td>Is efficiency primarily about organizing materials, generating practice questions, or reviewing content? The need is appropriately problem-focused, not a disguised solution.</td></tr>
            <tr><td><b>Insight</b></td><td><span class="status partial">Partly supported</span></td><td>Interview 4: a student reports relying on rereading notes because creating practice material required too much effort.</td><td>Does inefficient studying actually interfere with other responsibilities? Time-consuming preparation is supported, but sacrificing other activities is not directly established.</td></tr>
          </tbody>
        </table></div>
      </section>`;
  }

  /* ---------- router ---------- */
  function render() {
    document.onkeydown = null;
    const h = location.hash.replace(/^#/, "") || "/";
    const nav = h.startsWith("/library") || h.startsWith("/set") ? "library" : h.startsWith("/about") ? "about" : "upload";
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
    if (h.startsWith("/create")) viewCreate();
    else if (h.startsWith("/library")) viewLibrary();
    else if (h.startsWith("/set/")) viewSet(h.slice(5));
    else if (h.startsWith("/about")) viewAbout();
    else viewUpload();
  }
  window.addEventListener("hashchange", () => { render(); scrollTo(0, 0); });
  render();
})();
