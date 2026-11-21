(() => {
  "use strict";
  // Random / Mutate for the Novation Components synth editor (Circuit Tracks).
  // Runs in the page (world MAIN). It sets the editor's own controls (ARIA sliders, selects, radios),
  // so Components itself sends every change to the Circuit Tracks. Nothing is saved or sent from here.
  // All user-facing text lives in data/lang.csv; musical ranges in data/recipes.csv; phrases in data/phrases.csv.
  // The three CSV files are delivered by loader.js (isolated world) through window.postMessage.
  if (window.__ctRandomLoaded) return;
  window.__ctRandomLoaded = true;

  const PANEL_ID = "ct-random-panel";
  const STORE_KEY = "ctRandom.v1";
  const HISTORY_MAX = 20;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const S = {
    data: null, busy: false, undo: [], history: [], timers: [], activeNotes: [], midi: null,
    ui: { lang: "", type: "any", intensity: 70, locks: {}, autoplay: true, phrase: "auto", channel: 1, collapsed: false }
  };

  // ---------------------------------------------------------------- CSV
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.trim());
    return rows.filter(r => !String(r[0]).startsWith("#")).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  }

  function prepareData(files) {
    const lang = {};
    for (const r of parseCsv(files.lang)) lang[r.key] = r;
    const types = {};
    for (const r of parseCsv(files.recipes)) types[r.type] = { jitter: +r.jitter, wild: +r.wild, phrase: r.phrase };
    // data/levels.csv: thresholds for the audio level check (dBFS at the user's interface gain).
    const levels = { target_db: -21, tolerance_db: 7, silent_db: -40, peak_db: -1, retries: 3, corrections: 2, tail_db: -60 };
    for (const r of parseCsv(files.levels || "key,value\n")) if (r.key in levels) levels[r.key] = +r.value;
    const corpus = parseCsv(files.corpus).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== "" && k !== "mx" && !isNaN(+v) ? +v : v])));
    const phrases = {};
    for (const r of parseCsv(files.phrases)) (phrases[r.phrase] ??= []).push({ t: +r.time_ms, note: +r.note, dur: +r.dur_ms, vel: +r.vel });
    return { lang, types, phrases, corpus, levels };
  }

  // Language file connection point: data/lang.csv (columns key, sk, en).
  function T(key, vars = {}) {
    const row = S.data?.lang[key];
    let text = (row && (row[S.ui.lang] || row.en)) || key;
    for (const [k, v] of Object.entries(vars)) text = text.replace("{" + k + "}", v);
    return text;
  }

  // ---------------------------------------------------------------- parameter table
  // Each parameter: key, kind (slider | select | radio | check), where it lives (tab, head, sub), group, locator.
  const PARAMS = [];
  const add = (key, kind, tab, head, group, loc, sub) => PARAMS.push({ key, kind, tab, head, group, loc, sub: sub || 0 });
  for (const o of ["osc1", "osc2"]) {
    const head = o === "osc1" ? "OSC 1" : "OSC 2", L = o === "osc1" ? "OSC 1 " : "OSC 2 ";
    add(o + ".wave", "select", "MAIN", head, "osc", { idx: 0 });
    add(o + ".index", "slider", "MAIN", head, "osc", { label: L + "Wave Index" });
    add(o + ".interp", "slider", "MAIN", head, "osc", { label: L + "Wave Interpolate" });
    add(o + ".vsync", "slider", "MAIN", head, "osc", { label: L + "Virtual Sync Depth" });
    add(o + ".cents", "slider", "MAIN", head, "osc", { label: L + "Detune Cents" });
    add(o + ".semi", "slider", "MAIN", head, "osc", { label: L + "Detune Semitones" });
    add(o + ".density", "slider", "MAIN", head, "osc", { label: L + "Density" });
    add(o + ".dtune", "slider", "MAIN", head, "osc", { label: L + "Density Detune" });
  }
  add("mix.osc1", "slider", "MAIN", "MIXER", "mixer", { label: "OSC 1 Level" });
  add("mix.osc2", "slider", "MAIN", "MIXER", "mixer", { label: "OSC 2 Level" });
  add("mix.noise", "slider", "MAIN", "MIXER", "mixer", { label: "Noise Level" });
  add("mix.ring", "slider", "MAIN", "MIXER", "mixer", { label: "Ringmod Level" });
  add("mix.pre", "slider", "MAIN", "MIXER", "mixer", { label: "Pre FX Level" });
  add("mix.post", "slider", "MAIN", "MIXER", "mixer", { label: "Post FX Level" });
  add("flt.type", "select", "MAIN", "FILTER", "filter", { idx: 0 });
  add("flt.route", "radio", "MAIN", "FILTER", "filter", { name: "filter-routing" });
  add("flt.freq", "slider", "MAIN", "FILTER", "filter", { label: "Frequency" });
  add("flt.res", "slider", "MAIN", "FILTER", "filter", { label: "Resonance" });
  add("flt.q", "slider", "MAIN", "FILTER", "filter", { label: "Q" });
  add("flt.key", "slider", "MAIN", "FILTER", "filter", { label: "Key Track" });
  add("flt.env2", "slider", "MAIN", "FILTER", "filter", { label: "Env 2 > Freq" });
  add("flt.drivetype", "select", "MAIN", "FILTER", "filter", { idx: 1 });
  add("flt.drive", "slider", "MAIN", "FILTER", "filter", { label: "Drive" });
  const velLabel = { 1: "Amp Envelope Velocity Modulation", 2: "Filter Envelope Velocity Modulation" };
  for (const n of [1, 2, 3]) {
    add(`env${n}.a`, "slider", "MAIN", "ENVELOPE", "env", { label: "Attack" }, n);
    add(`env${n}.d`, "slider", "MAIN", "ENVELOPE", "env", { label: "Decay" }, n);
    add(`env${n}.s`, "slider", "MAIN", "ENVELOPE", "env", { label: "Sustain" }, n);
    add(`env${n}.r`, "slider", "MAIN", "ENVELOPE", "env", { label: "Release" }, n);
    if (n < 3) add(`env${n}.vel`, "slider", "MAIN", "ENVELOPE", "env", { label: velLabel[n] }, n);
    else add("env3.delay", "slider", "MAIN", "ENVELOPE", "env", { label: "Envelope 3 Delay" }, n);
  }
  for (const n of [1, 2]) {
    add(`lfo${n}.shape`, "select", "MAIN", "LFO", "lfo", { idx: 0 }, n);
    add(`lfo${n}.rate`, "slider", "MAIN", "LFO", "lfo", { label: "Rate" }, n);
    add(`lfo${n}.slew`, "slider", "MAIN", "LFO", "lfo", { label: "Slew" }, n);
    add(`lfo${n}.delay`, "slider", "MAIN", "LFO", "lfo", { label: "Delay" }, n);
    add(`lfo${n}.keysync`, "radio", "MAIN", "LFO", "lfo", { name: "keySync" }, n);
    add(`lfo${n}.oneshot`, "check", "MAIN", "LFO", "lfo", { suffix: "one-shot" }, n);
  }
  add("fx.ctype", "radio", "EFFECTS", "CHORUS", "chorus", { name: "fx.chorusType" });
  add("fx.crate", "slider", "EFFECTS", "CHORUS", "chorus", { label: "Rate" });
  add("fx.cfb", "slider", "EFFECTS", "CHORUS", "chorus", { label: "Feedback" });
  add("fx.cdepth", "slider", "EFFECTS", "CHORUS", "chorus", { label: "Depth" });
  add("fx.cdelay", "slider", "EFFECTS", "CHORUS", "chorus", { label: "Delay" });
  add("fx.clevel", "slider", "EFFECTS", "CHORUS", "chorus", { label: "Level" });
  for (const [k, label] of [["eq.lg", "Low Gain"], ["eq.lf", "Low Freq"], ["eq.mg", "Mid Gain"], ["eq.mf", "Mid Freq"], ["eq.hg", "High Gain"], ["eq.hf", "High Freq"]])
    add(k, "slider", "EFFECTS", "EQUALISER", "eq", { label });
  add("dist.type", "select", "EFFECTS", "DISTORTION", "dist", { idx: 0 });
  add("dist.level", "slider", "EFFECTS", "DISTORTION", "dist", { idx: 0, unlabeled: true });
  add("dist.comp", "slider", "EFFECTS", "DISTORTION", "dist", { idx: 1, unlabeled: true });
  add("voice.mode", "radio", "EFFECTS", "VOICE", "voice", { name: "polyphonyMode" });
  add("voice.port", "slider", "EFFECTS", "VOICE", "voice", { label: "Portamento" });
  add("voice.preglide", "slider", "EFFECTS", "VOICE", "voice", { label: "Pre-Glide" });
  add("voice.octave", "slider", "EFFECTS", "VOICE", "voice", { label: "Keyboard Octave" });
  // Modulation matrix: 20 slots, each with source 1, source 2, destination and depth.
  const MX_SLOTS = 20;
  for (let i = 0; i < MX_SLOTS; i++) {
    for (const f of ["src1", "src2", "dest", "depth"]) add(`mx.${i}.${f}`, f === "depth" ? "slider" : "select", "MODULATION", "", "matrix", { mx: i, field: f });
  }
  const GROUP_OF = Object.fromEntries(PARAMS.map(p => [p.key, p.group]));
  const GROUPS = ["osc", "mixer", "filter", "env", "lfo", "matrix", "chorus", "eq", "dist", "voice"];

  // Destination depth caps for the modulation matrix (pitch needs small values).
  const MX_CAP = { "Osc 1/2 Pitch": 10, "Osc 1 Pitch": 10, "Osc 2 Pitch": 10, "Frequency": 45, "Resonance": 30, "Drive Amount": 30 };

  // ---------------------------------------------------------------- DOM access
  const fieldsets = () => [...document.querySelectorAll(".macro-editor--fieldset")];
  const headOf = f => (f.firstElementChild?.textContent || "").trim().toUpperCase();
  const fieldset = head => fieldsets().find(f => headOf(f).startsWith(head));
  const tabButton = name => [...document.querySelectorAll("button.page-switcher--switch")].find(b => b.textContent.trim().toUpperCase() === name);
  const inEditor = () => !!tabButton("MAIN");

  async function waitFor(test, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (test()) return true; } catch { /* keep waiting */ } await sleep(40); }
    return false;
  }

  async function ensureTab(name) {
    const button = tabButton(name);
    if (!button) throw new Error("Tab not found: " + name);
    if (!/__activ/.test(button.className)) button.click();
    const marker = { MAIN: () => fieldset("OSC 1"), EFFECTS: () => fieldset("CHORUS"), MODULATION: () => document.querySelectorAll("select").length >= 10 }[name];
    if (!(await waitFor(marker))) throw new Error("Tab did not open: " + name);
    await sleep(40);
  }

  const subButton = (head, n) => [...(fieldset(head)?.querySelectorAll("button") || [])].find(b => b.textContent.trim() === String(n));
  async function ensureSub(head, n) {
    const button = subButton(head, n);
    if (!button) throw new Error(`Sub tab not found: ${head} ${n}`);
    if (!/__active/.test(button.className)) button.click();
    if (!(await waitFor(() => /__active/.test(subButton(head, n)?.className || "")))) throw new Error(`Sub tab did not open: ${head} ${n}`);
    await sleep(50);
  }

  function press(el, key, code, shift) {
    const event = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, shiftKey: !!shift });
    Object.defineProperty(event, "keyCode", { get: () => code });
    Object.defineProperty(event, "which", { get: () => code });
    el.dispatchEvent(event);
  }

  function setSlider(el, wanted) {
    const min = +el.getAttribute("aria-valuemin"), max = +el.getAttribute("aria-valuemax");
    const target = Math.max(min, Math.min(max, Math.round(wanted)));
    el.focus();
    for (let guard = 0; guard < 80; guard++) {
      const diff = target - (+el.getAttribute("aria-valuenow"));
      if (diff === 0) return true;
      press(el, diff > 0 ? "ArrowUp" : "ArrowDown", diff > 0 ? 38 : 40, Math.abs(diff) >= 10);
    }
    return +el.getAttribute("aria-valuenow") === target;
  }

  const radioLabel = r => (r.closest("label")?.textContent || document.querySelector(`label[for="${r.id}"]`)?.textContent || "").trim();

  // Matrix elements on the Modulation tab, in DOM order.
  function matrixElements() {
    const selects = [...document.querySelectorAll("select")];
    const slots = [];
    for (let i = 0; i < selects.length - 2; i++) {
      if (selects[i].options.length === 10 && selects[i + 1].options.length === 10 && selects[i + 2].options.length === 18) {
        slots.push({ src1: selects[i], src2: selects[i + 1], dest: selects[i + 2] }); i += 2;
      }
    }
    const depths = [...document.querySelectorAll('[role="slider"]')].filter(s => !s.getAttribute("aria-label") && s.getAttribute("aria-valuemin") === "-64" && s.getAttribute("aria-valuemax") === "63");
    slots.forEach((slot, i) => { slot.depth = depths[i]; });
    return slots;
  }

  function locate(p) {
    if (p.tab === "MODULATION") { const slot = matrixElements()[p.loc.mx]; return slot ? slot[p.loc.field] : null; }
    const f = fieldset(p.head);
    if (!f) return null;
    if (p.kind === "slider") {
      const list = [...f.querySelectorAll('[role="slider"]')];
      if (p.loc.unlabeled) return list.filter(s => !s.getAttribute("aria-label"))[p.loc.idx] || null;
      const same = list.filter(s => s.getAttribute("aria-label") === p.loc.label);
      return same.find(s => s.tagName === "DIV") || same[0] || null;
    }
    if (p.kind === "select") return f.querySelectorAll("select")[p.loc.idx] || null;
    if (p.kind === "radio") return [...f.querySelectorAll('input[type="radio"]')].filter(r => r.name === p.loc.name);
    if (p.kind === "check") return [...f.querySelectorAll('input[type="checkbox"]')].find(c => c.id.endsWith(p.loc.suffix)) || null;
    return null;
  }

  function readParam(p) {
    const el = locate(p);
    if (!el || (Array.isArray(el) && !el.length)) return null;
    if (p.kind === "slider") return { value: +el.getAttribute("aria-valuenow"), min: +el.getAttribute("aria-valuemin"), max: +el.getAttribute("aria-valuemax") };
    if (p.kind === "select") return { value: el.options[el.selectedIndex]?.text.trim(), options: [...el.options].map(o => o.text.trim()) };
    if (p.kind === "radio") { const on = el.find(r => r.checked); return { value: on ? radioLabel(on) : undefined, options: el.map(radioLabel) }; }
    if (p.kind === "check") return { value: !!el.checked };
    return null;
  }

  function writeParam(p, value) {
    const el = locate(p);
    if (!el || (Array.isArray(el) && !el.length)) return false;
    if (p.kind === "slider") return setSlider(el, value);
    const index = typeof value === "string" && /^#\d+$/.test(value) ? +value.slice(1) : -1;
    if (p.kind === "select") {
      const option = index >= 0 ? el.options[index] : [...el.options].find(o => o.text.trim().toLowerCase() === String(value).toLowerCase());
      if (!option) return false;
      if (el.selectedIndex !== option.index) {
        el.selectedIndex = option.index;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
    if (p.kind === "radio") {
      const radio = index >= 0 ? el[index] : el.find(r => radioLabel(r) === value);
      if (!radio) return false;
      if (!radio.checked) radio.click();
      return true;
    }
    if (p.kind === "check") { if (el.checked !== !!value) el.click(); return true; }
    return false;
  }

  // Parameters grouped by the page (tab + sub tab) they live on, in a fixed visiting order.
  const PAGES = [];
  for (const p of PARAMS) {
    let page = PAGES.find(g => g.tab === p.tab && g.head === p.head && g.sub === p.sub);
    if (!page) { page = { tab: p.tab, head: p.head, sub: p.sub, params: [] }; PAGES.push(page); }
    page.params.push(p);
  }
  async function openPage(page) {
    await ensureTab(page.tab);
    if (page.sub) await ensureSub(page.head, page.sub);
  }
  async function restoreView() {
    try { await ensureTab("MAIN"); await ensureSub("ENVELOPE", 1); await ensureSub("LFO", 1); } catch { /* the view is cosmetic */ }
  }

  async function readAll() {
    const cur = {}, meta = {};
    for (const page of PAGES) {
      await openPage(page);
      for (const p of page.params) {
        const r = readParam(p);
        if (r && r.value !== undefined) { cur[p.key] = r.value; meta[p.key] = r; }
      }
    }
    await restoreView();
    return { cur, meta };
  }

  // Writes only values that differ from what the editor shows. Returns the number of changed values.
  async function applyState(next) {
    let changed = 0;
    for (const page of PAGES) {
      const todo = page.params.filter(p => next[p.key] !== undefined);
      if (!todo.length) continue;
      await openPage(page);
      for (const p of todo) {
        const now = readParam(p);
        if (!now) continue;
        const want = next[p.key];
        if (now.value === want) continue;
        if (typeof want === "string" && /^#\d+$/.test(want) && now.options && now.options.indexOf(now.value) === +want.slice(1)) continue;
        if (writeParam(p, next[p.key])) changed++;
      }
      // Second pass: a knob can be disabled until another control (e.g. the wave) changes, so retry what did not stick.
      for (const p of todo) {
        const now = readParam(p), want = next[p.key];
        if (now && p.kind === "slider" && now.value !== want) writeParam(p, want);
      }
      await sleep(0);
    }
    await restoreView();
    return changed;
  }

  // ---------------------------------------------------------------- generator
  // Random builds a sound from sections of real factory/community patches (data/corpus.csv): oscillators + mixer + voice
  // from one donor, filter from another, envelopes from another, and so on. Every unlocked section is always replaced.
  // Intensity = wildness: 0 = clean donor sections, 100 = jitter, extreme effects, single extreme values, extra matrix slots.
  // Mutate only nudges the current sound.
  // Seeded generator: the seed is stored with every run (history, debug JSON) so a sound can be reproduced.
  const mulberry32 = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let rng = Math.random;
  const rnd = () => rng();
  const lastInfo = { donors: [] };
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.58;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pickOne = list => list[Math.floor(rnd() * list.length)];
  const typeCfg = type => S.data.types[type] || S.data.types.any;
  const donors = type => {
    const list = type === "any" ? S.data.corpus : S.data.corpus.filter(r => r.type === type);
    return list.length ? list : S.data.corpus;
  };
  const SECTIONS = [["osc", "mixer", "voice"], ["filter"], ["env"], ["lfo"], ["chorus"], ["eq"], ["dist"]];
  const parseMatrix = text => String(text || "").split(";").filter(Boolean).map(s => { const [src1, src2, dest, depth] = s.split("|"); return { src1, src2, dest, depth: +depth }; });
  // Never touched by the "wild" step: they decide pitch range, loudness and voice behaviour.
  const PITCH_KEY = /^(voice\.(octave|preglide)|osc\d\.semi)/;
  // Matrix destination indices that change loudness (Osc 1 Level, Osc 2 Level, Noise Level, Ring Mod Level).
  const LEVEL_DEST = new Set([7, 8, 9, 10]);
  const NO_WILD = /^(voice\.|mix\.|osc\d\.(semi|cents)|env1\.|eq\.(lg|mg|hg))/;

  function planRandom(cur, meta, type, k, locks) {
    const cfg = typeCfg(type), pool = donors(type), next = {};
    lastInfo.donors = [];
    // Each chosen section is replaced completely by one donor patch (no blending with the current sound).
    for (const set of SECTIONS) {
      if (set.every(g => locks[g])) continue;
      const donor = pickOne(pool);
      lastInfo.donors.push({ sections: set.join("+"), name: donor.name, pack: donor.pack });
      for (const p of PARAMS) {
        if (!set.includes(p.group) || locks[p.group] || donor[p.key] === undefined || donor[p.key] === "" || cur[p.key] === undefined) continue;
        if (p.kind === "slider") {
          const m = meta[p.key], v = +donor[p.key];
          const jitter = PITCH_KEY.test(p.key) ? 0 : gauss() * (m.max - m.min) * cfg.jitter * 0.1 * k;
          next[p.key] = Math.round(clamp(v + jitter, m.min, m.max));
        } else if (p.kind === "check") next[p.key] = donor[p.key] === "1" || donor[p.key] === 1;
        else next[p.key] = donor[p.key];
      }
    }
    // Extreme effects: chorus/phaser and distortion sometimes get any value of the full range.
    for (const g of ["chorus", "dist"]) {
      if (locks[g] || rnd() > cfg.wild * 0.5 * k) continue;
      lastInfo.donors.push({ sections: g, name: "wild", pack: "" });
      for (const p of PARAMS) {
        if (p.group !== g || cur[p.key] === undefined) continue;
        const m = meta[p.key];
        // Factory reference patches keep distortion level at about 70 or below; higher wild values were far too loud.
        const top = p.key === "dist.level" ? Math.min(m.max, 70) : m.max;
        if (p.kind === "slider") next[p.key] = Math.round(m.min + rnd() * (top - m.min));
        else if (m.options) next[p.key] = pickOne(m.options);
      }
    }
    // Wild step: single random extreme values (not for pitch range, loudness and voice behaviour).
    for (const p of PARAMS) {
      if (locks[p.group] || p.group === "matrix" || NO_WILD.test(p.key) || cur[p.key] === undefined || rnd() > cfg.wild * k * 0.14) continue;
      const m = meta[p.key], top = p.key === "dist.level" ? Math.min(m.max, 70) : m.max;
      if (p.kind === "slider") next[p.key] = Math.round(m.min + rnd() * (top - m.min));
      else if (p.kind === "check") next[p.key] = rnd() < 0.5;
      else if (m.options) next[p.key] = pickOne(m.options);
    }
    return next;
  }

  function planMutate(cur, meta, type, k, locks) {
    const pool = donors(type), next = {};
    for (const p of PARAMS) {
      if (locks[p.group] || p.group === "matrix" || /^(voice\.|osc\d\.semi)/.test(p.key) || cur[p.key] === undefined) continue;
      if (p.kind === "slider") {
        const m = meta[p.key];
        next[p.key] = Math.round(clamp(cur[p.key] + gauss() * (m.max - m.min) * 0.2 * k, m.min, m.max));
      } else if (rnd() < 0.15 * k) {
        const d = pickOne(pool)[p.key];
        if (d !== undefined && d !== "") next[p.key] = p.kind === "check" ? (d === "1" || d === 1) : d;
      }
    }
    return next;
  }

  function planMatrix(kind, cur, meta, type, k, locks) {
    const next = {};
    if (locks.matrix) return next;
    const cfg = typeCfg(type), depthKey = i => `mx.${i}.depth`;
    const srcOptions = meta["mx.0.src1"]?.options || [], destOptions = meta["mx.0.dest"]?.options || [];
    const put = (i, slot) => {
      const cap = MX_CAP[slot.dest] ?? 35;
      next[`mx.${i}.src1`] = slot.src1; next[`mx.${i}.src2`] = slot.src2; next[`mx.${i}.dest`] = slot.dest;
      next[depthKey(i)] = Math.round(clamp(slot.depth * (0.3 + 0.7 * k), -cap * 1.4, cap * 1.4));
    };
    const used = [];
    for (let i = 0; i < MX_SLOTS; i++) if (cur[depthKey(i)] !== undefined && cur[depthKey(i)] !== 0) used.push(i);
    if (kind === "random") {
      for (const i of used) next[depthKey(i)] = 0;
      let slots = parseMatrix(pickOne(donors(type)).mx).filter(s => srcOptions.includes(s.src1) && destOptions.includes(s.dest))
        .filter(s => !(LEVEL_DEST.has(destOptions.indexOf(s.dest)) && s.src1 === srcOptions[0] && s.src2 === srcOptions[0] && s.depth < 0));
      if (slots.length > 6) slots = slots.slice(0, 6);
      const extra = Math.floor(rnd() * (cfg.wild * 3 * k + 1));
      const wildDest = destOptions.filter((d, i) => !LEVEL_DEST.has(i));
      for (let n = 0; n < extra; n++) {
        const dest = pickOne(wildDest), cap = MX_CAP[dest] ?? 35;
        slots.push({ src1: pickOne(srcOptions.slice(3)), src2: "Direct", dest, depth: (rnd() < 0.5 ? -1 : 1) * cap * (0.3 + 0.7 * rnd()) });
      }
      slots.slice(0, MX_SLOTS).forEach((slot, i) => put(i, slot));
    } else {
      for (const i of used) next[depthKey(i)] = Math.round(clamp(cur[depthKey(i)] + gauss() * 30 * k, -64, 63));
    }
    return next;
  }

  // Safety rules applied to the merged result. They only touch values whose group is not locked.
  // Rule of thumb, checked against the 516 decoded real patches (data/corpus.csv): a rule may change at most a handful of
  // real patches. Loudness itself is handled by the level check, which measures the sound (data/levels.csv).
  function applyGuards(cur, next, locks) {
    const m = { ...cur, ...next };
    const put = (key, value) => { if (!locks[GROUP_OF[key]] && cur[key] !== undefined) { m[key] = value; next[key] = value; } };
    const levels = ["mix.osc1", "mix.osc2", "mix.noise", "mix.ring"];
    // Many real patches have all mixer levels low and open a source through the matrix (Direct -> Osc Level).
    const matrixLevel = Object.keys(m).some(key => /^mx\.\d+\.dest$/.test(key) && /Level$/.test(String(m[key])) && (m[key.replace("dest", "depth")] ?? 0) > 10);
    if (Math.max(...levels.map(l => m[l] ?? 0)) < 50 && !matrixLevel) put("mix.osc1", 100);
    if ((m["env1.s"] ?? 99) < 8 && (m["env1.d"] ?? 99) < 8) put("env1.d", 30);
    if ((m["env1.a"] ?? 0) > 110) put("env1.a", 110);
    const type = String(m["flt.type"] || "");
    if (type.startsWith("Highpass") && (m["flt.freq"] ?? 0) > 100) put("flt.freq", 100);
    for (const key of ["osc1.semi", "osc2.semi"]) if (Math.abs(m[key] ?? 0) > 24) put(key, clamp(m[key], -24, 24));
    // A very long release with no sustain kept ringing into the next recording (test batch 2026-11).
    if ((m["env1.s"] ?? 127) < 10 && (m["env1.r"] ?? 0) > 100) put("env1.r", 90);
    if ((m["flt.res"] ?? 0) > 100 && (m["flt.drive"] ?? 0) > 50) put("flt.res", 85);
    if (/Reducer/.test(String(m["dist.type"] || "")) && (m["dist.level"] ?? 0) > 60) put("dist.level", 60);
    return next;
  }

  // attempt > 0: automatic retry after the level check found silence; it replaces the previous try in history and undo.
  async function run(kind, attempt = 0) {
    if (S.busy) { status(T("status_busy")); return; }
    S.busy = true; setBusy(true);
    let retry = false;
    try {
      status(T("status_reading"));
      const { cur, meta } = await readAll();
      if (attempt > 0) { S.history.shift(); } else { S.undo.push(cur); if (S.undo.length > HISTORY_MAX) S.undo.shift(); }
      const k = S.ui.intensity / 100, type = S.ui.type, locks = S.ui.locks;
      const seed = (Math.random() * 4294967296) >>> 0;
      rng = mulberry32(seed);
      const next = { ...(kind === "random" ? planRandom : planMutate)(cur, meta, type, k, locks), ...planMatrix(kind, cur, meta, type, k, locks) };
      applyGuards(cur, next, locks);
      const diff = Object.keys(next).filter(key => next[key] !== cur[key]).length;
      status(T("status_applying", { n: diff }));
      const changed = await applyState(next);
      const merged = { ...cur, ...next };
      S.octave = merged["voice.octave"] ?? 0;
      rng = Math.random;
      const donorList = kind === "random" ? lastInfo.donors.slice() : [];
      S.last = { kind, type, intensity: S.ui.intensity, locks: { ...locks }, seed, donors: donorList, values: merged };
      S.history.unshift({ id: Date.now(), kind, type, values: merged, star: false, seed, intensity: S.ui.intensity, donors: donorList });
      trimHistory(); save(); renderHistory();
      status(T("status_done", { n: changed }));
      if (S.ui.autoplay && !S.looping) {
        if (S.ui.levelCheck) retry = await levelCheck(kind, attempt);
        else await playPhrase(S.octave).catch(e => status(errorText(e)));
      }
    } catch (e) { status(T("status_error", { msg: e.message })); }
    finally { rng = Math.random; S.busy = false; setBusy(false); }
    if (retry) await run(kind, attempt + 1);
  }

  // Plays the phrase while recording the audio interface input and measures it (loudest 50 ms = max_db).
  // Silent (below levels.csv silent_db) -> returns true, the caller generates again (up to "retries").
  // Outside target_db +- tolerance_db (factory patches recorded at the user's gain) -> the level is corrected, up to
  // "corrections" times, each followed by a new measurement. The correction uses Post FX Level first: it is the last gain
  // stage, in dB, after drive, distortion and EQ (lowering the mixer did not help when drive or EQ boosts saturated the
  // signal, test batch 2026-11). The mixer is scaled only for what Post FX (-12..+18 dB) cannot cover. Peak stays below peak_db.
  const MIX_KEYS = ["mix.osc1", "mix.osc2", "mix.ring", "mix.noise"];
  async function levelCheck(kind, attempt) {
    const L = S.data.levels;
    let a;
    try { a = analyse(await recordPhrase(S.octave)); }
    catch (e) {
      // No usable input: still play the phrase so the sound can be heard.
      status(audioError(e));
      if (!S.timers.length) await playPhrase(S.octave).catch(() => {});
      return false;
    }
    if (a.max_db < L.silent_db) {
      if (kind === "random" && attempt < L.retries) { status(T("status_retry", { max: a.max_db, i: attempt + 1, n: L.retries })); return true; }
      status(T("status_quiet", { max: a.max_db })); return false;
    }
    const first = a.max_db;
    for (let pass = 0; pass < L.corrections; pass++) {
      let gainDb = Math.abs(a.max_db - L.target_db) > L.tolerance_db || pass > 0 ? L.target_db - a.max_db : 0;
      gainDb = Math.min(gainDb, L.peak_db - a.peak_db);
      if (Math.abs(gainDb) < 1.5 || S.ui.locks.mixer || !S.last) break;
      const values = {}, post = S.last.values["mix.post"] ?? 0;
      const newPost = clamp(Math.round(post + gainDb), -12, 18);
      if (newPost !== post) values["mix.post"] = newPost;
      const rest = gainDb - (newPost - post);
      if (Math.abs(rest) >= 1.5) {
        const keys = MIX_KEYS.filter(key => S.last.values[key] !== undefined);
        const loudest = Math.max(1, ...keys.map(key => S.last.values[key]));
        let factor = Math.pow(10, rest / 20);
        if (loudest * factor > 127) factor = 127 / loudest;
        for (const key of keys) values[key] = Math.round(clamp(S.last.values[key] * factor, 0, 127));
      }
      if (!Object.keys(values).length) { status(T("status_level_limit", { max: a.max_db })); return false; }
      await applyState(values);
      Object.assign(S.last.values, values);
      if (S.history[0]) S.history[0].values = { ...S.last.values };
      save();
      await sleep(200);
      try { a = analyse(await recordPhrase(S.octave)); } catch (e) { status(audioError(e)); return false; }
      if (Math.abs(a.max_db - L.target_db) <= 2) break;
    }
    status(first === a.max_db ? T("status_level_ok", { max: a.max_db, peak: a.peak_db }) : T("status_level_fixed", { from: first, to: a.max_db, target: L.target_db }));
    return false;
  }

  async function undoLast() {
    if (S.busy) { status(T("status_busy")); return; }
    const prev = S.undo.pop();
    if (!prev) { status(T("status_undo_empty")); return; }
    await restoreEntry({ values: prev }, true);
  }
  async function restoreEntry(entry, isUndo) {
    if (S.busy) { status(T("status_busy")); return; }
    S.busy = true; setBusy(true);
    try {
      const changed = await applyState(entry.values);
      if (entry.values["voice.octave"] !== undefined) S.octave = entry.values["voice.octave"];
      if (!isUndo && entry.kind) S.last = { kind: entry.kind, type: entry.type, intensity: entry.intensity ?? 0, locks: {}, seed: entry.seed ?? 0, donors: entry.donors || [], values: entry.values };
      status(isUndo ? T("status_undo_done") : T("status_done", { n: changed }));
      if (!isUndo && S.ui.autoplay && !S.looping) await playPhrase(S.octave ?? 0).catch(e => status(errorText(e)));
    } catch (e) { status(T("status_error", { msg: e.message })); }
    finally { S.busy = false; setBusy(false); }
  }

  function trimHistory() {
    const stars = S.history.filter(h => h.star), rest = S.history.filter(h => !h.star).slice(0, HISTORY_MAX);
    S.history = S.history.filter(h => h.star || rest.includes(h)).slice(0, HISTORY_MAX + stars.length);
  }

  // ---------------------------------------------------------------- MIDI playback
  const errorText = e => e.message === "nomidi" ? T("status_no_midi") : e.message === "noport" ? T("status_no_port") : T("status_error", { msg: e.message });

  async function getOutput() {
    if (!navigator.requestMIDIAccess) throw new Error("nomidi");
    S.midi = S.midi || await navigator.requestMIDIAccess({ sysex: true });
    const outs = [...S.midi.outputs.values()].filter(p => p.state === "connected" && /circuit\s*tracks/i.test(p.name || "") && !/(?:\bmidi|\bport)\s*[23]\b/i.test(p.name || ""));
    if (outs.length !== 1) throw new Error("noport");
    await outs[0].open();
    return outs[0];
  }

  function stopPlayback() {
    for (const t of S.timers) clearTimeout(t);
    S.timers = [];
    if (S.playDone) { const done = S.playDone; S.playDone = null; done(); }
    if (S.activeNotes.length) {
      const { out, ch } = S.activeNotes[0];
      for (const { note } of S.activeNotes) { try { out.send([0x80 | ch, note, 0]); } catch { /* port gone */ } }
      try { out.send([0xB0 | ch, 123, 0]); } catch { /* port gone */ }
    }
    S.activeNotes = [];
  }

  // octave: the editor's Keyboard Octave. The CT applies it to its own pads/sequencer but ignores it for incoming MIDI notes,
  // so it is added to the phrase notes to make the preview sound like the pads do.
  async function playPhrase(octave = 0) {
    stopPlayback();
    const out = await getOutput();
    let name = S.ui.phrase;
    if (name === "auto") name = typeCfg(S.ui.type).phrase || "single";
    const events = S.data.phrases[name] || S.data.phrases.single;
    const ch = clamp(+S.ui.channel || 1, 1, 16) - 1;
    const shift = 12 * octave, port = (out.name || "").trim();
    status(T("status_playing", { ch: ch + 1, port, oct: octave }));
    console.info("[CT Random] playing phrase", name, "on channel", ch + 1, "port", port, "octave", octave);
    let end = 0;
    for (const e of events) {
      const note = clamp(e.note + shift, 0, 127);
      S.timers.push(setTimeout(() => { out.send([0x90 | ch, note, e.vel]); S.activeNotes.push({ out, ch, note }); }, e.t));
      S.timers.push(setTimeout(() => { out.send([0x80 | ch, note, 0]); S.activeNotes = S.activeNotes.filter(a => a.note !== note); }, e.t + e.dur));
      end = Math.max(end, e.t + e.dur);
    }
    return new Promise(resolve => {
      S.playDone = resolve;
      S.timers.push(setTimeout(() => { S.timers = []; S.playDone = null; if (!S.looping && !S.recording) status(T("status_idle")); resolve(); }, end + 50));
    });
  }

  // Manual play of the current editor sound, and a loop with a pause (seconds) between repeats.
  function playNow() { playPhrase(S.octave ?? 0).catch(e => status(errorText(e))); }
  async function toggleLoop() {
    if (S.looping) { stopLoop(); return; }
    S.looping = true; render();
    try {
      while (S.looping) {
        await playPhrase(S.octave ?? 0);
        if (!S.looping) break;
        status(T("status_loop_wait", { s: S.ui.loopPause }));
        const end = Date.now() + S.ui.loopPause * 1000;
        while (S.looping && Date.now() < end) await sleep(100);
      }
    } catch (e) { status(errorText(e)); }
    stopLoop();
  }
  function stopLoop() {
    S.looping = false; stopPlayback(); render();
  }

  // ---------------------------------------------------------------- export (.syx from the CT, optional debug JSON)
  const dumpHeader = [0xF0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00];

  async function readCurrentPatch(synth) {
    if (!navigator.requestMIDIAccess) throw new Error("nomidi");
    S.midi = S.midi || await navigator.requestMIDIAccess({ sysex: true });
    const pick = ports => [...ports.values()].filter(p => p.state === "connected" && /circuit\s*tracks/i.test(p.name || "") && !/(?:\bmidi|\bport)\s*[23]\b/i.test(p.name || ""));
    const ins = pick(S.midi.inputs), outs = pick(S.midi.outputs);
    if (ins.length !== 1 || outs.length !== 1) throw new Error("noport");
    const input = ins[0], output = outs[0];
    await Promise.all([input.open(), output.open()]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { input.removeEventListener("midimessage", receive); reject(new Error("timeout")); }, 2500);
      function receive(event) {
        const b = event.data;
        if (b.length !== 350 || !dumpHeader.every((v, i) => i === 6 || b[i] === v) || b[7] !== synth || b[349] !== 0xF7) return;
        clearTimeout(timer); input.removeEventListener("midimessage", receive); resolve(Uint8Array.from(b));
      }
      input.addEventListener("midimessage", receive);
      output.send([0xF0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, synth, 0xF7]);
    });
  }

  function download(name, mime, data) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = el("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportPatch() {
    if (S.busy) { status(T("status_busy")); return; }
    if (S.ui.channel !== 1 && S.ui.channel !== 2) { status(T("status_save_channel")); return; }
    S.busy = true; setBusy(true);
    try {
      status(T("status_saving"));
      const bytes = await readCurrentPatch(S.ui.channel - 1);
      const info = S.last || { kind: "random", type: S.ui.type, intensity: S.ui.intensity, locks: {}, seed: 0, donors: [], values: {} };
      S.ui.counter = (S.ui.counter || 0) + 1; save();
      const label = `${info.kind === "mutate" ? "Mut" : "Rnd"} ${info.type} ${info.intensity} #${String(S.ui.counter).padStart(2, "0")}`.slice(0, 16);
      bytes[7] = 0x00; // same location byte as a patch downloaded from Components
      for (let i = 0; i < 16; i++) bytes[9 + i] = i < label.length ? label.charCodeAt(i) : 0x20;
      const base = label.replace(/[^A-Za-z0-9#]+/g, "_");
      download(base + ".syx", "application/octet-stream", bytes);
      if (S.ui.debug) {
        const editor = await readAll();
        const report = { tool: "ct-random 0.7.6", name: label, kind: info.kind, type: info.type, intensity: info.intensity, locks: info.locks, seed: info.seed,
          synth: S.ui.channel, donors: info.donors, generated: info.values, editorAtExport: editor.cur, patchBytes: Array.from(bytes) };
        download(base + ".json", "application/json", JSON.stringify(report, null, 1));
      }
      status(T("status_saved", { name: label }));
    } catch (e) { status(e.message === "timeout" ? T("status_save_timeout") : errorText(e)); }
    finally { S.busy = false; setBusy(false); }
  }

  // ---------------------------------------------------------------- open .syx (decode a patch file into editor values)
  // Byte offsets inside the 340 data bytes (after the 9-byte header), verified against exports read back from the editor.
  // Discrete controls use "#n" = option / radio index. Macros, LFO phase and the patch name are not editor knobs handled here.
  const isPatchFile = b => b.length === 350 && b[0] === 0xF0 && b[1] === 0x00 && b[2] === 0x20 && b[3] === 0x29 && b[4] === 0x01 && b[5] === 0x64 && b[349] === 0xF7;

  function decodePatch(bytes) {
    const d = bytes.subarray(9, 349), v = {}, idx = n => "#" + n;
    v["voice.mode"] = idx(Math.min(d[32], 2)); v["voice.port"] = d[33]; v["voice.preglide"] = d[34] - 64; v["voice.octave"] = d[35] - 64;
    [36, 45].forEach((b, i) => {
      const o = `osc${i + 1}.`;
      v[o + "wave"] = idx(d[b]); v[o + "interp"] = d[b + 1]; v[o + "index"] = d[b + 2] - 64; v[o + "vsync"] = d[b + 3];
      v[o + "density"] = d[b + 4]; v[o + "dtune"] = d[b + 5]; v[o + "semi"] = d[b + 6] - 64; v[o + "cents"] = d[b + 7] - 64;
    });
    v["mix.osc1"] = d[54]; v["mix.osc2"] = d[55]; v["mix.ring"] = d[56]; v["mix.noise"] = d[57]; v["mix.pre"] = d[58] - 64; v["mix.post"] = d[59] - 64;
    v["flt.route"] = idx(Math.min(d[60], 2)); v["flt.drive"] = d[61]; v["flt.drivetype"] = idx(d[62]); v["flt.type"] = idx(d[63]);
    v["flt.freq"] = d[64]; v["flt.key"] = d[65]; v["flt.res"] = d[66]; v["flt.q"] = d[67]; v["flt.env2"] = d[68] - 64;
    [69, 74, 79].forEach((b, i) => {
      const e = `env${i + 1}.`;
      if (i < 2) v[e + "vel"] = d[b] - 64; else v["env3.delay"] = d[b];
      v[e + "a"] = d[b + 1]; v[e + "d"] = d[b + 2]; v[e + "s"] = d[b + 3]; v[e + "r"] = d[b + 4];
    });
    [84, 92].forEach((b, i) => {
      const l = `lfo${i + 1}.`;
      v[l + "shape"] = idx(d[b]); v[l + "slew"] = d[b + 2]; v[l + "delay"] = d[b + 3]; v[l + "rate"] = d[b + 5];
      v[l + "keysync"] = idx((d[b + 7] >> 1) & 1); v[l + "oneshot"] = !!(d[b + 7] & 1);
    });
    v["dist.level"] = d[100]; v["fx.clevel"] = d[102];
    v["eq.lf"] = d[105]; v["eq.lg"] = d[106] - 64; v["eq.mf"] = d[107]; v["eq.mg"] = d[108] - 64; v["eq.hf"] = d[109]; v["eq.hg"] = d[110] - 64;
    v["dist.type"] = idx(d[116]); v["dist.comp"] = d[117];
    v["fx.ctype"] = idx(d[118] ? 1 : 0); v["fx.crate"] = d[119]; v["fx.cfb"] = d[121] - 64; v["fx.cdepth"] = d[122]; v["fx.cdelay"] = d[123];
    const src = n => idx(n === 0 ? 0 : Math.max(0, n - 3));
    for (let i = 0; i < MX_SLOTS; i++) {
      const b = 124 + 4 * i;
      v[`mx.${i}.src1`] = src(d[b]); v[`mx.${i}.src2`] = src(d[b + 1]); v[`mx.${i}.depth`] = d[b + 2] - 64; v[`mx.${i}.dest`] = idx(d[b + 3]);
    }
    return v;
  }

  function pickFiles(multiple) {
    return new Promise(resolve => {
      const input = el("input", { type: "file", accept: ".syx", multiple });
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  async function openSyx() {
    if (S.busy) { status(T("status_busy")); return; }
    const [file] = await pickFiles(false);
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPatchFile(bytes)) { status(T("status_bad_syx", { name: file.name })); return; }
    S.busy = true; setBusy(true);
    try {
      const { cur } = await readAll();
      S.undo.push(cur); if (S.undo.length > HISTORY_MAX) S.undo.shift();
      const values = decodePatch(bytes);
      status(T("status_applying", { n: Object.keys(values).length }));
      const changed = await applyState(values);
      S.octave = values["voice.octave"];
      S.last = { kind: "open", type: S.ui.type, intensity: 0, locks: {}, seed: 0, donors: [{ sections: "all", name: file.name, pack: "" }], values };
      status(T("status_opened", { name: file.name, n: changed }));
      if (S.ui.autoplay && !S.looping) await playPhrase(S.octave).catch(e => status(errorText(e)));
    } catch (e) { status(T("status_error", { msg: e.message })); }
    finally { S.busy = false; setBusy(false); }
  }

  // ---------------------------------------------------------------- audio recording (WAV) from an audio interface input
  // The CT sends no audio over USB, so its line out must go into an audio interface. Browser processing is switched off
  // (echo cancellation, noise suppression, auto gain), otherwise levels would not be comparable between recordings.
  const TAIL_MS = 1500;

  async function listInputs() {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(t => t.stop());
    } catch { /* labels stay empty without permission */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === "audioinput");
  }

  async function openInput() {
    if (S.audio) return S.audio;
    const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 };
    if (S.ui.inputId) constraints.deviceId = { exact: S.ui.inputId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    const mute = ctx.createGain(); mute.gain.value = 0;
    source.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    const audio = { ctx, stream, proc, chunks: null, channels: stream.getAudioTracks()[0].getSettings().channelCount || 1 };
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      audio.level = Math.sqrt(sum / d.length);
      if (!audio.chunks) return;
      audio.chunks.push([new Float32Array(e.inputBuffer.getChannelData(0)), new Float32Array(e.inputBuffer.getChannelData(e.inputBuffer.numberOfChannels > 1 ? 1 : 0))]);
    };
    S.audio = audio;
    return audio;
  }

  function closeInput() {
    if (!S.audio) return;
    S.audio.stream.getTracks().forEach(t => t.stop());
    S.audio.ctx.close();
    S.audio = null;
  }

  // Plays the phrase and records it plus a tail. Returns { sampleRate, left, right }.
  async function recordPhrase(octave) {
    const audio = await openInput();
    if (audio.ctx.state !== "running") await audio.ctx.resume();
    audio.chunks = [];
    await sleep(150);
    await playPhrase(octave);
    await sleep(TAIL_MS);
    const chunks = audio.chunks; audio.chunks = null;
    const n = chunks.reduce((a, c) => a + c[0].length, 0);
    const left = new Float32Array(n), right = new Float32Array(n);
    let pos = 0;
    for (const [l, r] of chunks) { left.set(l, pos); right.set(r, pos); pos += l.length; }
    return { sampleRate: audio.ctx.sampleRate, left, right, deviceChannels: audio.channels };
  }

  function encodeWav({ sampleRate, left, right }) {
    const n = left.length, buffer = new ArrayBuffer(44 + n * 4), view = new DataView(buffer);
    const text = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, 36 + n * 4, true); text(8, "WAVE"); text(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++, o += 4) {
      view.setInt16(o, Math.round(clamp(left[i], -1, 1) * 32767), true);
      view.setInt16(o + 2, Math.round(clamp(right[i], -1, 1) * 32767), true);
    }
    return new Uint8Array(buffer);
  }

  // Level and colour of a recording: peak, RMS, clipped samples, L/R correlation and spectral centroid (brightness).
  function analyse({ sampleRate, left, right }) {
    const db = x => x > 0 ? Math.round(200 * Math.log10(x)) / 10 : -120;
    let peak = 0, sum = 0, clips = 0, lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < left.length; i++) {
      const l = left[i], r = right[i], m = Math.max(Math.abs(l), Math.abs(r));
      if (m > peak) peak = m;
      if (m >= 0.999) clips++;
      sum += (l * l + r * r) / 2; lr += l * r; ll += l * l; rr += r * r;
    }
    const rms = Math.sqrt(sum / Math.max(1, left.length));
    const win = Math.max(1, Math.round(sampleRate * 0.05));
    let maxWin = 0;
    for (let start = 0; start + win <= left.length; start += win >> 1) {
      let e = 0;
      for (let i = start; i < start + win; i++) e += (left[i] * left[i] + right[i] * right[i]) / 2;
      maxWin = Math.max(maxWin, Math.sqrt(e / win));
    }
    const size = 2048, re = new Float64Array(size), im = new Float64Array(size);
    let num = 0, den = 0;
    for (let start = 0; start + size <= left.length; start += size * 4) {
      for (let i = 0; i < size; i++) { re[i] = (left[start + i] + right[start + i]) * 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / size)); im[i] = 0; }
      fft(re, im);
      for (let k = 1; k < size / 2; k++) { const mag = Math.hypot(re[k], im[k]); num += mag * k * sampleRate / size; den += mag; }
    }
    return {
      peak_db: db(peak), rms_db: db(rms), max_db: db(maxWin), clipped: clips, silent: db(maxWin) < S.data.levels.silent_db ? 1 : 0, dev_db: Math.round(10 * (db(maxWin) - S.data.levels.target_db)) / 10,
      lr_corr: ll && rr ? Math.round(1000 * lr / Math.sqrt(ll * rr)) / 1000 : 1, centroid_hz: den ? Math.round(num / den) : 0
    };
  }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // Minimal ZIP writer (stored, no compression) so a batch is one download.
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = data => { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const { name, data } of files) {
      const nameBytes = enc.encode(name), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      central.push(new Uint8Array(entry.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const size = central.reduce((a, c) => a + c.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  const ANALYSIS_COLUMNS = ["file", "patch_name", "octave", "max_db", "dev_db", "peak_db", "rms_db", "clipped", "silent", "lr_corr", "centroid_hz", "sample_rate", "device_channels"];
  const csvRow = values => values.map(x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(",");
  const patchName = bytes => String.fromCharCode(...bytes.subarray(9, 25)).replace(/[^\x20-\x7E]/g, "").trim();

  // Record the sound currently in the editor / CT.
  async function recordCurrent() {
    if (S.busy) { status(T("status_busy")); return; }
    S.busy = true; S.recording = true; setBusy(true);
    try {
      stopLoop();
      status(T("status_recording"));
      const rec = await recordPhrase(S.octave ?? 0);
      const a = analyse(rec);
      const base = (S.last ? `${S.last.kind}_${S.last.type}_${S.last.intensity}` : "sound") + "_" + new Date().toISOString().slice(11, 19).replace(/:/g, "");
      download(base + ".wav", "audio/wav", encodeWav(rec));
      status(T("status_recorded", { name: base, rms: a.rms_db, peak: a.peak_db }));
    } catch (e) { status(audioError(e)); }
    finally { S.busy = false; S.recording = false; setBusy(false); }
  }

  // Batch: for each chosen .syx file send it to the CT (Replace Current Patch), play, record. The original patch is put back.
  // Output: one ZIP with a WAV per file (same base name) and analysis.csv.
  async function recordBatch() {
    if (S.busy) { status(T("status_busy")); return; }
    if (S.ui.channel !== 1 && S.ui.channel !== 2) { status(T("status_save_channel")); return; }
    const files = (await pickFiles(true)).sort((a, b) => a.name.localeCompare(b.name));
    if (!files.length) return;
    S.busy = true; S.recording = true; S.recordAbort = false; setBusy(true);
    const synth = S.ui.channel - 1, out = [], rows = [csvRow(ANALYSIS_COLUMNS)];
    let original = null;
    try {
      stopLoop();
      const output = await getOutput();
      original = await readCurrentPatch(synth);
      await openInput();
      for (let i = 0; i < files.length && !S.recordAbort; i++) {
        const file = files[i], bytes = new Uint8Array(await file.arrayBuffer()), base = file.name.replace(/\.syx$/i, "");
        if (!isPatchFile(bytes)) { rows.push(csvRow([file.name, "", "", "", "", "", "", "", "", "", "", "", ""])); continue; }
        status(T("status_batch", { i: i + 1, n: files.length, name: base }));
        const send = Uint8Array.from(bytes); send[6] = 0x00; send[7] = synth; send[8] = 0x00;
        output.send(send);
        await sleep(250);
        const octave = bytes[9 + 35] - 64;
        const rec = await recordPhrase(octave);
        const a = analyse(rec);
        out.push({ name: base + ".wav", data: encodeWav(rec) });
        rows.push(csvRow([file.name, patchName(bytes), octave, a.max_db, a.dev_db, a.peak_db, a.rms_db, a.clipped, a.silent, a.lr_corr, a.centroid_hz, rec.sampleRate, rec.deviceChannels]));
        await waitForSilence(output);
      }
      out.push({ name: "analysis.csv", data: new TextEncoder().encode(rows.join("\n") + "\n") });
      const url = URL.createObjectURL(makeZip(out));
      const link = el("a", { href: url, download: `ct-wav-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status(T("status_batch_done", { n: out.length - 1 }));
    } catch (e) { status(e.message === "timeout" ? T("status_save_timeout") : audioError(e)); }
    finally {
      if (original) { try { (await getOutput()).send(original); } catch { /* the CT may be gone */ } }
      S.busy = false; S.recording = false; setBusy(false);
    }
  }

  // All notes off / all sound off on the synth channel, then wait until the input is quiet (levels.csv tail_db, max 4 s).
  async function waitForSilence(output) {
    const ch = clamp(+S.ui.channel || 1, 1, 16) - 1;
    try { output.send([0xB0 | ch, 123, 0]); output.send([0xB0 | ch, 120, 0]); } catch { /* port gone */ }
    const limit = Math.pow(10, S.data.levels.tail_db / 20), end = Date.now() + 4000;
    await sleep(200);
    while (Date.now() < end && (S.audio?.level ?? 0) > limit) await sleep(100);
    await sleep(150);
  }

  const audioError = e => e && (e.name === "NotAllowedError" || e.name === "NotFoundError" || e.name === "OverconstrainedError") ? T("status_no_audio") : errorText(e);

  async function fillInputs() {
    if (!ui) return;
    const list = await listInputs().catch(() => []);
    ui.input.textContent = "";
    ui.input.append(el("option", { value: "", textContent: T("input_default") }));
    for (const d of list) ui.input.append(el("option", { value: d.deviceId, textContent: d.label || d.deviceId.slice(0, 8) }));
    for (const o of ui.input.options) o.style.cssText = "background:#1b1f3a;color:#fff;";
    ui.input.value = list.some(d => d.deviceId === S.ui.inputId) ? S.ui.inputId : "";
  }

  // ---------------------------------------------------------------- storage
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ui: S.ui, history: S.history })); } catch { /* storage may be unavailable */ }
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (raw) { Object.assign(S.ui, raw.ui || {}); S.history = raw.history || []; }
    } catch { /* ignore a broken store */ }
    if (!S.ui.lang) S.ui.lang = /^sk|^cs/i.test(navigator.language || "") ? "sk" : "en";
    if (!S.ui.locks) S.ui.locks = {};
    if (!S.ui.loopPause) S.ui.loopPause = 5;
  }

  // ---------------------------------------------------------------- UI
  let ui = null;
  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const kid of kids) node.append(kid);
    return node;
  };
  const fieldStyle = "background:#1b1f3a;color:#fff;border:1px solid #7796ff;border-radius:3px;padding:2px;";
  const btnStyle = "padding:6px 8px;background:#2c4bc6;color:#fff;border:1px solid #7796ff;border-radius:3px;cursor:pointer;font-size:12px;";

  function status(text) { if (ui) ui.status.textContent = text; }
  function setBusy(on) { if (ui) for (const b of ui.buttons) b.disabled = on; }

  function buildPanel() {
    ui = { buttons: [] };
    ui.root = el("div", { id: PANEL_ID });
    ui.root.style.cssText = "position:fixed;right:12px;top:104px;z-index:99999;width:290px;max-height:calc(100vh - 120px);color-scheme:dark;overflow:auto;background:rgba(18,20,34,.97);color:#e8eaf6;border:1px solid #5b6bd6;border-radius:6px;font:12px/1.4 sans-serif;padding:8px;box-shadow:0 4px 18px rgba(0,0,0,.5);";
    ui.title = el("strong"); ui.collapse = el("button", { onclick: () => { S.ui.collapsed = !S.ui.collapsed; save(); render(); } }); ui.collapse.style.cssText = btnStyle;
    ui.langBtn = el("button", { onclick: () => { S.ui.lang = S.ui.lang === "sk" ? "en" : "sk"; save(); render(); } }); ui.langBtn.style.cssText = btnStyle;
    const head = el("div"); head.style.cssText = "display:flex;gap:6px;align-items:center;justify-content:space-between;";
    head.append(ui.title, el("span", {}, ui.langBtn, " ", ui.collapse));
    ui.body = el("div");
    ui.typeLabel = el("label"); ui.type = el("select", { onchange: () => { S.ui.type = ui.type.value; save(); } });
    for (const t of ["any", "bass", "lead", "pad", "pluck", "keys", "fx"]) ui.type.append(el("option", { value: t }));
    ui.intLabel = el("label"); ui.int = el("input", { type: "range", min: 0, max: 100, oninput: () => { S.ui.intensity = +ui.int.value; ui.intVal.textContent = ui.int.value; save(); } }); ui.intVal = el("span");
    ui.bRandom = el("button", { onclick: () => run("random") }); ui.bMutate = el("button", { onclick: () => run("mutate") });
    ui.bUndo = el("button", { onclick: () => undoLast() }); ui.bStop = el("button", { onclick: () => { stopLoop(); S.recordAbort = true; status(T("status_idle")); } });
    for (const b of [ui.bRandom, ui.bMutate, ui.bUndo]) { b.style.cssText = btnStyle; ui.buttons.push(b); }
    ui.bStop.style.cssText = btnStyle;
    const buttons = el("div"); buttons.style.cssText = "display:flex;gap:6px;margin:6px 0;"; buttons.append(ui.bRandom, ui.bMutate, ui.bUndo, ui.bStop);
    ui.bSave = el("button", { onclick: () => exportPatch() }); ui.bSave.style.cssText = btnStyle; ui.buttons.push(ui.bSave);
    ui.debug = el("input", { type: "checkbox", onchange: () => { S.ui.debug = ui.debug.checked; save(); } }); ui.debugLabel = el("label");
    ui.bOpen = el("button", { onclick: () => openSyx() }); ui.bOpen.style.cssText = btnStyle; ui.buttons.push(ui.bOpen);
    const saveRow = el("div"); saveRow.style.cssText = "display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap;"; saveRow.append(ui.bOpen, ui.bSave, ui.debug, ui.debugLabel);
    ui.bPlay = el("button", { onclick: () => playNow() }); ui.bPlay.style.cssText = btnStyle;
    ui.bLoop = el("button", { onclick: () => toggleLoop() }); ui.bLoop.style.cssText = btnStyle;
    ui.pause = el("input", { type: "range", min: 1, max: 9, step: 1, oninput: () => { S.ui.loopPause = +ui.pause.value; ui.pauseVal.textContent = ui.pause.value + " s"; save(); } });
    ui.pause.style.cssText = "width:80px;accent-color:#7796ff;"; ui.pauseVal = el("span");
    const playRow = el("div"); playRow.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap;"; playRow.append(ui.bPlay, ui.bLoop, ui.pause, ui.pauseVal);
    ui.recTitle = el("div"); ui.recTitle.style.cssText = "margin-top:8px;font-weight:bold;";
    ui.inputLabel = el("label");
    ui.input = el("select", { onchange: () => { S.ui.inputId = ui.input.value; save(); closeInput(); } });
    ui.input.style.cssText = fieldStyle + "max-width:170px;";
    ui.bInputs = el("button", { onclick: () => fillInputs() }); ui.bInputs.style.cssText = btnStyle;
    ui.bRec = el("button", { onclick: () => recordCurrent() }); ui.bRec.style.cssText = btnStyle; ui.buttons.push(ui.bRec);
    ui.bBatch = el("button", { onclick: () => recordBatch() }); ui.bBatch.style.cssText = btnStyle; ui.buttons.push(ui.bBatch);
    ui.check = el("input", { type: "checkbox", onchange: () => { S.ui.levelCheck = ui.check.checked; save(); } }); ui.checkLabel = el("label");
    const recRow = el("div"); recRow.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap;"; recRow.append(ui.bRec, ui.bBatch);
    ui.locksTitle = el("div"); ui.lockBoxes = {};
    const locks = el("div"); locks.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin:4px 0 8px;";
    for (const g of GROUPS) {
      const box = el("input", { type: "checkbox", onchange: () => { S.ui.locks[g] = box.checked; save(); } });
      const label = el("label"); label.append(box, " ", el("span")); ui.lockBoxes[g] = { box, label }; locks.append(label);
    }
    ui.auto = el("input", { type: "checkbox", onchange: () => { S.ui.autoplay = ui.auto.checked; save(); } }); ui.autoLabel = el("label");
    ui.phrase = el("select", { onchange: () => { S.ui.phrase = ui.phrase.value; save(); } });
    for (const t of ["auto", "single", "melody", "chords"]) ui.phrase.append(el("option", { value: t }));
    ui.phraseLabel = el("label");
    ui.channel = el("select", { onchange: () => { S.ui.channel = +ui.channel.value; save(); } });
    for (let c = 1; c <= 16; c++) ui.channel.append(el("option", { value: c, textContent: c }));
    ui.channelLabel = el("label");
    ui.status = el("div"); ui.status.style.cssText = "margin:6px 0;min-height:16px;color:#9fb3ff;overflow-wrap:anywhere;";
    ui.histTitle = el("div"); ui.hist = el("div");
    const row = (label, ...controls) => { const r = el("div"); r.style.cssText = "margin:4px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;"; r.append(label, ...controls); return r; };
    ui.body.append(row(ui.typeLabel, ui.type), row(ui.intLabel, ui.int, ui.intVal), buttons, saveRow, ui.locksTitle, locks,
      row(ui.auto, ui.autoLabel), playRow, row(ui.phraseLabel, ui.phrase), row(ui.channelLabel, ui.channel),
      ui.recTitle, row(ui.inputLabel, ui.input, ui.bInputs), row(ui.check, ui.checkLabel), recRow, ui.status, ui.histTitle, ui.hist);
    for (const sel of [ui.type, ui.phrase, ui.channel]) { sel.style.cssText = fieldStyle; for (const o of sel.options) o.style.cssText = "background:#1b1f3a;color:#fff;"; }
    ui.int.style.accentColor = "#7796ff";
    ui.root.append(head, ui.body);
    document.body.append(ui.root);
    render();
  }

  function render() {
    if (!ui || !S.data) return;
    ui.title.textContent = T("panel_title");
    ui.collapse.textContent = S.ui.collapsed ? T("collapse_open") : T("collapse_close");
    ui.langBtn.textContent = T("lang_toggle");
    ui.body.style.display = S.ui.collapsed ? "none" : "block";
    ui.typeLabel.textContent = T("type_label");
    [...ui.type.options].forEach(o => { o.textContent = T("type_" + o.value); });
    ui.type.value = S.ui.type;
    ui.intLabel.textContent = T("intensity"); ui.int.value = S.ui.intensity; ui.intVal.textContent = S.ui.intensity;
    ui.bSave.textContent = T("btn_save"); ui.bSave.title = T("tip_save"); ui.debug.checked = !!S.ui.debug; ui.debugLabel.textContent = T("debug_json"); ui.bRandom.title = T("tip_random"); ui.bMutate.title = T("tip_mutate"); ui.bRandom.textContent = T("btn_random"); ui.bMutate.textContent = T("btn_mutate"); ui.bUndo.textContent = T("btn_undo"); ui.bStop.textContent = T("btn_stop");
    ui.locksTitle.textContent = T("locks");
    for (const g of GROUPS) { ui.lockBoxes[g].box.checked = !!S.ui.locks[g]; ui.lockBoxes[g].label.lastChild.textContent = T("lock_" + g); }
    ui.auto.checked = S.ui.autoplay; ui.autoLabel.textContent = T("autoplay");
    ui.phraseLabel.textContent = T("phrase_label");
    [...ui.phrase.options].forEach(o => { o.textContent = T("phrase_" + o.value); }); ui.phrase.value = S.ui.phrase;
    ui.channelLabel.textContent = T("channel"); ui.channel.value = S.ui.channel;
    ui.bOpen.textContent = T("btn_open"); ui.bOpen.title = T("tip_open");
    ui.bPlay.textContent = T("btn_play"); ui.bLoop.textContent = S.looping ? T("btn_loop_stop") : T("btn_loop");
    ui.bLoop.style.background = S.looping ? "#8a2cc6" : "#2c4bc6"; ui.bLoop.title = T("tip_loop");
    ui.pause.value = S.ui.loopPause; ui.pauseVal.textContent = S.ui.loopPause + " s";
    ui.recTitle.textContent = T("rec_title"); ui.inputLabel.textContent = T("input_label");
    ui.bInputs.textContent = T("btn_inputs"); ui.bInputs.title = T("tip_inputs");
    if (!ui.input.options.length) ui.input.append(el("option", { value: S.ui.inputId || "", textContent: T("input_default") }));
    ui.check.checked = !!S.ui.levelCheck; ui.checkLabel.textContent = T("level_check"); ui.checkLabel.title = T("tip_level_check");
    ui.bRec.textContent = T("btn_rec"); ui.bRec.title = T("tip_rec");
    ui.bBatch.textContent = T("btn_batch"); ui.bBatch.title = T("tip_batch");
    if (!ui.status.textContent) ui.status.textContent = T("status_idle");
    renderHistory();
  }

  function renderHistory() {
    if (!ui || !S.data) return;
    ui.histTitle.textContent = T("history", { n: HISTORY_MAX });
    ui.hist.textContent = "";
    if (!S.history.length) { ui.hist.textContent = T("hist_empty"); return; }
    for (const h of S.history) {
      const time = new Date(h.id).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const apply = el("button", { textContent: "▶ " + T("kind_" + h.kind) + " · " + T("type_" + h.type) + " · " + time, title: T("hist_apply"), onclick: () => restoreEntry(h, false) });
      apply.style.cssText = btnStyle + "flex:1;text-align:left;";
      const star = el("button", { textContent: h.star ? "★" : "☆", title: T("hist_star"), onclick: () => { h.star = !h.star; trimHistory(); save(); renderHistory(); } });
      star.style.cssText = btnStyle;
      const row = el("div"); row.style.cssText = "display:flex;gap:4px;margin:2px 0;"; row.append(apply, star);
      ui.hist.append(row);
    }
  }

  function syncPanel() {
    const wanted = !!S.data && inEditor();
    if (wanted && !document.getElementById(PANEL_ID)) buildPanel();
    if (!wanted && document.getElementById(PANEL_ID)) { document.getElementById(PANEL_ID).remove(); ui = null; }
  }

  // ---------------------------------------------------------------- start
  function start(files) {
    if (S.data) return;
    S.data = prepareData(files);
    load();
    setInterval(syncPanel, 800);
    syncPanel();
  }

  window.__ctRandom = { decodePatch, openSyx, analyse, encodeWav, makeZip, toggleLoop, exportPatch, plan: { planRandom, planMutate, planMatrix, applyGuards, PARAMS }, run, undoLast, readAll, applyState, playPhrase, stopPlayback, state: S, start };

  if (window.CTRND_DATA) start(window.CTRND_DATA);
  else {
    window.addEventListener("message", event => {
      if (event.source === window && event.data && event.data.source === "ctrnd-loader" && event.data.type === "data") start(event.data.files);
    });
    window.postMessage({ source: "ctrnd-main", type: "need-data" }, window.location.origin);
  }
})();
