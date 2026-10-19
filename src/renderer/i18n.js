// Dauntless Forever - launcher
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// i18n.js (window) - the launcher's own language (Settings > Launcher language). Only the launcher: the game has its
// own language setting (Settings > Game language), which this does not touch.
//
//   - One dictionary per language (i18n-es.js, i18n-fr.js, i18n-de.js), keyed by the exact English text. English is
//     the text in the code itself, so it needs no dictionary. A string missing from a dictionary shows in English.
//   - t('Copy your Slayer from {from} into {to}?', { from, to }) for text built in JS. {name} placeholders are filled
//     in after the lookup, so a translation can put them in another order.
//   - tm(message) for messages that arrive already written (errors from the main process): the exact text first, then
//     the dictionary's {placeholder} strings as patterns. Anything else (the friends server's own messages) stays as it is.
//   - The static page (index.html) is translated once at start and once per language change: text nodes and the
//     placeholder / title / aria-label / alt / data-empty attributes. Nothing watches the page in between; the JS that
//     draws the pages calls t() itself and redraws on the 'df-lang' event.
//   - Adding a language: a new i18n-xx.js like the others (with its '@name') and a <script> line for it in index.html,
//     before this file. Settings lists it and the main process picks it up by itself.
//   - Every file stays plain ASCII (tools/check-ascii.js): accents are \u escapes in the dictionaries.
'use strict';
(function () {
  const DICTS = window.DF_I18N = window.DF_I18N || {};
  // [code, name in its own language]: English, then every dictionary loaded before this file (its '@name' entry)
  const LANGS = [['en', 'English']].concat(Object.keys(DICTS).map(c => [c, (DICTS[c] && DICTS[c]['@name']) || c]));
  const KEY = 'df-ui-lang';
  const store = { get() { try { return localStorage.getItem(KEY); } catch { return null; } }, set(v) { try { localStorage.setItem(KEY, v); } catch {} } };
  const known = (c) => LANGS.some(l => l[0] === c);
  let lang = known(store.get()) ? store.get() : 'en';
  const has = Object.prototype.hasOwnProperty;

  function fill(s, p) { return p ? s.replace(/\{(\w+)\}/g, (m, k) => (has.call(p, k) && p[k] !== undefined && p[k] !== null ? String(p[k]) : m)) : s; }
  function look(s, code) { const d = code !== 'en' && DICTS[code]; return d && has.call(d, s) && typeof d[s] === 'string' && d[s] !== '' ? d[s] : null; }
  function t(s, p) {
    if (s === undefined || s === null) return '';
    s = String(s);
    const hit = look(s, lang);
    return fill(hit === null ? s : hit, p);
  }

  // messages that come in already written: exact text, then the {placeholder} strings as patterns
  const patterns = {};
  function patternsFor(code) {
    if (patterns[code]) return patterns[code];
    const list = [];
    for (const en of Object.keys(DICTS[code] || {})) {
      if (en.indexOf('{') < 0) continue;
      const names = [];
      const src = en.split(/(\{\w+\})/).map(part => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) { names.push(m[1]); return '([\\s\\S]+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      if (!names.length || src.replace(/\(\[\\s\\S\]\+\?\)/g, '').length < 7) continue;   // too loose to be a pattern
      list.push({ en, names, re: new RegExp('^' + src + '$') });
    }
    list.sort((a, b) => b.en.length - a.en.length);
    return (patterns[code] = list);
  }
  function tm(s) {
    if (s === undefined || s === null) return '';
    s = String(s);
    if (lang === 'en' || !DICTS[lang]) return s;
    const exact = look(s, lang); if (exact !== null) return exact;
    const trimmed = s.trim(); if (trimmed !== s) { const e2 = look(trimmed, lang); if (e2 !== null) return s.replace(trimmed, e2); }
    for (const p of patternsFor(lang)) {
      const m = p.re.exec(s); if (!m) continue;
      const vals = {}; p.names.forEach((n, i) => { vals[n] = tm(m[i + 1]); });
      return fill(look(p.en, lang), vals);
    }
    return s;
  }

  // ---------------------------------------------------------------- the static page
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-empty'];
  const textSeen = new WeakMap();   // text node -> { en, shown }
  const attrSeen = new WeakMap();   // element -> { attr: { en, shown } }
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  // what a text in the previous language was in English (only for text the launcher drew while it was shown)
  function reverseOf(code) {
    const r = new Map(); const d = DICTS[code];
    if (d) for (const en of Object.keys(d)) if (en[0] !== '@' && typeof d[en] === 'string' && d[en].indexOf('{') < 0) r.set(d[en], en);
    return r;
  }
  function translateText(value, en) {
    const key = norm(en); if (!key) return value;
    const hit = look(key, lang); const out = hit === null ? key : hit;
    const lead = /^\s*/.exec(value)[0], trail = /\s*$/.exec(value)[0];
    return lead + out + trail;
  }
  const skip = (node) => { const e = node.nodeType === 1 ? node : node.parentElement; return !e || !!e.closest('script, style, [data-i18n-skip]'); };
  function applyStatic(prevLang) {
    const rev = prevLang && prevLang !== 'en' ? reverseOf(prevLang) : null;
    const fromShown = (v) => { const k = norm(v); return rev && rev.has(k) ? rev.get(k) : v; };
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n);
    for (const n of nodes) {
      if (!n.nodeValue || !n.nodeValue.trim() || skip(n)) continue;
      let rec = textSeen.get(n);
      if (!rec || rec.shown !== n.nodeValue) rec = { en: rec ? fromShown(n.nodeValue) : (prevLang ? fromShown(n.nodeValue) : n.nodeValue) };
      const v = translateText(n.nodeValue, rec.en);
      if (v !== n.nodeValue) n.nodeValue = v;
      rec.shown = n.nodeValue; textSeen.set(n, rec);
    }
    for (const el of document.body.querySelectorAll('[' + ATTRS.join('],[') + ']')) {
      if (skip(el)) continue;
      const recs = attrSeen.get(el) || {};
      for (const a of ATTRS) {
        const cur = el.getAttribute(a); if (cur === null || !cur.trim()) continue;
        let rec = recs[a];
        if (!rec || rec.shown !== cur) rec = { en: rec || prevLang ? fromShown(cur) : cur };
        const v = translateText(cur, rec.en);
        if (v !== cur) el.setAttribute(a, v);
        rec.shown = v; recs[a] = rec;
      }
      attrSeen.set(el, recs);
    }
  }

  // ---------------------------------------------------------------- switching
  function set(code, opts) {
    if (!known(code)) code = 'en';
    const prev = lang;
    lang = code; store.set(code);
    document.documentElement.lang = code;
    if (opts && opts.save !== false && window.launcher && window.launcher.setUiLanguage) window.launcher.setUiLanguage(code).catch(() => {});
    if (prev === code) return false;
    applyStatic(prev);
    try { window.dispatchEvent(new CustomEvent('df-lang', { detail: { lang: code, prev } })); } catch {}
    return true;
  }

  window.t = t;
  window.tm = tm;
  window.I18N = { t, tm, set, lang: () => lang, languages: LANGS.slice(), translateStatic: () => applyStatic(null) };

  // first paint in the language last used (kept in this window's storage as well), then what launcher.json says
  document.documentElement.lang = lang;
  if (lang !== 'en') applyStatic(null);
  if (window.launcher && window.launcher.uiLanguage) {
    window.launcher.uiLanguage().then((code) => { if (known(code) && code !== lang) set(code, { save: false }); else if (!known(code) && lang !== 'en') window.launcher.setUiLanguage(lang).catch(() => {}); }).catch(() => {});
  }
})();
