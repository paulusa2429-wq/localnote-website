/* Proofaro Free Checker — in-browser Said vs Written engine.
   Pure logic, no network, no storage. Loadable in the browser (window.ProofaroChecker)
   and in Node (module.exports) so the accuracy test set runs against the same code.
   Pipeline: sentence-split -> extract facts -> lexical match -> compare -> flags. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProofaroChecker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- vocabulary ---------------- */
  var NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var NUMWORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|point|zero|and)';
  var MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };
  var MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
  var WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  var WD_RE = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)';
  var STOP = {};
  ('a an the and or but if then else when while of at by for with about into through after before between out on in to from up down over under again once here there all any both each few more most other some such no nor not only own same so than too very can will just should now i you he she it we they them his her its our their this that these those am is are was were be been being have has had having do does did doing would could shall may might must as also get got per via etc yes yeah okay ok right well let lets us').split(' ').forEach(function (w) { STOP[w] = 1; });
  var NAME_STOP = {};
  ('The This That It We You He She They There Here What When Where Who How Yes No Thanks Thank Hi Hello Dear Best Regards Also And But So If In On At For With After Before Please Note One Two Three Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Speaker Proofaro Google Zoom Microsoft Apple Amazon Slack Gmail Outlook Word Excel Powerpoint Quickbooks Salesforce Hubspot').split(' ').forEach(function (w) { NAME_STOP[w] = 1; });
  var COUNT_ADJ = { business: 1, working: 1, calendar: 1, full: 1, half: 1, additional: 1, extra: 1, more: 1, total: 1, initial: 1, final: 1, separate: 1, dedicated: 1, quarterly: 1, monthly: 1, weekly: 1, annual: 1, yearly: 1, free: 1, new: 1, signed: 1, revised: 1, updated: 1 };

  /* ---------------- helpers ---------------- */
  function esc(s) { return s; } // engine works on raw text; the page escapes for HTML
  function wordVal(t) {
    var ws = t.toLowerCase().replace(/-/g, ' ').split(/\s+/), tot = 0, cur = 0, seen = false, frac = -1, fscale = 1;
    function flushFrac() { if (frac >= 0) { cur += frac; frac = -1; fscale = 1; } }
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w === 'and' || w === 'dollars' || w === 'dollar' || w === 'usd') continue;
      if (w === 'a' || w === 'an') { if (!cur && frac < 0) cur = 1; continue; }
      if (w === 'point') { if (frac < 0 && seen) { frac = 0; fscale = 1; } continue; }
      if (frac >= 0) {
        if (NUMW[w] !== undefined && NUMW[w] <= 9) { fscale *= 10; frac += NUMW[w] / fscale; seen = true; continue; }
        flushFrac();
      }
      if (NUMW[w] !== undefined) { cur += NUMW[w]; seen = true; continue; }
      if (w === 'hundred') { cur = (cur || 1) * 100; seen = true; continue; }
      if (w === 'dozen') { cur = (cur || 1) * 12; seen = true; continue; }
      if (w === 'thousand') { tot += (cur || 1) * 1000; cur = 0; seen = true; continue; }
      if (w === 'million') { tot += (cur || 1) * 1000000; cur = 0; seen = true; continue; }
      if (w === 'billion') { tot += (cur || 1) * 1000000000; cur = 0; seen = true; continue; }
    }
    flushFrac();
    return seen ? tot + cur : null;
  }
  function stem(w) {
    if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 4 && /ly$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  function tokens(text) {
    var out = {}, raw = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/);
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i].replace(/^[-']+|[-']+$/g, '');
      if (!w || STOP[w] || NUMW[w] !== undefined || w === 'hundred' || w === 'thousand' || w === 'million' || /^\d/.test(w)) continue;
      out[stem(w)] = 1;
    }
    return out;
  }
  function normNoun(w) {
    var n = w.toLowerCase();
    if (n.length > 3 && /ies$/.test(n)) n = n.slice(0, -3) + 'y';
    else if (n.length > 3 && /s$/.test(n) && !/ss$|us$/.test(n)) n = n.slice(0, -1);
    return n;
  }

  /* ---------------- value formatting: a Copy fix adopts the DRAFT's format ---------------- */
  var CUR_SYM = { USD: '$', EUR: '€', GBP: '£' };
  var CUR_WORD = { USD: 'dollars', EUR: 'euros', GBP: 'pounds' };
  function fmtGrouped(v, dec) {
    var neg = v < 0; if (neg) v = -v;
    var str = dec ? v.toFixed(dec) : String(Math.round(v * 100) / 100);
    var parts = str.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }
  var NW_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var NW_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numWords(v) {
    if (v === 0) return 'zero';
    var neg = v < 0; if (neg) v = -v;
    function under1000(n) {
      var out = [];
      if (n >= 100) { out.push(NW_ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
      if (n >= 20) { out.push(NW_TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + NW_ONES[n % 10] : '')); }
      else if (n > 0) out.push(NW_ONES[n]);
      return out.join(' ');
    }
    if (Math.floor(v) !== v) {
      var ip = Math.floor(v), fs = (Math.round((v - ip) * 10000) / 10000).toString().split('.')[1] || '';
      var digs = fs.split('').map(function (ch) { return NW_ONES[+ch]; }).join(' ');
      return (neg ? '-' : '') + (ip ? numWords(ip) + ' ' : '') + 'point ' + digs;
    }
    var scales = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    for (var i = 0; i < scales.length; i++) {
      var s = scales[i][0];
      if (v >= s) {
        var qi = Math.floor(v / s), rest = v - qi * s;
        return (neg ? '-' : '') + under1000(qi) + ' ' + scales[i][1] + (rest ? ' ' + numWords(rest) : '');
      }
    }
    return (neg ? '-' : '') + under1000(v);
  }
  // Render the meeting value in the style of the draft fact it replaces:
  // "$800" -> "$8,000" · "800 dollars" -> "8,000 dollars" · "eight hundred" -> "eight thousand"
  function formatLike(draftRaw, mFact) {
    var v = mFact.value, d = draftRaw || '';
    if (/%/.test(d) || /\bpercent\b/i.test(d)) return fmtGrouped(v, /\.\d/.test(d) ? 2 : 0) + (/%/.test(d) ? '%' : ' percent');
    var symM = d.match(/[$€£]/);
    if (!/\d/.test(d)) {
      var wm = d.match(/\b(dollars?|euros?|pounds?)\b/i);
      var base = numWords(v);
      if (wm) {
        var w = mFact.currency ? CUR_WORD[mFact.currency] : wm[0].toLowerCase();
        if (v === 1) w = w.replace(/s$/, '');
        return base + ' ' + w;
      }
      if (symM) return (mFact.currency ? CUR_SYM[mFact.currency] : symM[0]) + fmtGrouped(v, 0);
      return base;
    }
    if (symM) {
      var sym = mFact.currency ? CUR_SYM[mFact.currency] : symM[0];
      return sym + fmtGrouped(v, /\.\d/.test(d) ? 2 : 0);
    }
    var wordM = d.match(/\b(dollars?|euros?|pounds?|usd|eur|gbp)\b/i);
    if (wordM) {
      if (/^(?:usd|eur|gbp)$/i.test(wordM[0])) {
        // the draft used an ISO code: answer in code form, in the same position
        var code = mFact.currency || wordM[0].toUpperCase();
        var gv = fmtGrouped(v, /\.\d/.test(d) ? 2 : 0);
        return d.toLowerCase().indexOf(wordM[0].toLowerCase()) === 0 ? code + ' ' + gv : gv + ' ' + code;
      }
      var w2 = mFact.currency ? CUR_WORD[mFact.currency] : (/eur/i.test(wordM[0]) ? 'euros' : (/pound|gbp/i.test(wordM[0]) ? 'pounds' : 'dollars'));
      if (v === 1) w2 = w2.replace(/s$/, '');
      return fmtGrouped(v, /\.\d/.test(d) ? 2 : 0) + ' ' + w2;
    }
    return d.indexOf(',') >= 0 || v >= 10000 ? fmtGrouped(v, /\.\d/.test(d) ? 2 : 0) : String(/\.\d/.test(d) ? v.toFixed(2) : Math.round(v));
  }
  function fixNumFor(dSent, dSpan, draftRaw, mFact) {
    if (!dSpan) return null;
    return dSent.slice(0, dSpan[0]) + formatLike(draftRaw, mFact) + dSent.slice(dSpan[1]);
  }
  function fullSpanOf(f) { return f.fullSpan || f.span; }
  function fullRawOf(text, f) { var sp = fullSpanOf(f); return text.slice(sp[0], sp[1]); }

  /* ---------------- money context: currency + billing period ---------------- */
  function currencyOf(raw, s, span) {
    var sym = raw.match(/[$€£]/);
    if (sym) return sym[0] === '$' ? 'USD' : (sym[0] === '€' ? 'EUR' : 'GBP');
    if (/\b(dollars?|usd)\b/i.test(raw)) return 'USD';
    if (/\b(euros?|eur)\b/i.test(raw)) return 'EUR';
    if (/\b(pounds?|gbp)\b/i.test(raw)) return 'GBP';
    var tail = s.slice(span[1], span[1] + 14).match(/^\s*(dollars?|euros?|pounds?|usd|eur|gbp)\b/i);
    if (tail) return /dol|usd/i.test(tail[1]) ? 'USD' : (/eur/i.test(tail[1]) ? 'EUR' : 'GBP');
    return null;
  }
  var PERIOD_MAP = { month: 'month', monthly: 'month', mo: 'month', year: 'year', annually: 'year', yearly: 'year', annum: 'year', yr: 'year', week: 'week', weekly: 'week', quarter: 'quarter', quarterly: 'quarter', day: 'day', daily: 'day', night: 'night', nightly: 'night', hour: 'hour', hourly: 'hour', seat: 'seat', person: 'person', guest: 'guest', head: 'head', ticket: 'ticket' };
  // periods per year, for annualised rate comparison. 'day' is deliberately
  // absent: daily rates keep the raw-value comparison they have today. The
  // per-unit bases (hour, seat, person, guest, head, ticket) are likewise
  // absent — they compare raw, like-for-like. 'night' annualises at 365:
  // the 365-vs-364 gap against week x 52 sits inside the 1% tolerance.
  var ANNUAL_FACTOR = { week: 52, month: 12, quarter: 4, year: 1, night: 365 };
  function periodAfter(s, end) {
    var rest = s.slice(end, end + 18);
    var m = rest.match(/^\s*(?:per\s+|a\s+|an\s+|\/\s*)(month|year|week|quarter|day|annum|night|hour|seat|person|guest|head|ticket)\b/i)
      || rest.match(/^\s*(monthly|annually|yearly|weekly|quarterly|daily|nightly|hourly)\b/i)
      || rest.match(/^\s*\/\s*(mo|yr)\b/i);
    if (!m) return null;
    return { key: PERIOD_MAP[m[1].toLowerCase()], raw: m[0].trim(), end: end + m[0].length };
  }

  /* ---------------- fee nouns (for zero / absence facts) ---------------- */
  function feeKey(phrase) {
    var words = String(phrase || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
    while (words.length && (words[0] === 'the' || words[0] === 'a' || words[0] === 'an' || words[0] === 'as' || COUNT_ADJ[words[0]])) words.shift();
    while (words.length && STOP[words[words.length - 1]]) words.pop();
    if (!words.length) return null;
    var last = normNoun(words[words.length - 1]);
    if (last === 'fee' || last === 'charge' || last === 'cost') words.pop(); else words[words.length - 1] = last;
    while (words.length && STOP[words[words.length - 1]]) words.pop();
    if (!words.length) return null;
    var key = words.join(' ');
    return key.length >= 3 ? key : null;
  }
  function draftFeeKey(text, span) {
    var after = text.slice(span[1], span[1] + 34);
    var m1 = after.match(/^\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)\s+(fees?|charges?)\b/i);
    if (m1) { var k1 = feeKey(m1[1]); if (k1) return k1; }
    var before = text.slice(Math.max(0, span[0] - 34), span[0]);
    var m3 = before.match(/([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)\s+(fees?|charges?)\s*(?:of|:|is|=)?\s*$/i);
    if (m3) { var k3 = feeKey(m3[1]); if (k3) return k3; }
    return null;
  }

  /* ---------------- line-item identifiers (Item 15, SKU AB-12) ---------------- */
  var ID_KIND = '(?:item|sku|line|part|model|ref|invoice|order|ticket|case)';
  function idsOf(text) {
    var out = {}, m, re = new RegExp('\\b' + ID_KIND + '\\s*#?\\s*([A-Za-z0-9][A-Za-z0-9-]*)', 'gi');
    while ((m = re.exec(text))) {
      if (!/\d/.test(m[1])) continue;
      var kind = m[0].match(/^[A-Za-z]+/)[0].toLowerCase();
      out[kind + ':' + m[1].toLowerCase()] = kind;
    }
    return out;
  }
  // 2 = shares an identifier · 1 = no identifier evidence either way · 0 = same kind, different id
  function idTier(dIds, mIds) {
    var dk = Object.keys(dIds || {}), mk = Object.keys(mIds || {}), i, k;
    if (!dk.length || !mk.length) return 1;
    for (i = 0; i < dk.length; i++) if (mIds[dk[i]]) return 2;
    var dKinds = {}, mKinds = {};
    dk.forEach(function (x) { dKinds[dIds[x]] = 1; });
    mk.forEach(function (x) { mKinds[mIds[x]] = 1; });
    for (k in dKinds) if (mKinds[k]) return 0;
    return 1;
  }

  /* ---------------- direction reversal ("You send us" vs "We send you") ---------------- */
  var DIR_VERBS = { send: 1, deliver: 1, provide: 1, ship: 1, return: 1, pay: 1 };
  function sideOf(p) { p = p.toLowerCase(); if (p === 'you') return 'other'; if (p === 'we' || p === 'i' || p === 'us' || p === 'me') return 'self'; return 'third'; }
  function dirPattern(text) {
    // the clause may sit anywhere in the sentence ("The email says: we send you ..."),
    // not only at its start: scan for the first pronoun + listed-verb + pronoun clause
    var re = /\b(you|we|i|they|he|she)\s+(?:will\s+|’ll\s+|'ll\s+)?([A-Za-z]+)\s+(?:to\s+)?(you|us|me|them|him|her)\b/gi;
    var m;
    while ((m = re.exec(text))) {
      if (!DIR_VERBS[stem(m[2].toLowerCase())]) continue;
      var aOff = m.index;
      var rOff = m.index + m[0].toLowerCase().lastIndexOf(m[3].toLowerCase());
      return { actor: m[1], verb: m[2].toLowerCase(), recip: m[3], actorSide: sideOf(m[1]), recipSide: sideOf(m[3]), actorSpan: [aOff, aOff + m[1].length], recipSpan: [rOff, rOff + m[3].length] };
    }
    return null;
  }
  function dirFix(text, dPat, mPat) {
    // each replacement keeps the case of the draft word it replaces
    function cased(orig, repl) {
      if (orig && orig.charAt(0) === orig.charAt(0).toUpperCase()) return repl.charAt(0).toUpperCase() + repl.slice(1);
      return repl.charAt(0).toLowerCase() + repl.slice(1);
    }
    var recipNew = cased(text.slice(dPat.recipSpan[0], dPat.recipSpan[1]), mPat.recip);
    var out = text.slice(0, dPat.recipSpan[0]) + recipNew + text.slice(dPat.recipSpan[1]);
    var actorNew = cased(text.slice(dPat.actorSpan[0], dPat.actorSpan[1]), mPat.actor);
    return out.slice(0, dPat.actorSpan[0]) + actorNew + out.slice(dPat.actorSpan[1]);
  }

  /* ---------------- quote sanity cap (no walls of text) ---------------- */
  function capQuote(text, span) {
    if (!text) return { text: text, span: span };
    var MAX = 280;
    if (text.length <= MAX) return { text: text, span: span };
    if (span) {
      var start = Math.max(0, span[0] - 110);
      if (start > 0) { var cut = text.indexOf(' ', start); if (cut > 0 && cut < span[0]) start = cut + 1; }
      var end = Math.min(text.length, span[1] + 110);
      if (end < text.length) { var sp = text.lastIndexOf(' ', end); if (sp > span[1]) end = sp; }
      var pre = start > 0 ? '…' : '', post = end < text.length ? '…' : '';
      return { text: pre + text.slice(start, end) + post, span: [span[0] - start + pre.length, span[1] - start + pre.length] };
    }
    var cutEnd = MAX, sp2 = text.lastIndexOf('. ', MAX);
    if (sp2 > 100) cutEnd = sp2 + 1; else { var sp3 = text.lastIndexOf(' ', MAX); if (sp3 > 0) cutEnd = sp3; }
    return { text: text.slice(0, cutEnd) + '…', span: null };
  }

  /* ---------------- sentence splitting ---------------- */
  var ABBREV = /\b(Mr|Mrs|Ms|Dr|St|vs|etc|approx|appt|dept|est)\./g;
  function splitSentences(text) {
    var t = text.replace(/(\d)\.(\d)/g, '$1$2').replace(ABBREV, '$1');
    var parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘'(])|(?<=[.!?])$/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].replace(//g, '.').replace(//g, '.').trim();
      if (s) out.push(s);
    }
    return out;
  }
  var TS_RE = /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:[-–—]\s*)?/;
  var NAME_TIME_RE = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—:]\s*)?/;
  var SPK_RE = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2})\s*:\s+/;
  function parseLines(text) {
    var lines = String(text || '').split(/\r?\n/), out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      // pasted subtitle text: header / timing / cue-number lines are not sentences
      if (/^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^STYLE\b/.test(line) || /^REGION\b/.test(line)) continue;
      if (/-->/.test(line) && /\d{1,2}:\d{2}/.test(line)) continue;
      if (/^\d{1,4}$/.test(line) && /-->/.test(text)) continue;
      // inline subtitle tags never survive into a quote
      line = line.replace(/<v(?:\.[^>\s]+)?\s+[^>]*>/gi, ' ');
      line = line.replace(/<\/?(?:v|c|i|b|u|font|ruby|rt|lang)(?:\s[^>]*)?>/gi, '');
      line = line.replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]?\d*>/g, '');
      line = line.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      var ts = null, speaker = null, m;
      if ((m = line.match(TS_RE))) { ts = m[1]; line = line.slice(m[0].length); }
      if (!ts && (m = line.match(NAME_TIME_RE))) { speaker = m[1]; ts = m[2]; line = line.slice(m[0].length); }
      if ((m = line.match(SPK_RE)) && !/^\d/.test(m[1])) { speaker = m[1]; line = line.slice(m[0].length); }
      // "Speaker 12:04:" style: speaker label that itself carries a time
      if (!ts && speaker && /\d/.test(speaker)) { speaker = null; }
      var sents = splitSentences(line);
      for (var j = 0; j < sents.length; j++) out.push({ text: sents[j], timestamp: ts, speaker: speaker });
    }
    return out;
  }

  /* ---------------- date extraction ---------------- */
  function parseDates(s) {
    var facts = [], spans = [];
    function push(raw, start, f) { f.raw = raw; f.span = [start, start + raw.length]; facts.push(f); spans.push(f.span); }
    var m;
    var re1 = new RegExp('\\b(' + MONTH_RE + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b', 'gi');
    while ((m = re1.exec(s))) push(m[0], m.index, { month: MONTHS[m[1].toLowerCase()], day: parseInt(m[2], 10) });
    var re2 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MONTH_RE + ')\\b', 'gi');
    while ((m = re2.exec(s))) { if (!spans.some(function (sp) { return m.index >= sp[0] && m.index < sp[1]; })) push(m[0], m.index, { month: MONTHS[m[2].toLowerCase()], day: parseInt(m[1], 10) }); }
    var re3 = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
    while ((m = re3.exec(s))) { var mo = parseInt(m[1], 10), dy = parseInt(m[2], 10); if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) push(m[0], m.index, { month: mo, day: dy }); }
    var re4 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = re4.exec(s))) push(m[0], m.index, { month: parseInt(m[2], 10), day: parseInt(m[3], 10) });
    var re5 = new RegExp('\\b(first|second|third|fourth|last)\\s+week\\s+of\\s+(' + MONTH_RE + ')\\b', 'gi');
    var WK = { first: 1, second: 2, third: 3, fourth: 4, last: 5 };
    while ((m = re5.exec(s))) push(m[0], m.index, { month: MONTHS[m[2].toLowerCase()], week: WK[m[1].toLowerCase()] });
    var re6 = new RegExp('\\b(early|mid|late|beginning of|end of)\\s+(?:the\\s+)?(' + MONTH_RE + ')\\b', 'gi');
    while ((m = re6.exec(s))) { var p = m[1].toLowerCase(); push(m[0], m.index, { month: MONTHS[m[2].toLowerCase()], part: p.indexOf('early') === 0 || p.indexOf('beginning') === 0 ? 'early' : (p.indexOf('mid') === 0 ? 'mid' : 'late') }); }
    var re7 = new RegExp('\\b(?:(next|this|coming)\\s+)?(' + WD_RE + ')\\b', 'gi');
    while ((m = re7.exec(s))) { if (!spans.some(function (sp) { return m.index >= sp[0] && m.index < sp[1]; })) push(m[0], m.index, { weekday: WEEKDAYS[m[2].toLowerCase()] }); }
    var re8 = /\b(?:by|on|before|until|due)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/gi;
    while ((m = re8.exec(s))) push(m[0], m.index, { day: parseInt(m[1], 10) });
    var re9 = new RegExp('\\b(' + MONTH_RE + ')\\b', 'gi');
    while ((m = re9.exec(s))) { if (!spans.some(function (sp) { return m.index >= sp[0] && m.index < sp[1]; })) push(m[0], m.index, { month: MONTHS[m[1].toLowerCase()] }); }
    // merge neighbouring fragments that describe ONE date (weekday + month/day),
    // never merging two facts that disagree on a shared field
    facts.sort(function (a, b) { return a.span[0] - b.span[0]; });
    var DFIELDS = ['month', 'day', 'weekday', 'week', 'part'];
    var mergedD = [];
    facts.forEach(function (f) {
      var last = mergedD[mergedD.length - 1];
      var clash = last && DFIELDS.some(function (k) { return last[k] != null && f[k] != null && last[k] !== f[k]; });
      if (last && !clash && f.span[0] - last.span[1] <= 24) {
        DFIELDS.forEach(function (k) { if (last[k] == null && f[k] != null) last[k] = f[k]; });
        last.span = [last.span[0], f.span[1]];
        last.raw = s.slice(last.span[0], last.span[1]);
      } else mergedD.push(f);
    });
    return { facts: mergedD, spans: mergedD.map(function (f) { return f.span; }) };
  }
  function dateConflict(a, b) {
    if (a.month && b.month && a.month !== b.month) return true;
    if (a.weekday != null && b.weekday != null && a.weekday !== b.weekday) return true;
    if (a.day && b.day && a.day !== b.day) {
      if (!a.month || !b.month || a.month === b.month) return true;
    }
    function weekRange(w) { return w === 5 ? [29, 31] : [(w - 1) * 7 + 1, w * 7]; }
    function partRange(p) { return p === 'early' ? [1, 10] : (p === 'mid' ? [11, 20] : [21, 31]); }
    var r, d;
    if (a.week && b.day && (!a.month || !b.month || a.month === b.month)) { r = weekRange(a.week); if (b.day < r[0] || b.day > r[1]) return true; }
    if (b.week && a.day && (!a.month || !b.month || a.month === b.month)) { r = weekRange(b.week); if (a.day < r[0] || a.day > r[1]) return true; }
    if (a.part && b.day && (!a.month || !b.month || a.month === b.month)) { r = partRange(a.part); if (b.day < r[0] || b.day > r[1]) return true; }
    if (b.part && a.day && (!a.month || !b.month || a.month === b.month)) { r = partRange(b.part); if (a.day < r[0] || a.day > r[1]) return true; }
    if (a.week && b.week && a.week !== b.week && (!a.month || !b.month || a.month === b.month)) return true;
    if (a.part && b.part && a.part !== b.part && (!a.month || !b.month || a.month === b.month)) return true;
    if (a.week && b.part && (!a.month || !b.month || a.month === b.month)) { r = partRange(b.part); var wr = weekRange(a.week); if (wr[1] < r[0] || wr[0] > r[1]) return true; }
    if (b.week && a.part && (!a.month || !b.month || a.month === b.month)) { r = partRange(a.part); var wr2 = weekRange(b.week); if (wr2[1] < r[0] || wr2[0] > r[1]) return true; }
    d = d; // noop
    return false;
  }
  function dateConsistent(m, d) {
    // a draft date is confirmed when every field the DRAFT asserts is present
    // and equal in the meeting fact (meeting may know more, never less)
    var fields = ['month', 'day', 'weekday', 'week', 'part'], any = false;
    for (var i = 0; i < fields.length; i++) {
      var k = fields[i];
      if (d[k] != null) { any = true; if (m[k] !== d[k]) return false; }
    }
    return any;
  }
  function sameDate(a, b) {
    return (a.month || 0) === (b.month || 0) && (a.day || 0) === (b.day || 0) && (a.weekday == null ? null : a.weekday) === (b.weekday == null ? null : b.weekday) && (a.week || 0) === (b.week || 0) && (a.part || '') === (b.part || '');
  }

  /* ---------------- fact extraction ---------------- */
  var MONEY_CTX = /\b(price|priced|cost|costs|fee|fees|budget|quote|quoted|total|charge|charged|charges|pay|paid|payment|invoice|invoiced|amount|sum|worth|billing|billed|bill|per month|per year|monthly|annually|yearly|salary|rate|retainer|deposit|discount)\b/i;
  function extractFacts(s) {
    var facts = { money: [], percent: [], counts: [], dates: [], names: [], actors: [], windows: [], terms: [], zeroFees: [], promise: false, included: null, billed: null };
    var masked = s.split('');
    function mask(a, b) { for (var i = a; i < b; i++) masked[i] = ' '; }
    // dates first (mask their spans so day numbers don't become counts)
    var dp = parseDates(s);
    facts.dates = dp.facts;
    dp.spans.forEach(function (sp) { mask(sp[0], sp[1]); });
    // times like 12:04
    var tm = s.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g), t1;
    for (t1 of tm) mask(t1.index, t1.index + t1[0].length);
    var work = masked.join('');
    // payment terms ("net 30", "net thirty") are checkable facts
    var reTmD = /\bnet\s*-?\s*(\d{1,3})\b/gi;
    while ((m = reTmD.exec(work))) { facts.terms.push({ days: parseInt(m[1], 10), raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); }
    work = masked.join('');
    var reTmW = new RegExp('\\bnet\\s+(' + NUMWORD + '(?:[-\\s]+' + NUMWORD + ')*)', 'gi');
    while ((m = reTmW.exec(work))) {
      var tv = wordVal(m[1]);
      if (tv !== null && tv >= 0 && tv <= 365) { facts.terms.push({ days: tv, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); }
    }
    work = masked.join('');
    // support windows / explicit limits ("nine to five", "24/7") are checkable facts
    var re24 = /\b24\s*\/\s*7\b/g;
    while ((m = re24.exec(work))) { facts.windows.push({ key: '24/7', raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); }
    work = masked.join('');
    if (/\b(support|helpdesk|hours|coverage|open|available|assistance)\b/i.test(s)) {
      var HOURW = '(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
      var reWin = new RegExp('\\b(' + HOURW + ')\\s*(am|pm)?\\s*(?:to|-|–|—)\\s*(' + HOURW + ')\\s*(am|pm)?\\b', 'gi');
      while ((m = reWin.exec(work))) {
        var hv = function (tok, ap) { var v = /^\d+$/.test(tok) ? parseInt(tok, 10) : NUMW[tok.toLowerCase()]; if (v === undefined || v > 24) return null; if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && v < 12) v += 12; if (ap === 'am' && v === 12) v = 0; } return v; };
        var h1 = hv(m[1], m[2]), h2 = hv(m[3], m[4]);
        if (h1 === null || h2 === null) continue;
        if (!m[4] && h2 <= h1 && h2 < 12) h2 += 12;
        var wRaw = s.slice(m.index, m.index + m[0].length), wTrim = wRaw.replace(/\s+$/, '');
        facts.windows.push({ key: h1 + '-' + h2, raw: wTrim, span: [m.index, m.index + wTrim.length] });
        mask(m.index, m.index + m[0].length);
      }
      work = masked.join('');
    }
    // word quantities: half a dozen = 6, a dozen = 12, a couple = 2 ("a few" stays vague: no fact)
    function wordCountFact(val, mm, includeOf) {
      var end = mm.index + mm[0].length;
      if (includeOf) { var ofM = work.slice(end).match(/^\s+of\b/); if (ofM) end += ofM[0].length; }
      var aftW = work.slice(end, end + 30);
      var nmW = aftW.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
      if (nmW && nmW[1].length >= 3 && !STOP[nmW[1].toLowerCase()] && !COUNT_ADJ[nmW[1].toLowerCase()]) {
        facts.counts.push({ value: val, raw: s.slice(mm.index, end), span: [mm.index, end], noun: normNoun(nmW[1]) });
      }
      mask(mm.index, mm.index + mm[0].length);
    }
    var reHD = /\bhalf a dozen\b|\ba half dozen\b/gi;
    while ((m = reHD.exec(work))) wordCountFact(6, m, false);
    work = masked.join('');
    var reDZ = /\ba dozen\b/gi;
    while ((m = reDZ.exec(work))) wordCountFact(12, m, false);
    work = masked.join('');
    var reCP = /\ba couple\b/gi;
    while ((m = reCP.exec(work))) wordCountFact(2, m, true);
    work = masked.join('');
    var m;
    // money: $ amounts
    var reD = /[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmM]|bn)\b|\s+(?:thousand|million|billion)\b)?/g;
    while ((m = reD.exec(work))) { var v = amtValOf(m[0]); if (v !== null) { facts.money.push({ value: v, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    // money: ISO code prefix ("EUR 4,000", "USD 1.5 million")
    var reISO = /\b(?:EUR|USD|GBP)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmM]|bn)\b|\s+(?:thousand|million|billion)\b)?/gi;
    while ((m = reISO.exec(work))) { var vI = amtValOf(m[0]); if (vI !== null) { facts.money.push({ value: vI, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    // money: digits + dollars/USD, digits with k suffix
    var reDK = /\b\d[\d,]*(?:\.\d+)?\s*(?:dollars?|USD|euros?|EUR|pounds?|GBP)\b/gi;
    while ((m = reDK.exec(work))) { var v2 = amtValOf(m[0]); if (v2 !== null) { facts.money.push({ value: v2, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    var reK = /\b\d[\d,]*(?:\.\d+)?[kK]\b/g;
    while ((m = reK.exec(work))) { var v3 = amtValOf(m[0]); if (v3 !== null && MONEY_CTX.test(s)) { facts.money.push({ value: v3, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    // percent: digits
    var reP = /\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent\b|per cent\b)/gi;
    while ((m = reP.exec(work))) { facts.percent.push({ value: parseFloat(m[0].replace(/[^0-9.]/g, '')), raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); }
    work = masked.join('');
    // digits with a magnitude word: "1.5 million", "2 billion" (+ symbol forms "1.5M", "2bn")
    var reDM = /\b\d[\d,]*(?:\.\d+)?\s*(thousand|million|billion)\b/gi;
    while ((m = reDM.exec(work))) {
      var dvv = amtValOf(m[0]);
      if (dvv === null) continue;
      var dAft = work.slice(m.index + m[0].length, m.index + m[0].length + 30);
      var dNounM = dAft.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
      if (dNounM && dNounM[1].length >= 3 && !STOP[dNounM[1].toLowerCase()] && !COUNT_ADJ[dNounM[1].toLowerCase()]) {
        facts.counts.push({ value: dvv, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length], noun: normNoun(dNounM[1]) });
        mask(m.index, m.index + m[0].length); work = masked.join(''); continue;
      }
      if (MONEY_CTX.test(s)) { facts.money.push({ value: dvv, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); work = masked.join(''); }
    }
    var reDM2 = /\b\d[\d,]*(?:\.\d+)?\s?(?:[Mm]\b|bn\b)/g;
    while ((m = reDM2.exec(work))) { var dv2 = amtValOf(m[0]); if (dv2 !== null && MONEY_CTX.test(s)) { facts.money.push({ value: dv2, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); work = masked.join(''); } }
    // word-number expressions (money w/ dollars, percent, counts)
    var reW = new RegExp('\\b' + NUMWORD + '(?![A-Za-z])(?:[-\\s]+' + NUMWORD + '(?![A-Za-z]))*', 'gi');
    while ((m = reW.exec(work))) {
      var rawW = m[0];
      if (!/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|point)\b/i.test(rawW)) continue;
      var val = wordVal(rawW);
      if (val === null) continue;
      if (!/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/i.test(rawW)
        && !/(?:^|\s)(a|an)\s$/i.test(work.slice(0, m.index))) continue; // bare fragment: "thousand" with no number attached
      var after = work.slice(m.index + rawW.length, m.index + rawW.length + 30);
      var afterM = after.match(/^\s*(dollars?|USD|euros?|EUR|pounds?|GBP|%|percent|per cent)\b/i);
      if (afterM) {
        var full = [m.index, m.index + rawW.length + afterM[0].length];
        if (/dollars?|USD|euros?|EUR|pounds?|GBP/i.test(afterM[1])) facts.money.push({ value: val, raw: s.slice(full[0], full[1]), span: full });
        else facts.percent.push({ value: val, raw: s.slice(full[0], full[1]), span: full });
        mask(full[0], full[1]); work = masked.join(''); continue;
      }
      var nounM = after.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
      if (nounM && !COUNT_ADJ[nounM[1].toLowerCase()] && !STOP[nounM[1].toLowerCase()] && nounM[1].length >= 3) {
        facts.counts.push({ value: val, raw: s.slice(m.index, m.index + rawW.length), span: [m.index, m.index + rawW.length], noun: normNoun(nounM[1]) });
        mask(m.index, m.index + rawW.length); work = masked.join(''); continue;
      }
      if (nounM && COUNT_ADJ[nounM[1].toLowerCase()]) {
        var noun2 = after.slice(nounM[0].length).match(/^\s+([A-Za-z]+)/);
        if (noun2 && noun2[1].length >= 3 && !STOP[noun2[1].toLowerCase()]) {
          facts.counts.push({ value: val, raw: s.slice(m.index, m.index + rawW.length), span: [m.index, m.index + rawW.length], noun: normNoun(noun2[1]) });
          mask(m.index, m.index + rawW.length); work = masked.join(''); continue;
        }
      }
      // spoken rate: "eighty a night", "two forty per seat" (the [ones][tens]
      // dictation shorthand for 240) — a number riding directly on a per-unit
      // phrase IS a rate, so the unit phrase itself is the money evidence: no
      // sentence-level money context is required. (This branch is only reached
      // after the currency-word and real-noun count branches above have
      // declined the match, so "five meetings a week" stays a count.) The fact
      // goes through the same comparison as any other amount — extraction
      // without comparison was a false "all clear" waiting to happen.
      var rateM = after.match(/^\s+(?:a|an|per)\s+(night|day|week|month|hour|year|seat|person|guest|head|ticket)\b/i);
      if (rateM) {
        var rVal = val, toksW = rawW.toLowerCase().replace(/-/g, ' ').trim().split(/\s+/);
        if (toksW.length === 2 && NUMW[toksW[0]] >= 1 && NUMW[toksW[0]] <= 9 && NUMW[toksW[1]] >= 20 && NUMW[toksW[1]] <= 90) rVal = NUMW[toksW[0]] * 100 + NUMW[toksW[1]];
        facts.money.push({ value: rVal, raw: s.slice(m.index, m.index + rawW.length), span: [m.index, m.index + rawW.length] });
        mask(m.index, m.index + rawW.length); work = masked.join(''); continue;
      }
      // bare spoken number of money-like size ("agreed on eight thousand") -> money
      if (val >= 100) {
        facts.money.push({ value: val, raw: s.slice(m.index, m.index + rawW.length), span: [m.index, m.index + rawW.length] });
        mask(m.index, m.index + rawW.length); work = masked.join(''); continue;
      }
    }
    work = masked.join('');
    // digit counts
    var reC = /\b\d[\d,]*(?:\.\d+)?\b/g;
    while ((m = reC.exec(work))) {
      var num = parseFloat(m[0].replace(/,/g, ''));
      if (num >= 1900 && num <= 2100 && m[0].indexOf(',') === -1 && m[0].indexOf('.') === -1) continue; // year
      var preC = work.slice(Math.max(0, m.index - 16), m.index);
      if (new RegExp(ID_KIND + '\\s*#?\\s*$', 'i').test(preC)) continue; // "Item 15" is an identifier, not a quantity
      var aft = work.slice(m.index + m[0].length, m.index + m[0].length + 30);
      var nm = aft.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
      if (!nm) continue;
      var noun = nm[1];
      if (COUNT_ADJ[noun.toLowerCase()]) {
        var nm2 = aft.slice(nm[0].length).match(/^\s+([A-Za-z]+)/);
        if (nm2 && nm2[1].length >= 3 && !STOP[nm2[1].toLowerCase()]) noun = nm2[1]; else continue;
      }
      if (noun.length < 3 || STOP[noun.toLowerCase()] || MONTHS[noun.toLowerCase()] || WEEKDAYS[noun.toLowerCase()] !== undefined) continue;
      facts.counts.push({ value: num, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length], noun: normNoun(noun) });
    }
    // bare digit numbers of money-like size ("the total is 8000") -> money
    var usedSpans = [];
    facts.money.forEach(function (f) { usedSpans.push(f.span); });
    facts.percent.forEach(function (f) { usedSpans.push(f.span); });
    facts.counts.forEach(function (f) { usedSpans.push(f.span); });
    facts.dates.forEach(function (f) { usedSpans.push(f.span); });
    var reBare = /\b\d[\d,]*(?:\.\d+)?\b/g;
    while ((m = reBare.exec(work))) {
      var bv = parseFloat(m[0].replace(/,/g, ''));
      if (isNaN(bv) || bv < 100) continue;
      if (bv >= 1900 && bv <= 2100 && m[0].indexOf(',') === -1 && m[0].indexOf('.') === -1) continue;
      var bSpan = [m.index, m.index + m[0].length];
      if (usedSpans.some(function (sp) { return bSpan[0] >= sp[0] && bSpan[1] <= sp[1]; })) continue;
      if (bv >= 1000 || MONEY_CTX.test(s)) facts.money.push({ value: bv, raw: s.slice(bSpan[0], bSpan[1]), span: bSpan });
    }
    // currency + billing period ride along with every money fact
    facts.money.forEach(function (f) {
      f.currency = currencyOf(f.raw, s, f.span);
      var per = periodAfter(s, f.span[1]);
      if (per) { f.period = per.key; f.periodRaw = per.raw; f.fullSpan = [f.span[0], per.end]; }
    });
    // names: actors (X will / X 'll / assigned to X)
    var reA = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will|’ll|'ll|is going to|is to)\b/g;
    while ((m = reA.exec(s))) { if (!NAME_STOP[m[1].split(' ')[0]]) facts.actors.push({ name: m[1], span: [m.index, m.index + m[1].length] }); }
    var reB = /\b(?:assigned to|handed to|owned by|owner:|--by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
    while ((m = reB.exec(s))) { if (!NAME_STOP[m[1].split(' ')[0]]) facts.actors.push({ name: m[1], span: [m.index + m[0].length - m[1].length, m.index + m[0].length] }); }
    var reT = /\b(?:Mr|Mrs|Ms|Dr)\.\s+([A-Z][a-z]+)/g;
    while ((m = reT.exec(s))) facts.names.push({ name: m[1], span: [m.index, m.index + m[0].length] });
    var reN = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;
    while ((m = reN.exec(s))) {
      var first = m[0].split(' ')[0];
      if (NAME_STOP[first] || MONTHS[first.toLowerCase()] || WEEKDAYS[first.toLowerCase()] !== undefined) continue;
      if (facts.names.some(function (n) { return n.name === m[0]; })) continue;
      facts.names.push({ name: m[0], span: [m.index, m.index + m[0].length] });
    }
    // promise markers + inclusion / billed
    facts.promise = /\b(we|i|you|he|she|they)\s*(will|’ll|'ll)\b/i.test(s) || /\bwill\s+(deliver|send|provide|include|complete|finish|ship|give|get|have|be|make|set up|prepare|cover|handle)\b/i.test(s) || /\bincludes?\b|\bincluding\b|\bincluded\b/i.test(s) || /\bfree\b/i.test(s) || /\bguarantee[ds]?\b/i.test(s) || /\bagreed to\b/i.test(s) || /\bwe promise\b/i.test(s);
    var inc = s.match(/\b(included|includes|including)\b[^.]*?\b(at no extra charge|at no extra cost|free of charge)\b|\b(included|includes|including)\b|no extra charge|at no extra cost/i);
    if (inc) facts.included = { raw: inc[0], span: [inc.index, inc.index + inc[0].length] };
    var bil = s.match(/billed separately|charged separately|not included|billed as an extra|charged extra|billed on top|charged on top|\bexcluded\b/i);
    if (bil) facts.billed = { raw: bil[0], span: [bil.index, bil.index + bil[0].length] };
    // zero / absence facts: "no setup fee", "no charge for onboarding", "onboarding is free"
    var ZF = [
      /\bno\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)\s+(?:fees?|charges?|costs?)\b/gi,
      /\bno\s+charge\s+for\s+(?:the\s+|a\s+|an\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})/gi,
      /\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)\s+is\s+(?:free|included)\b/gi
    ];
    ZF.forEach(function (re) {
      var zm;
      while ((zm = re.exec(s))) {
        var key = feeKey(zm[1]);
        if (key && !facts.zeroFees.some(function (z) { return z.key === key; })) facts.zeroFees.push({ key: key, raw: zm[0], span: [zm.index, zm.index + zm[0].length] });
      }
    });
    return facts;
  }
  function amtValOf(t) {
    t = t.trim().replace(/^(?:EUR|USD|GBP)\s*/i, '');
    if (/^[$€£]/.test(t) || /^\d/.test(t)) {
      var mult = 1;
      var wm = t.match(/(thousand|million|billion)\s*$/i);
      if (wm) mult = wm[1].toLowerCase() === 'thousand' ? 1e3 : (wm[1].toLowerCase() === 'million' ? 1e6 : 1e9);
      else if (/bn\s*$/i.test(t)) mult = 1e9;
      else if (/[kK]\s*$/.test(t)) mult = 1e3;
      else if (/[mM]\s*$/.test(t)) mult = 1e6;
      var n = parseFloat(t.replace(/[$€£,\s]/g, '').replace(/(thousand|million|billion|bn|eur|usd|gbp|[kKmM])$/i, ''));
      if (isNaN(n)) return null;
      return n * mult;
    }
    return wordVal(t);
  }

  /* ---------------- matching + comparison ---------------- */
  var ROLE_STOP = { speaker: 1, facilitator: 1, client: 1, vendor: 1, buyer: 1, consultant: 1, manager: 1, lead: 1, coordinator: 1, sponsor: 1, analyst: 1, team: 1, moderator: 1, interviewer: 1, host: 1, presenter: 1, 'events lead': 1, 'account manager': 1, 'ops manager': 1, 'office manager': 1 };
  function nameParts(n) { return n.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean); }
  function firstNameMatch(x, y) {
    return x === y || (x.length === 1 && y.charAt(0) === x) || (y.length === 1 && x.charAt(0) === y)
      || (x.length >= 3 && y.indexOf(x) === 0) || (y.length >= 3 && x.indexOf(y) === 0);
  }
  function samePerson(a, b) {
    var pa = nameParts(a), pb = nameParts(b);
    if (!pa.length || !pb.length) return false;
    if (pa.join(' ') === pb.join(' ')) return true;
    if (pa.length > 1 && pb.length > 1) return pa[pa.length - 1] === pb[pb.length - 1] && firstNameMatch(pa[0], pb[0]);
    if (pa.length === 1 && pb.length === 1) return firstNameMatch(pa[0], pb[0]);
    var single = pa.length === 1 ? pa[0] : pb[0], other = pa.length === 1 ? pb : pa;
    return firstNameMatch(single, other[0]) || single === other[other.length - 1];
  }
  function buildSentences(text) {
    return parseLines(text).map(function (s, i) {
      var facts = extractFacts(s.text);
      // a speaker label + first-person commitment IS an owner fact ("Raj: I will send ...")
      if (s.speaker && !ROLE_STOP[s.speaker.toLowerCase()] && !/^speaker\b/i.test(s.speaker)
        && /^\s*(?:and\s+|so\s+)?(i\s+(?:will|’ll|'ll)|i'?m\s+going\s+to)\b/i.test(s.text)) {
        facts.actors.push({ name: s.speaker, span: null, implied: true });
      }
      return { text: s.text, timestamp: s.timestamp, speaker: s.speaker, index: i, facts: facts, toks: tokens(s.text), ids: idsOf(s.text) };
    });
  }
  /* Self-correction: when a speaker corrects a figure, the LATER value is the
     only meeting fact. A superseded value must never be quoted as "Meeting
     said" and never be proposed by a Copy fix, so it is retired here, before
     any indexing or pairing happens. Two shapes: a correction marker (or a
     dash-restart) between two facts of a kind inside one sentence, and a
     correction marker in the next sentence of the same speaker's turn. */
  var CORRECT_MARK = /\b(actually|sorry|no\s*,?\s*wait|i\s+mean|correct\w*)\b/i;
  function applyCorrections(meeting) {
    var KINDS = ['money', 'counts', 'percent', 'terms', 'dates'];
    function linked(text, a, b) {
      var mid = text.slice(a, b);
      if (CORRECT_MARK.test(mid)) return true;
      // a dash-restart: exactly one dash between the values (a parenthetical
      // pair has two), and not a summation dash ("$900 — so $1,800")
      var dashes = mid.match(/—|–/g);
      if (dashes && dashes.length === 1 && !/^\s*so\b/i.test(mid.slice(mid.search(/—|–/) + 1))) return true;
      return false;
    }
    meeting.forEach(function (s) {
      KINDS.forEach(function (kind) {
        var arr = s.facts[kind];
        if (!arr || arr.length < 2) return;
        arr = arr.slice().sort(function (x, y) { return x.span[0] - y.span[0]; });
        var keep = [arr[0]];
        for (var i = 1; i < arr.length; i++) {
          if (linked(s.text, keep[keep.length - 1].span[1], arr[i].span[0])) keep[keep.length - 1] = arr[i];
          else keep.push(arr[i]);
        }
        if (keep.length !== arr.length) s.facts[kind] = keep;
      });
    });
    for (var i = 0; i + 1 < meeting.length; i++) {
      var s1 = meeting[i], s2 = meeting[i + 1];
      if ((s1.speaker || null) !== (s2.speaker || null)) continue;
      var mm = s2.text.match(CORRECT_MARK);
      if (!mm) continue;
      KINDS.forEach(function (kind) {
        var a1 = s1.facts[kind], a2 = s2.facts[kind];
        if (!a1 || a1.length !== 1 || !a2 || a2.length !== 1) return;
        // the marker must introduce (or immediately trail) the correcting value
        if (!(mm.index < a2[0].span[0] || mm.index <= a2[0].span[1] + 24)) return;
        // and the correction must be ABOUT s1's fact: either s2 is a bare
        // correction utterance, or the two facts share a distinctive
        // descriptor (units and currency words do not count). Otherwise the
        // marker corrects something inside s2's own new topic — two price
        // lines, the second self-corrected — and s1's figure stands.
        var bare = Object.keys(tokens(s2.text)).length <= 3;
        if (!bare) {
          var UNIT_TOK = { kilo: 1, gram: 1, dollar: 1, euro: 1, pound: 1, percent: 1, cent: 1, litre: 1, liter: 1, unit: 1 };
          function winToks(s, f) {
            var t = tokens(s.text.slice(Math.max(0, f.span[0] - 45), Math.min(s.text.length, f.span[1] + 45)));
            var own = tokens(s.text.slice(f.span[0], f.span[1]));
            for (var w in own) delete t[w];
            for (var u in UNIT_TOK) delete t[u];
            return t;
          }
          var w1 = winToks(s1, a1[0]), w2 = winToks(s2, a2[0]), shared = false;
          for (var wk in w1) if (w2[wk]) { shared = true; break; }
          if (!shared) return;
        }
        s1.facts[kind] = [];
      });
    }
  }
  function check(transcriptText, draftText, opts) {
    opts = opts || {};
    var tLimit = opts.transcriptWords || 15000, dLimit = opts.draftWords || 3000;
    function words(t) { return (String(t || '').trim().match(/\S+/g) || []).length; }
    function truncate(t, n) {
      var parts = String(t).split(/\s+/);
      if (parts.length <= n) return t;
      // cut at a line boundary near the limit where possible
      var cut = parts.slice(0, n).join(' ');
      return cut;
    }
    var tWords = words(transcriptText), dWords = words(draftText);
    var tTrunc = tWords > tLimit, dTrunc = dWords > dLimit;
    if (tTrunc) transcriptText = truncate(transcriptText, tLimit);
    if (dTrunc) draftText = truncate(draftText, dLimit);

    var meeting = buildSentences(transcriptText);
    var draft = buildSentences(draftText);
    applyCorrections(meeting);

    // idf over meeting sentences
    var df = {}, N = meeting.length || 1;
    meeting.forEach(function (s) { for (var w in s.toks) df[w] = (df[w] || 0) + 1; });
    function idf(w) { return Math.log(1 + N / (df[w] || 0.5)); }
    function score(d, mts) {
      var num = 0, den = 0;
      for (var w in d.toks) { var v = idf(w); den += v; if (mts.toks[w]) num += v; }
      return den ? num / den : 0;
    }
    // transcript-wide vocab + fact sets
    var tVocab = {};
    meeting.forEach(function (s) { for (var w in s.toks) tVocab[w] = 1; });
    var tMoneyVals = {}, tNames = {};
    meeting.forEach(function (s) {
      s.facts.money.forEach(function (f) { tMoneyVals[f.value] = 1; });
      if (s.speaker && !/^Speaker/i.test(s.speaker)) tNames[s.speaker] = 1;
      s.facts.actors.forEach(function (a) { tNames[a.name] = 1; });
      s.facts.names.forEach(function (n) { tNames[n.name] = 1; });
    });

    // zero-fee facts, payment terms and the agreed total, indexed meeting-wide
    var zeroByKey = {};
    meeting.forEach(function (s) { s.facts.zeroFees.forEach(function (z) { if (!zeroByKey[z.key]) zeroByKey[z.key] = { s: s, z: z }; }); });
    // charged fees indexed by fee noun, so a draft that denies a fee the
    // meeting charges can be caught in the reverse direction too
    var feeByKey = {};
    meeting.forEach(function (s) { s.facts.money.forEach(function (f) { var k = draftFeeKey(s.text, f.span); if (k && !feeByKey[k]) feeByKey[k] = { s: s, f: f }; }); });
    var tTermDays = {};
    meeting.forEach(function (s) { s.facts.terms.forEach(function (f) { tTermDays[f.days] = 1; }); });
    var agreedTotal = null;
    draft.forEach(function (ds) {
      ds.facts.money.forEach(function (f) {
        if (!tMoneyVals[f.value]) return;
        meeting.forEach(function (ms) {
          if (!ms.facts.money.some(function (x) { return Math.abs(x.value - f.value) < 0.005; })) return;
          var sc = score(ds, ms) + (/\btotal\b/i.test(ms.text) ? 0.5 : 0);
          if (!agreedTotal || sc > agreedTotal.sc) agreedTotal = { s: ms, sc: sc };
        });
      });
    });

    var flags = [];
    function addFlag(f) {
      var FRAG = /^\s*(hundred|thousand|million|billion|dozen)\s*$/i;
      if ((f.draftFactText && FRAG.test(f.draftFactText)) || (f.meetingFactText && FRAG.test(f.meetingFactText))) return;
      // dedupe: same draft sentence + type + draft fact text
      for (var i = 0; i < flags.length; i++) {
        if (flags[i].draftIndex === f.draftIndex && flags[i].type === f.type && flags[i].draftFactText === f.draftFactText) return;
      }
      flags.push(f);
    }
    function fixFor(dSent, dSpan, replacement) {
      if (!dSpan || replacement == null) return null;
      return dSent.slice(0, dSpan[0]) + replacement + dSent.slice(dSpan[1]);
    }

    function ctxScore(d, span, ms) {
      // local context around the fact: whole words whose span intersects the
      // +-28 char window, blended with the whole-sentence score
      var lo = span[0] - 28, hi = span[1] + 28, ct = {}, wm;
      var wre = /[A-Za-z']+/g;
      while ((wm = wre.exec(d.text))) {
        if (wm.index + wm[0].length < lo || wm.index > hi) continue;
        var w = wm[0].toLowerCase();
        if (!w || STOP[w] || NUMW[w] !== undefined || w === 'hundred' || w === 'thousand' || w === 'million') continue;
        ct[stem(w)] = 1;
      }
      var num = 0, den = 0;
      for (var w2 in ct) { var v = idf(w2); den += v; if (ms.toks[w2]) num += v; }
      var cs = den ? num / den : 0;
      return 0.65 * cs + 0.35 * score(d, ms);
    }
    function confOf(sc) { return sc >= 0.30 ? 'High' : 'Low'; }

    // descriptor words around a fact (its local identity: "luxury suite",
    // "travel fee", "deposit") — used to prefer the right counterpart when a
    // sentence carries several facts of the same kind
    function descSet(text, span) {
      var lo = Math.max(0, span[0] - 45), hi = Math.min(text.length, span[1] + 45);
      var set = tokens(text.slice(lo, hi));
      var own = tokens(text.slice(span[0], span[1]));
      for (var w in own) delete set[w];
      return set;
    }
    function descOverlap(d, mf, ms, mFact) {
      var a = descSet(d.text, mf.span), b = descSet(ms.text, mFact.span), n = 0;
      for (var w in a) if (b[w]) n++;
      return n;
    }
    // hard floor: the draft amount itself is said somewhere in the meeting
    // (same value, no currency contradiction, no period contradiction) — it
    // must never be accused against a DIFFERENT meeting value
    function floorHit(mf) {
      var hit = false;
      meeting.forEach(function (ms) {
        ms.facts.money.forEach(function (g) {
          if (hit) return;
          if (Math.abs(g.value - mf.value) >= 0.005) return;
          if (mf.currency && g.currency && mf.currency !== g.currency) return;
          if (mf.period && g.period && mf.period !== g.period && ANNUAL_FACTOR[mf.period] && ANNUAL_FACTOR[g.period]) return;
          hit = true;
        });
      });
      return hit;
    }
    // matched-pair bookkeeping for the dropped-amount pass: which meeting
    // sentences were actually compared against, and which of their money
    // facts were accounted for by a comparison
    var matchedMs = {}, matchedMoneyMs = {}, accountedMF = {};
    // the comparison itself, shared by word-matched pairing and by the
    // fact-type fallback pairing (forceLow = tentative pairing)
    function compareMoney(d, mf, ms, mFact, sc, forceLow, pickDesc) {
      var conf = forceLow ? 'Low' : confOf(sc);
      if (Math.abs(mFact.value - mf.value) < 0.005) {
        // same value: a different currency or billing period is still a change
        var cDiff = mf.currency && mFact.currency && mf.currency !== mFact.currency;
        var pDiff = mf.period && mFact.period && mf.period !== mFact.period;
        if (cDiff || pDiff) {
          addFlag({ type: 'Amount', beta: false, confidence: conf, draftIndex: d.index, draftSentence: d.text, draftSpan: fullSpanOf(mf), draftFactText: fullRawOf(d.text, mf), meetingSentence: ms.text, meetingSpan: fullSpanOf(mFact), meetingFactText: fullRawOf(ms.text, mFact), timestamp: ms.timestamp, fix: fixFor(d.text, fullSpanOf(mf), formatLike(fullRawOf(d.text, mf), mFact) + (pDiff ? ' ' + mFact.periodRaw : '')) });
        }
        return;
      }
      // both sides carry a billing period: compare ANNUALISED rates, not raw
      // values — $24,000 per year and $2,000 per month are the same retainer.
      // An equivalent rate stays silent (a currency change still flags); a
      // genuinely different rate flags, and its fix states the meeting's rate
      // converted into the draft's own period — never the raw meeting value
      // wearing the draft's period.
      if (mf.period && mFact.period && mf.period !== mFact.period && ANNUAL_FACTOR[mf.period] && ANNUAL_FACTOR[mFact.period]) {
        var annM = mFact.value * ANNUAL_FACTOR[mFact.period];
        var annD = mf.value * ANNUAL_FACTOR[mf.period];
        var convFact = { value: annM / ANNUAL_FACTOR[mf.period], currency: mFact.currency };
        var curDiff = mf.currency && mFact.currency && mf.currency !== mFact.currency;
        if (Math.abs(annD - annM) <= Math.max(annM * 0.01, 12)) {
          if (curDiff) {
            addFlag({ type: 'Amount', beta: false, confidence: conf, draftIndex: d.index, draftSentence: d.text, draftSpan: fullSpanOf(mf), draftFactText: fullRawOf(d.text, mf), meetingSentence: ms.text, meetingSpan: fullSpanOf(mFact), meetingFactText: fullRawOf(ms.text, mFact), timestamp: ms.timestamp, fix: fixNumFor(d.text, mf.span, mf.raw, convFact) });
          }
          return;
        }
        addFlag({ type: 'Amount', beta: false, confidence: conf, draftIndex: d.index, draftSentence: d.text, draftSpan: fullSpanOf(mf), draftFactText: fullRawOf(d.text, mf), meetingSentence: ms.text, meetingSpan: fullSpanOf(mFact), meetingFactText: fullRawOf(ms.text, mFact), timestamp: ms.timestamp, fix: fixNumFor(d.text, mf.span, mf.raw, convFact) });
        return;
      }
      // the floor yields when the pairing itself is descriptor-confident: a
      // draft amount whose own words name THIS counterpart ("the total comes
      // to $2,000", matched to the meeting's total) is accused against it even
      // if the same figure also appears elsewhere in another role (a deposit)
      if (!(pickDesc >= 2) && floorHit(mf)) return;
      addFlag({ type: 'Amount', beta: false, confidence: conf, draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: ms.text, meetingSpan: mFact.span, meetingFactText: mFact.raw, timestamp: ms.timestamp, fix: fixNumFor(d.text, mf.span, mf.raw, mFact) });
    }

    draft.forEach(function (d) {
      var df = d.facts;
      var best = { s: null, sc: 0 };
      meeting.forEach(function (ms) { var sc = score(d, ms); if (sc > best.sc) best = { s: ms, sc: sc }; });
      // candidates carrying a fact kind, ranked by fact-local context score
      function candsFor(kind, span, filterFn) {
        var out = [];
        meeting.forEach(function (ms) {
          var arr = ms.facts[kind];
          if (!arr || !arr.length) return;
          if (filterFn && !arr.some(filterFn)) return;
          out.push({ s: ms, sc: ctxScore(d, span, ms), tier: idTier(d.ids, ms.ids) });
        });
        out.sort(function (a, b) { return (b.tier - a.tier) || (b.sc - a.sc); });
        return out;
      }

      // --- money (per-fact assignment so multi-amount sentences pair up correctly) ---
      if (df.money.length) {
        var usedMF = {};
        df.money.forEach(function (mf) {
          // zero / absence: the meeting said this fee does not exist
          var fk = draftFeeKey(d.text, mf.span);
          if (fk && zeroByKey[fk]) {
            var zh = zeroByKey[fk];
            addFlag({ type: 'Amount', beta: false, confidence: 'High', draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: zh.s.text, meetingSpan: zh.z.span, meetingFactText: zh.z.raw, timestamp: zh.s.timestamp, fix: null });
            return;
          }
          // every unused meeting money fact is a candidate counterpart; the
          // pick prefers the same identifier tier, then the fact whose local
          // descriptors match the draft fact's ("luxury suite" pairs with the
          // luxury rate, not the standard one), then an exact value, then the
          // best sentence context
          var cands = candsFor('money', mf.span);
          var options = [], totalFacts = 0;
          cands.forEach(function (c) {
            c.s.facts.money.forEach(function (fact, fi) {
              totalFacts++;
              if (usedMF[c.s.index + ':' + fi]) return;
              options.push({ s: c.s, sc: c.sc, tier: c.tier, fact: fact, fi: fi, desc: descOverlap(d, mf, c.s, fact), exact: (Math.abs(fact.value - mf.value) < 0.005 && !(mf.currency && fact.currency && mf.currency !== fact.currency)) ? 1 : 0 });
            });
          });
          options.sort(function (a, b) { return (b.tier - a.tier) || (b.desc - a.desc) || (b.exact - a.exact) || (b.sc - a.sc) || (a.s.index - b.s.index) || (a.fi - b.fi); });
          var pick = options.length ? options[0] : null;
          if (pick && pick.sc >= 0.12) {
            usedMF[pick.s.index + ':' + pick.fi] = 1;
            matchedMs[pick.s.index] = 1; matchedMoneyMs[pick.s.index] = 1; accountedMF[pick.s.index + ':' + pick.fi] = 1;
            compareMoney(d, mf, pick.s, pick.fact, pick.sc, false, pick.desc);
            return;
          }
          // fallback pairing: the sentence matched nothing by shared words
          // ("It is $2,000 per month." / "Price: $2,000 per year.") — compare
          // by fact type instead of staying silent. A single meeting amount
          // is compared normally; with several, the best counterpart is
          // compared tentatively (Low), and only when it carries some signal
          // (shared descriptors or the same value).
          if (pick && (totalFacts === 1 || pick.desc > 0 || pick.exact)) {
            usedMF[pick.s.index + ':' + pick.fi] = 1;
            matchedMs[pick.s.index] = 1; matchedMoneyMs[pick.s.index] = 1; accountedMF[pick.s.index + ':' + pick.fi] = 1;
            compareMoney(d, mf, pick.s, pick.fact, pick.sc, totalFacts !== 1, pick.desc);
            return;
          }
          // added charge: no counterpart anywhere, but an agreed total DID match
          if (agreedTotal && !tMoneyVals[mf.value]) {
            addFlag({ type: 'Amount', beta: false, confidence: 'High', draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: agreedTotal.s.text, meetingSpan: null, meetingFactText: null, timestamp: agreedTotal.s.timestamp, fix: null });
          }
        });
      }
      // --- percent (reported as Quantity) ---
      if (df.percent.length) {
        df.percent.forEach(function (pf) {
          var cands = candsFor('percent', pf.span);
          if (!cands.length || cands[0].sc < 0.12) return;
          matchedMs[cands[0].s.index] = 1;
          var pm = cands[0].s.facts.percent[0];
          if (Math.abs(pm.value - pf.value) < 0.005) return;
          addFlag({ type: 'Quantity', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: pf.span, draftFactText: pf.raw, meetingSentence: cands[0].s.text, meetingSpan: pm.span, meetingFactText: pm.raw, timestamp: cands[0].s.timestamp, fix: fixNumFor(d.text, pf.span, pf.raw, pm) });
        });
      }
      // --- counts by noun ---
      if (df.counts.length) {
        df.counts.forEach(function (cf) {
          var cands = candsFor('counts', cf.span, function (x) { return x.noun === cf.noun; });
          cands = cands.filter(function (c) { return c.tier !== 0; }); // never compare across different identifiers
          if (!cands.length || cands[0].sc < 0.12) return;
          matchedMs[cands[0].s.index] = 1;
          var same = cands[0].s.facts.counts.filter(function (x) { return x.noun === cf.noun; });
          var hit = same.some(function (x) { return Math.abs(x.value - cf.value) < 0.005; });
          if (hit) return;
          var cm2 = same[0];
          addFlag({ type: 'Quantity', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: cf.span, draftFactText: cf.raw + ' ' + cf.noun, meetingSentence: cands[0].s.text, meetingSpan: cm2.span, meetingFactText: cm2.raw + ' ' + cm2.noun, timestamp: cands[0].s.timestamp, fix: fixNumFor(d.text, cf.span, cf.raw, cm2) });
        });
      }
      // --- payment terms ("net 30" vs "net 60") ---
      if (df.terms.length) {
        df.terms.forEach(function (tf) {
          if (tTermDays[tf.days]) return; // the same term is said somewhere in the meeting
          var cands = candsFor('terms', tf.span);
          if (!cands.length || cands[0].sc < 0.12) return;
          matchedMs[cands[0].s.index] = 1;
          var tmf = cands[0].s.facts.terms[0];
          if (tmf.days === tf.days) return;
          addFlag({ type: 'Date', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: tf.span, draftFactText: tf.raw, meetingSentence: cands[0].s.text, meetingSpan: tmf.span, meetingFactText: tmf.raw, timestamp: cands[0].s.timestamp, fix: fixFor(d.text, tf.span, tmf.raw) });
        });
      }
      // --- support windows / explicit limits ---
      if (df.windows.length) {
        df.windows.forEach(function (wf) {
          var cands = candsFor('windows', wf.span);
          if (!cands.length || cands[0].sc < 0.12) return;
          matchedMs[cands[0].s.index] = 1;
          var wm = cands[0].s.facts.windows[0];
          if (wm.key === wf.key) return;
          addFlag({ type: 'Promise', beta: true, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: wf.span, draftFactText: wf.raw, meetingSentence: cands[0].s.text, meetingSpan: wm.span, meetingFactText: wm.raw, timestamp: cands[0].s.timestamp, fix: fixFor(d.text, wf.span, wm.raw) });
        });
      }
      // --- fee dropped: the meeting charges a fee the draft says does not exist ---
      if (df.zeroFees.length) {
        df.zeroFees.forEach(function (zf) {
          if (zeroByKey[zf.key]) return; // the meeting itself says this fee does not exist
          var hit = feeByKey[zf.key];
          if (!hit) return;
          var mtxt = hit.s.text;
          var cond = /\bwaived?\b[^.;]*\b(?:if|unless|provided)\b/i.test(mtxt) || /\b(?:if|unless)\b[^.;]*\bwaived?\b/i.test(mtxt);
          if (!cond && /\bwaived?\b/i.test(mtxt)) return; // the fee is unconditionally waived in the meeting
          addFlag({ type: 'Amount', beta: false, confidence: cond ? 'Low' : 'High', draftIndex: d.index, draftSentence: d.text, draftSpan: zf.span, draftFactText: zf.raw, meetingSentence: hit.s.text, meetingSpan: fullSpanOf(hit.f), meetingFactText: fullRawOf(hit.s.text, hit.f), timestamp: hit.s.timestamp, fix: fixFor(d.text, zf.span, formatLike(hit.f.raw, hit.f) + ' ' + zf.key + ' fee') });
        });
      }
      // --- dates (per-fact: walk candidates until one confirms or conflicts) ---
      if (df.dates.length) {
        df.dates.forEach(function (dtf) {
          var cands = candsFor('dates', dtf.span);
          for (var ci = 0; ci < cands.length; ci++) {
            if (cands[ci].sc < 0.12) break;
            matchedMs[cands[ci].s.index] = 1;
            var darr = cands[ci].s.facts.dates;
            if (darr.some(function (x) { return sameDate(x, dtf) || dateConsistent(x, dtf); })) return;
            var clash = null;
            for (var i = 0; i < darr.length; i++) { if (dateConflict(dtf, darr[i])) { clash = darr[i]; break; } }
            if (clash) {
              addFlag({ type: 'Date', beta: false, confidence: confOf(cands[ci].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: dtf.span, draftFactText: dtf.raw, meetingSentence: cands[ci].s.text, meetingSpan: clash.span, meetingFactText: clash.raw, timestamp: cands[ci].s.timestamp, fix: fixFor(d.text, dtf.span, clash.raw) });
              return;
            }
          }
        });
      }
      // --- names / owners ---
      if (df.actors.length) {
        df.actors.forEach(function (af) {
          var cands = candsFor('actors', af.span);
          if (!cands.length || cands[0].sc < 0.12) return;
          var hit = cands[0].s.facts.actors.some(function (x) { return samePerson(x.name, af.name); });
          if (hit) return;
          // only accuse when the meeting candidate is about the same action:
          // the verb after the draft actor's "will" must appear in it (or the match is very strong)
          var vm = af.span ? d.text.slice(af.span[1]).match(/^\s*(?:will|’ll|'ll|is going to|is to)\s+([A-Za-z]+)/) : null;
          var verbShared = vm && cands[0].s.toks[stem(vm[1].toLowerCase())];
          var assignForm = af.span && /(?:assigned to|handed to|owned by|owner:)\s*$/i.test(d.text.slice(0, af.span[0]));
          if (!assignForm && !verbShared && cands[0].sc < 0.45) return;
          var am = cands[0].s.facts.actors[0];
          addFlag({ type: 'Name', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: af.span, draftFactText: af.name, meetingSentence: cands[0].s.text, meetingSpan: am.span, meetingFactText: am.name, timestamp: cands[0].s.timestamp, fix: fixFor(d.text, af.span, am.name) });
        });
      }
      // --- direction reversal ("You send us the files" said, "We send you the files" written) ---
      var dPat = dirPattern(d.text);
      if (dPat) {
        var dBest = null;
        meeting.forEach(function (ms) {
          var mPat = dirPattern(ms.text);
          if (!mPat || stem(mPat.verb) !== stem(dPat.verb)) return;
          var swapped = (mPat.actorSide === dPat.recipSide && mPat.recipSide === dPat.actorSide)
            && ((mPat.actorSide === 'self' && mPat.recipSide === 'other') || (mPat.actorSide === 'other' && mPat.recipSide === 'self'));
          if (!swapped) return;
          var sc = score(d, ms);
          if (!dBest || sc > dBest.sc) dBest = { s: ms, sc: sc, mPat: mPat };
        });
        if (dBest && dBest.sc >= 0.30) {
          addFlag({ type: 'Direction', beta: false, confidence: 'Low', draftIndex: d.index, draftSentence: d.text, draftSpan: dPat.actorSpan, draftFactText: dPat.actor + ' ' + dPat.verb + ' ' + dPat.recip, meetingSentence: dBest.s.text, meetingSpan: dBest.mPat.actorSpan, meetingFactText: dBest.mPat.actor + ' ' + dBest.mPat.verb + ' ' + dBest.mPat.recip, timestamp: dBest.s.timestamp, fix: dirFix(d.text, dPat, dBest.mPat) });
        }
      }
      // --- inclusion flip: said included, draft bills separately (or reverse) ---
      var fc = null;
      meeting.forEach(function (ms) { if (ms.facts.included || ms.facts.billed) { var sc = score(d, ms); if (!fc || sc > fc.sc) fc = { s: ms, sc: sc }; } });
      if (fc && fc.sc >= 0.16) {
        if (fc.s.facts.included && df.billed) {
          addFlag({ type: 'Promise', beta: true, confidence: 'High', draftIndex: d.index, draftSentence: d.text, draftSpan: df.billed.span, draftFactText: df.billed.raw, meetingSentence: fc.s.text, meetingSpan: fc.s.facts.included.span, meetingFactText: fc.s.facts.included.raw, timestamp: fc.s.timestamp, fix: fixFor(d.text, df.billed.span, fc.s.facts.included.raw) });
        } else if (fc.s.facts.billed && df.included) {
          addFlag({ type: 'Promise', beta: true, confidence: 'High', draftIndex: d.index, draftSentence: d.text, draftSpan: df.included.span, draftFactText: df.included.raw, meetingSentence: fc.s.text, meetingSpan: fc.s.facts.billed.span, meetingFactText: fc.s.facts.billed.raw, timestamp: fc.s.timestamp, fix: fixFor(d.text, df.included.span, fc.s.facts.billed.raw) });
        }
      }
      // --- promise with no source (Beta) ---
      if (df.promise && !df.money.length && !df.dates.length) {
        var toksArr = Object.keys(d.toks);
        var absent = toksArr.filter(function (w) { return !tVocab[w]; });
        var hasFactFlag = flags.some(function (f) { return f.draftIndex === d.index; });
        if (!hasFactFlag && best.sc < 0.35 && toksArr.length >= 3 && absent.length >= 2) {
          addFlag({ type: 'Promise', beta: true, confidence: absent.length >= Math.ceil(toksArr.length * 0.6) ? 'High' : 'Low', draftIndex: d.index, draftSentence: d.text, draftSpan: null, draftFactText: d.text, meetingSentence: null, meetingSpan: null, meetingFactText: null, timestamp: null, fix: null });
        }
      }
    });

    // --- dropped amounts: a meeting amount the draft never mentions ---
    // Tier 1 (High): inside a sentence pair that WAS compared on money, an
    // amount nobody accounted for has simply been left out ("The total is
    // $4,000 plus a $750 travel fee." -> "Confirming the total is $4,000.").
    // Tier 2 (Low): the amount sits in an unmatched sentence that still
    // belongs to a compared conversation — same speaker turn, or the same
    // fee/item noun as a compared sentence or the draft.
    var draftMoneyArr = [];
    draft.forEach(function (d) { d.facts.money.forEach(function (f) { draftMoneyArr.push(f.value); }); });
    function draftValPresent(v) { return draftMoneyArr.some(function (x) { return Math.abs(x - v) < 0.005; }); }
    function droppedAmountFlag(ms, f, conf) {
      return { type: 'Amount', beta: false, confidence: conf, draftIndex: -1, draftSentence: null, draftSpan: null, draftFactText: null, meetingSentence: ms.text, meetingSpan: fullSpanOf(f), meetingFactText: fullRawOf(ms.text, f), timestamp: ms.timestamp, fix: null, dropped: true };
    }
    function alreadyCited(ms, f) {
      var raw = fullRawOf(ms.text, f);
      return flags.some(function (x) { return x.meetingSentence === ms.text && x.meetingFactText === raw; });
    }
    // fee keys the draft itself denies: a negated fee is adjudicated by the
    // dedicated zero-fee / fee-dropped rules (their flags AND their deliberate
    // silences, e.g. a fee the meeting itself waives) — never by this pass
    var draftZeroKeys = {};
    draft.forEach(function (d) { d.facts.zeroFees.forEach(function (z) { draftZeroKeys[z.key] = 1; }); });
    meeting.forEach(function (ms) {
      if (!matchedMoneyMs[ms.index]) return;
      ms.facts.money.forEach(function (f, fi) {
        if (accountedMF[ms.index + ':' + fi]) return;
        if (draftValPresent(f.value)) return;
        if (alreadyCited(ms, f)) return;
        flags.push(droppedAmountFlag(ms, f, 'High'));
      });
    });
    // speaker turns (contiguous runs of one speaker) that contain a compared sentence
    var blockId = [], blk = 0;
    meeting.forEach(function (ms, i) { if (i > 0 && (ms.speaker || null) !== (meeting[i - 1].speaker || null)) blk++; blockId[i] = blk; });
    var matchedBlocks = {};
    meeting.forEach(function (ms) { if (matchedMs[ms.index] && ms.speaker) matchedBlocks[blockId[ms.index]] = 1; });
    var anchorFeeKeys = {};
    meeting.forEach(function (ms) { if (!matchedMs[ms.index]) return; ms.facts.money.forEach(function (f) { var k = draftFeeKey(ms.text, f.span); if (k) anchorFeeKeys[k] = 1; }); });
    draft.forEach(function (d) {
      d.facts.money.forEach(function (f) { var k = draftFeeKey(d.text, f.span); if (k) anchorFeeKeys[k] = 1; });
      d.facts.zeroFees.forEach(function (z) { anchorFeeKeys[z.key] = 1; });
    });
    meeting.forEach(function (ms) {
      if (matchedMs[ms.index]) return;
      var turnAnchor = !!(ms.speaker && matchedBlocks[blockId[ms.index]]);
      if (!turnAnchor && !Object.keys(anchorFeeKeys).length) return;
      ms.facts.money.forEach(function (f) {
        if (draftValPresent(f.value)) return;
        var fk = draftFeeKey(ms.text, f.span);
        if (fk && (draftZeroKeys[fk] || zeroByKey[fk])) return; // a denied fee belongs to the fee rules, not to this pass
        if (!turnAnchor && !(fk && anchorFeeKeys[fk])) return;
        if (alreadyCited(ms, f)) return;
        flags.push(droppedAmountFlag(ms, f, 'Low'));
      });
    });

    // --- dropped promises (Beta, Low): a meeting promise carrying money/date that the draft never mentions ---
    var draftAllText = draft.map(function (d) { return d.text; }).join(' ');
    var draftMoneyVals = {}, draftDateKeys = {};
    draft.forEach(function (d) {
      d.facts.money.forEach(function (f) { draftMoneyVals[f.value] = 1; });
      d.facts.dates.forEach(function (f) { draftDateKeys[(f.month || '') + '-' + (f.day || '') + '-' + (f.weekday == null ? '' : f.weekday) + '-' + (f.week || '')] = 1; });
    });
    meeting.forEach(function (ms) {
      if (!ms.facts.promise) return;
      var carried = null;
      ms.facts.money.forEach(function (f) { if (!draftMoneyVals[f.value]) carried = { kind: 'money', f: f }; });
      if (!carried) ms.facts.dates.forEach(function (f) { var k = (f.month || '') + '-' + (f.day || '') + '-' + (f.weekday == null ? '' : f.weekday) + '-' + (f.week || ''); if (!draftDateKeys[k]) carried = { kind: 'date', f: f }; });
      if (!carried) return;
      // is any draft sentence about this meeting sentence?
      var bestD = 0, bestDS = null;
      draft.forEach(function (d) { var sc = score(d, ms); if (sc > bestD) { bestD = sc; bestDS = d; } });
      if (bestD >= 0.3) {
        // topical overlap with the sentence is not coverage of THIS commitment:
        // the draft must also touch the carried fact's own clause
        var clauses = ms.text.split(/,?\s+and\s+(?=(?:I|we|you|he|she|they)\b)|;\s*/i);
        var clause = clauses[0], pos = 0;
        for (var ci2 = 0; ci2 < clauses.length; ci2++) { var nx = pos + clauses[ci2].length; if (carried.f.span[0] >= pos && carried.f.span[0] <= nx) { clause = clauses[ci2]; break; } pos = nx + 1; }
        var lt = {}, wm3, wre3 = /[A-Za-z']+/g;
        while ((wm3 = wre3.exec(clause))) { var w4 = wm3[0].toLowerCase(); if (!STOP[w4] && NUMW[w4] === undefined && w4 !== 'hundred' && w4 !== 'thousand' && w4 !== 'million') lt[stem(w4)] = 1; }
        var ltKeys = Object.keys(lt);
        if (!ltKeys.length || (bestDS && ltKeys.some(function (w) { return bestDS.toks[w]; }))) return;
      }
      // already covered by a flag pointing at this meeting sentence?
      var covered = flags.some(function (f) { return f.meetingSentence === ms.text; });
      // or by a flag about the same carried value (the topic was addressed, just changed)?
      if (!covered && carried) {
        covered = flags.some(function (f) {
          if (!f.meetingSentence) return false;
          var host = null;
          meeting.forEach(function (x) { if (x.text === f.meetingSentence) host = x; });
          if (!host) return false;
          if (carried.kind === 'money') return host.facts.money.some(function (x) { return Math.abs(x.value - carried.f.value) < 0.005; });
          return host.facts.dates.some(function (x) { return sameDate(x, carried.f); });
        });
      }
      if (covered) return;
      flags.push({ type: 'Promise', beta: true, confidence: 'Low', draftIndex: -1, draftSentence: null, draftSpan: null, draftFactText: null, meetingSentence: ms.text, meetingSpan: carried.f.span, meetingFactText: carried.f.raw, timestamp: ms.timestamp, fix: null, dropped: true });
    });

    // display sanity: quotes are the matched sentence, never a wall of text
    flags.forEach(function (f) {
      if (f.meetingSentence) { var cq1 = capQuote(f.meetingSentence, f.meetingSpan); f.meetingSentence = cq1.text; f.meetingSpan = cq1.span; }
      if (f.draftSentence) { var cq2 = capQuote(f.draftSentence, f.draftSpan); f.draftSentence = cq2.text; f.draftSpan = cq2.span; }
    });

    flags.sort(function (a, b) {
      var ca = a.confidence === 'High' ? 0 : 1, cb = b.confidence === 'High' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.draftIndex < 0 ? 999 : a.draftIndex) - (b.draftIndex < 0 ? 999 : b.draftIndex);
    });

    return {
      flags: flags,
      stats: { transcriptWords: tWords, draftWords: dWords, truncatedTranscript: tTrunc, truncatedDraft: dTrunc, meetingSentences: meeting.length, draftSentences: draft.length },
      meeting: meeting, draft: draft
    };
  }

  /* ---------------- sample pair ---------------- */
  var SAMPLE = {
    transcript: [
      '[00:00:12] Maya Chen: Thanks for joining, Dana. Let us lock the renewal terms today.',
      '[00:01:03] Dana Park: Sounds good. Budget is the main thing for us this year.',
      '[00:02:31] Maya Chen: For the renewal, we agreed on eight thousand for the year, same as we discussed last month.',
      '[00:03:14] Dana Park: Eight thousand works for us. And onboarding for the new starters is included in that, right?',
      '[00:03:40] Maya Chen: Yes, onboarding is included at no extra charge.',
      '[00:04:22] Maya Chen: On timing, we will send the paperwork in the first week of January so your board can sign off.',
      '[00:05:05] Dana Park: Perfect. Priya will send the signed copy back to you once the board approves.',
      '[00:05:48] Maya Chen: Great, I will prepare everything on my side.'
    ].join('\n'),
    draft: [
      'Hi Maya,',
      '',
      'Confirming our renewal: the fee is $800 for the year, with onboarding included.',
      '',
      'We will have the paperwork signed by December 5. We will also set up a dedicated support hotline, available around the clock.',
      '',
      'Priya will send the signed copy once approved.',
      '',
      'Thanks,',
      'Dana'
    ].join('\n')
  };

  /* ---------------- file parsing (VTT / SRT / TXT) ---------------- */
  function parseSubtitleFile(text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n'), out = [];
    var curTs = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { continue; }
      if (/^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^STYLE\b/.test(line) || /^REGION\b/.test(line)) continue;
      var tm = line.match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]?\d*)\s*-->/);
      if (tm) { curTs = tm[1].replace(',', '.').replace(/\.\d+$/, ''); continue; }
      if (/^\d+$/.test(line)) continue; // SRT cue number
      var voice = null;
      line = line.replace(/<v(?:\.[^>\s]+)?\s+([^>]+)>/gi, function (_, name) { voice = name.trim(); return ''; });
      line = line.replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]?\d*>/g, '');
      line = line.replace(/<[^>]+>/g, '').trim();
      if (!line) continue;
      if (voice) line = voice + ': ' + line;
      out.push((curTs ? '[' + curTs + '] ' : '') + line);
    }
    return out.join('\n');
  }

  return {
    check: check,
    parseLines: parseLines,
    extractFacts: extractFacts,
    SAMPLE: SAMPLE,
    parseSubtitleFile: parseSubtitleFile,
    _internal: { wordVal: wordVal, dateConflict: dateConflict, tokens: tokens }
  };
});
