/* NotePilot rule-based generator.
   Turns plain-text notes into sections, definitions, and key points,
   then builds flashcards, a study guide, or a short-answer practice exam.
   No AI and no network: everything runs in the browser. */
(function () {
  const STOP = new Set(("a an the and or but of to in on for with by from at as is are was were be been being this that these those it its into than then there their they them which who whom what when where why how also can may will would should could not no yes such each other more most some any all both either neither only own same so too very just over under between during before after above below up down out off again further once here because while about against through until").split(" "));

  const SAMPLE = `# Cellular Respiration — Overview
Cellular respiration: the process cells use to convert glucose and oxygen into ATP, carbon dioxide, and water.
ATP (adenosine triphosphate) is the main energy currency of the cell.
The overall equation is C6H12O6 + 6 O2 → 6 CO2 + 6 H2O + about 30–32 ATP.
Aerobic respiration requires oxygen and takes place mostly in the mitochondria.
Anaerobic respiration happens without oxygen and produces far less ATP.
The mitochondria is often called the powerhouse of the cell because it produces most of the cell's ATP.

# Glycolysis
Glycolysis: the first stage of respiration, which splits one glucose molecule into two molecules of pyruvate.
Glycolysis takes place in the cytoplasm and does not require oxygen.
Glycolysis produces a net gain of 2 ATP and 2 NADH per glucose molecule.
NADH is an electron carrier that delivers high-energy electrons to the electron transport chain.
Pyruvate is a three-carbon molecule that enters the mitochondria when oxygen is available.
When oxygen is not available, cells use fermentation to regenerate NAD+ so glycolysis can continue.
Lactic acid fermentation occurs in human muscle cells during intense exercise.
Alcoholic fermentation is used by yeast and produces ethanol and carbon dioxide.

# Krebs Cycle and Electron Transport Chain
Krebs cycle: a series of reactions in the mitochondrial matrix that breaks down acetyl-CoA and releases carbon dioxide.
The Krebs cycle is also called the citric acid cycle.
Each turn of the Krebs cycle produces 1 ATP, 3 NADH, and 1 FADH2.
Acetyl-CoA is formed when pyruvate loses a carbon atom as carbon dioxide before entering the Krebs cycle.
FADH2 is a second electron carrier that also donates electrons to the electron transport chain.
Electron transport chain: a series of proteins in the inner mitochondrial membrane that pass electrons and pump hydrogen ions.
Oxygen is the final electron acceptor and combines with electrons and hydrogen ions to form water.
ATP synthase is an enzyme that uses the flow of hydrogen ions to make ATP.
Chemiosmosis is the movement of hydrogen ions across a membrane that drives ATP synthesis.
The electron transport chain produces the majority of ATP made during cellular respiration.
Without oxygen, the electron transport chain stops and ATP production drops sharply.`;

  function clean(s) {
    return s.replace(/^[\s>*•\-–—·▪●○◦•]+/, "").replace(/^\d+[.)]\s+/, "").replace(/\s+/g, " ").trim();
  }

  function isHeading(raw, next) {
    const line = raw.trim();
    if (!line) return false;
    if (/^#{1,6}\s+/.test(line)) return true;
    const words = line.split(/\s+/).length;
    if (/^(lecture|chapter|unit|section|week|topic|part)\b/i.test(line) && words <= 10 && !/[.?!]$/.test(line)) return true;
    if (/:$/.test(line) && words <= 8) return true;
    if (words <= 7 && line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
    return false;
  }

  function headingText(line) {
    return line.trim().replace(/^#{1,6}\s+/, "").replace(/:$/, "").trim();
  }

  function splitSentences(text) {
    // Keep decimals like 2.5 and abbreviations like e.g. intact
    return text
      .replace(/\b(e\.g|i\.e|etc|vs|approx|ca)\./gi, (m) => m.replace(/\./g, "§"))
      .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
      .map((s) => s.replace(/§/g, ".").trim())
      .filter(Boolean);
  }

  function parseSections(text, fallbackTitle) {
    const lines = text.replace(/\r/g, "").split("\n");
    const sections = [];
    let cur = { title: fallbackTitle || "Notes", body: [] };
    lines.forEach((raw, i) => {
      if (isHeading(raw, lines[i + 1])) {
        if (cur.body.length) sections.push(cur);
        cur = { title: headingText(raw), body: [] };
      } else if (raw.trim()) {
        cur.body.push(raw);
      }
    });
    if (cur.body.length) sections.push(cur);
    return sections;
  }

  const DEF_VERBS = /^(.{2,60}?)\s+(is defined as|refers to|is called|are called|is known as|means|is|are)\s+(.{8,})$/i;

  function asDefinition(sentence) {
    const s = sentence.replace(/\.$/, "");
    // Term: definition  /  Term - definition  /  Term = definition
    let m = s.match(/^([^:=]{2,60}?)\s*(?::|\s[-–—=]\s)\s*(.{8,})$/);
    if (m) {
      const term = m[1].trim();
      if (term.split(/\s+/).length <= 7 && !/[.,;]/.test(term)) {
        return { term, def: capitalize(m[2].trim()) };
      }
    }
    m = s.match(DEF_VERBS);
    if (m) {
      let term = m[1].trim().replace(/^(the|a|an)\s+/i, "");
      const words = term.split(/\s+/);
      if (words.length <= 6 && !/[,;]/.test(term) && !/^(it|this|that|they|there|these|those|each|which|when|without|with|if)$/i.test(words[0])) {
        const verb = m[2].toLowerCase();
        let def = m[3].trim();
        // "X is used by..." / "X is formed when..." read badly as cards; keep those as key points
        if ((verb === "is" || verb === "are") && /^(\w+ed|also|not|often|usually|mostly|only|now|still|then)\b/i.test(def) && !/^(often|usually) (called|known)/i.test(def)) return null;
        return { term: capitalize(term), def: capitalize(def), verb };
      }
    }
    return null;
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function keyWord(sentence, avoid) {
    const words = sentence.replace(/[.,;:()"]/g, " ").split(/\s+/).filter(Boolean);
    let best = null, score = -1;
    words.forEach((w, i) => {
      const lw = w.toLowerCase();
      if (STOP.has(lw) || (avoid && avoid.has(lw)) || i === 0 && w.length < 4) return;
      let sc = w.length;
      if (/\d/.test(w)) sc += 6;
      if (/^[A-Z]/.test(w) && i > 0) sc += 3;
      if (/[A-Z].*[A-Z]/.test(w)) sc += 4; // acronyms like ATP, NADH
      if (w.length < 3) sc -= 10;
      if (sc > score) { score = sc; best = w; }
    });
    return score >= 4 ? best : null;
  }

  function cloze(sentence) {
    const w = keyWord(sentence);
    if (!w) return null;
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
    if (!re.test(sentence)) return null;
    return { prompt: sentence.replace(re, "_____"), answer: w };
  }

  function analyze(notes) {
    // notes: [{id, title, text}]
    const out = [];
    notes.forEach((n) => {
      parseSections(n.text, n.title).forEach((sec) => {
        const defs = [], points = [];
        const seen = new Set();
        sec.body.forEach((line) => {
          const cl = clean(line);
          if (!cl) return;
          splitSentences(cl).forEach((sent) => {
            if (sent.length < 12 || seen.has(sent)) return;
            seen.add(sent);
            const d = asDefinition(sent);
            if (d) defs.push({ ...d, sentence: sent });
            else points.push(sent);
          });
        });
        if (defs.length || points.length) out.push({ title: sec.title, source: n.title, defs, points });
      });
    });
    return out;
  }

  let uid = 0;
  const id = () => Date.now().toString(36) + (uid++).toString(36);

  function flashcards(sections) {
    const cards = [];
    sections.forEach((sec) => {
      sec.defs.forEach((d) => cards.push({ id: id(), front: d.term, back: d.def, section: sec.title, kind: "definition" }));
      sec.points.forEach((p) => {
        const c = cloze(p);
        if (c) cards.push({ id: id(), front: c.prompt, back: c.answer + " — " + p, section: sec.title, kind: "cloze" });
      });
    });
    return cards;
  }

  function studyGuide(sections) {
    return sections.map((sec) => ({
      id: id(),
      title: sec.title,
      terms: sec.defs.map((d) => ({ term: d.term, def: d.def })),
      points: sec.points.slice(),
    }));
  }

  function practiceExam(sections, max) {
    max = max || 15;
    const pool = [], seenTerms = new Set();
    sections.forEach((sec) => {
      sec.defs.forEach((d) => {
        if (seenTerms.has(d.term.toLowerCase())) return;
        seenTerms.add(d.term.toLowerCase());
        pool.push({ id: id(), q: `Define ${d.term}.`, a: d.def, section: sec.title });
      });
      sec.points.forEach((p) => {
        const c = cloze(p);
        if (c) pool.push({ id: id(), q: `Fill in the blank and explain: ${c.prompt}`, a: p, section: sec.title });
      });
    });
    // Spread questions across sections: round-robin by section
    const bySec = {};
    pool.forEach((q) => (bySec[q.section] = bySec[q.section] || []).push(q));
    const keys = Object.keys(bySec);
    const picked = [];
    let i = 0;
    while (picked.length < Math.min(max, pool.length)) {
      const list = bySec[keys[i % keys.length]];
      if (list.length) picked.push(list.shift());
      i++;
    }
    return picked;
  }

  function generate(notes, format) {
    const sections = analyze(notes);
    if (format === "flashcards") return flashcards(sections);
    if (format === "guide") return studyGuide(sections);
    return practiceExam(sections);
  }

  function stats(text) {
    return { sections: parseSections(text, "Notes").length, chars: text.length };
  }

  window.NoteGen = { generate, analyze, stats, SAMPLE };
})();
