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
  var ID_KIND = '(?:item|sku|line|part|model|ref|invoice|order|ticket|case|phase)';
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
    // inline bracketed timestamps: a pasted transcript often carries
    // several turns on one physical line ("... March 3. [00:01:30] Let
    // us push it to March 17. [00:02:00] Fine by me."). Give each
    // marker its own line so the per-line timestamp/speaker extraction
    // below sees the same segmentation as the line-per-turn shape —
    // otherwise the turns glue into one sentence, both dates land in
    // a single sentence where chains cannot form, and the verdict
    // depends on the paste format instead of the conversation.
    text = String(text || '').replace(/([^\n])(\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)/g, '$1\n$2');
    var lines = text.split(/\r?\n/), out = [];
    // Otter / Zoom TXT layout: a bare "Name 0:25" header line, its words on
    // the lines after. The header's speaker + timestamp carry onto those
    // lines until the block ends (a blank line, or a line with its own
    // speaker/time). Without this, pasted TXT exports lose their times.
    var pending = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { pending = null; continue; }
      // pasted subtitle text: header / timing / cue-number lines are not sentences
      if (/^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^STYLE\b/.test(line) || /^REGION\b/.test(line)) continue;
      if (/-->/.test(line) && /\d{1,2}:\d{2}/.test(line)) continue;
      if (/^\d{1,4}$/.test(line) && /-->/.test(text)) continue;
      // a <v Name> voice tag names the speaker (Teams VTT); capture it before
      // stripping — the name is the speaker label, not markup to throw away
      var vname = null;
      line = line.replace(/<v(?:\.[^>\s]+)?\s+([^>]+)>/gi, function (_, nm) { if (!vname) vname = nm.trim(); return ' '; });
      // inline subtitle tags never survive into a quote
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
      if (!speaker && vname && !NAME_STOP[vname]) speaker = vname;
      var sents = splitSentences(line);
      if (!sents.length) {
        // a bare name+time header line: carry it forward to its text lines
        if (speaker && ts) pending = { speaker: speaker, ts: ts };
        continue;
      }
      if (pending && !speaker && !ts) { speaker = pending.speaker; ts = pending.ts; }
      else if (speaker || ts) pending = null;
      for (var j = 0; j < sents.length; j++) out.push({ text: sents[j], timestamp: ts, speaker: speaker });
    }
    return mergeTurns(out);
  }
  /* Turn assembly: subtitle cues often split one spoken sentence across two
     lines ("The fee is eight" / "thousand dollars total."). Merge a fragment
     into the previous turn when it is plainly the same utterance: same
     speaker, the previous text carries no sentence-final punctuation, and
     this turn opens with a lowercase continuation. A new sentence — a
     capitalised opening, or anything after a full stop — is never merged,
     and neither is a fragment that follows a complete fact sentence. */
  function mergeTurns(turns) {
    var out = [];
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i], prev = out[out.length - 1];
      if (prev && (prev.speaker || null) === (t.speaker || null)
        && !/[.!?…]["'”’)]?\s*$/.test(prev.text)
        && /^[a-z]/.test(t.text)
        && prev.text.split(/\s+/).length <= 12) {
        prev.text = prev.text + ' ' + t.text;
        continue;
      }
      out.push({ text: t.text, timestamp: t.timestamp, speaker: t.speaker });
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
    // bare ordinal day: "the 12th" with no temporal preposition — once
    // dates are the topic, this is how a day of the month is referred
    // to in ordinary negotiation talk ("What about the 12th?")
    var re8b = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi;
    while ((m = re8b.exec(s))) { var d8b = parseInt(m[1], 10); if (d8b >= 1 && d8b <= 31 && !spans.some(function (sp) { return m.index >= sp[0] && m.index < sp[1]; })) push(m[0], m.index, { day: d8b }); }
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
        facts.counts.push({ value: val, raw: s.slice(mm.index, end), span: [mm.index, end], noun: normNoun(nmW[1]), nounRaw: nmW[1] });
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
    // money: digits + "grand" ("20 grand" = $20,000 — the slang unit is
    // unambiguous money, no sentence context needed)
    var reDG = /\b(\d[\d,]*(?:\.\d+)?)\s+grand\b/gi;
    while ((m = reDG.exec(work))) { var vG = parseFloat(m[1].replace(/,/g, '')) * 1000; facts.money.push({ value: vG, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); }
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
        facts.counts.push({ value: dvv, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length], noun: normNoun(dNounM[1]), nounRaw: dNounM[1] });
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
      // spoken money unit: "twenty grand" = $20,000 (checked before the
      // count-noun branch, which would otherwise file it as 20 "grands")
      if (/^\s+grand\b/i.test(after)) {
        var gEnd = m.index + rawW.length + after.match(/^\s+grand\b/i)[0].length;
        facts.money.push({ value: val * 1000, raw: s.slice(m.index, gEnd), span: [m.index, gEnd] });
        mask(m.index, gEnd); work = masked.join(''); continue;
      }
      var nounM = after.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
      if (nounM && !COUNT_ADJ[nounM[1].toLowerCase()] && !STOP[nounM[1].toLowerCase()] && nounM[1].length >= 3) {
        facts.counts.push({ value: val, raw: s.slice(m.index, m.index + rawW.length), span: [m.index, m.index + rawW.length], noun: normNoun(nounM[1]), nounRaw: nounM[1] });
        mask(m.index, m.index + rawW.length); work = masked.join(''); continue;
      }
      if (nounM && COUNT_ADJ[nounM[1].toLowerCase()]) {
        var noun2 = after.slice(nounM[0].length).match(/^\s+([A-Za-z]+)/);
        if (noun2 && noun2[1].length >= 3 && !STOP[noun2[1].toLowerCase()]) {
          facts.counts.push({ value: val, raw: s.slice(m.index, m.index + rawW.length), span: [m.index, m.index + rawW.length], noun: normNoun(noun2[1]), nounRaw: noun2[1] });
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
      var aft = work.slice(m.index + m[0].length, m.index + m[0].length + 30);
      // "Item 15" is an identifier, not a quantity — but only when the
      // number is NOT followed by a count noun: "order 10 chairs" is the
      // verb "order" with a real quantity, and eating it was a false
      // all-clear on a moved count. Peek at the following word (with the
      // COUNT_ADJ look-through the noun extraction below applies).
      if (new RegExp(ID_KIND + '\\s*#?\\s*$', 'i').test(preC)) {
        var pk = aft.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
        var pkNoun = pk && pk[1];
        if (pkNoun && COUNT_ADJ[pkNoun.toLowerCase()]) { var pk2 = aft.slice(pk[0].length).match(/^\s+([A-Za-z]+)/); pkNoun = pk2 && pk2[1].length >= 3 && !STOP[pk2[1].toLowerCase()] ? pk2[1] : null; }
        if (!(pkNoun && pkNoun.length >= 3 && !STOP[pkNoun.toLowerCase()] && !MONTHS[pkNoun.toLowerCase()] && WEEKDAYS[pkNoun.toLowerCase()] === undefined)) continue;
      }
      var nm = aft.match(/^\s+(?:of\s+the\s+|of\s+)?([A-Za-z]+)/);
      if (!nm) continue;
      var noun = nm[1];
      if (COUNT_ADJ[noun.toLowerCase()]) {
        var nm2 = aft.slice(nm[0].length).match(/^\s+([A-Za-z]+)/);
        if (nm2 && nm2[1].length >= 3 && !STOP[nm2[1].toLowerCase()]) noun = nm2[1]; else continue;
      }
      if (noun.length < 3 || STOP[noun.toLowerCase()] || MONTHS[noun.toLowerCase()] || WEEKDAYS[noun.toLowerCase()] !== undefined) continue;
      facts.counts.push({ value: num, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length], noun: normNoun(noun), nounRaw: noun });
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
    // a money match can swallow the sentence comma that follows the
    // amount ("$18,000, take it or leave it") — the comma is not part
    // of the amount, and fact text is quoted back to the user
    facts.money.forEach(function (f) {
      if (/,$/.test(f.raw)) { f.raw = f.raw.slice(0, -1); if (f.span) f.span = [f.span[0], f.span[1] - 1]; }
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
    var tLimit = opts.transcriptWords || 40000, dLimit = opts.draftWords || 3000;
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
    /* ---- bare-number adoption (pass #9) ----
       A sentence carrying NO extracted value fact can still state a
       value in speech shorthand: "Can you go to eighteen?" in the
       middle of a money negotiation, "Bump it to 30." between two
       counts of users. The lone bare mention is adopted into the one
       kind whose real facts surround it (money or counts — never both,
       that is ambiguous), inheriting the neighbourhood's scale for
       money: beside $20,000, "eighteen" is $18,000 and "eighteen five"
       is $18,500. Anything doubtful — two kinds nearby, several
       numbers, an identifier ("room 12"), a clock reading ("at 5") —
       is left alone: an unadopted number can only cost recall, while
       a wrong adoption could manufacture a fact. */
    function allFactSpans(s) {
      var out = [];
      // names/actors are deliberately absent: a sentence-initial number
      // word ("Eighteen five, final offer.") is also read as a name, and
      // that false name must not block the number's adoption
      ['money', 'counts', 'dates', 'percent', 'terms', 'windows', 'zeroFees'].forEach(function (k) { (s.facts[k] || []).forEach(function (f) { if (f.span) out.push(f.span); }); });
      if (s.facts.included) out.push(s.facts.included.span);
      if (s.facts.billed) out.push(s.facts.billed.span);
      return out;
    }
    function bareMentions(text, spans) {
      var out = [];
      function overlaps(sp) { return spans.some(function (x) { return sp[0] < x[1] && x[0] < sp[1]; }); }
      var m;
      var reD = /\b\d[\d,]*(?:\.\d+)?\b/g;
      while ((m = reD.exec(text))) {
        var sp = [m.index, m.index + m[0].length];
        if (overlaps(sp)) continue;
        var v = parseFloat(m[0].replace(/,/g, ''));
        if (isNaN(v)) continue;
        if (v >= 1900 && v <= 2100 && m[0].indexOf(',') === -1 && m[0].indexOf('.') === -1) continue; // a year
        if (text.charAt(sp[1]) === ':') continue; // a clock time
        out.push({ span: sp, value: v, fiveBase: null });
      }
      var reW2 = new RegExp('\\b' + NUMWORD + '(?![A-Za-z])(?:[-\\s]+' + NUMWORD + '(?![A-Za-z]))*', 'gi');
      while ((m = reW2.exec(text))) {
        var sp2 = [m.index, m.index + m[0].length];
        if (overlaps(sp2)) continue;
        if (out.some(function (o) { return sp2[0] < o.span[1] && o.span[0] < sp2[1]; })) continue;
        var toks = m[0].toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
        var v2 = wordVal(m[0]);
        if (v2 === null) continue;
        var fiveBase = null;
        if (toks.length === 2 && toks[1] === 'five' && NUMW[toks[0]] >= 3 && NUMW[toks[0]] <= 99) fiveBase = NUMW[toks[0]];
        out.push({ span: sp2, value: v2, fiveBase: fiveBase });
      }
      return out;
    }
    function barePositioned(text, mt) {
      var pre = text.slice(0, mt.span[0]);
      if (/\bat\s*$/i.test(pre.slice(-10)) && mt.value <= 24) return false; // "meet at 5": a clock reading
      var preWords = pre.trim().split(/\s+/).filter(Boolean);
      if (preWords.length <= 1) return true; // sentence-initial: the number IS the utterance's point
      if (/\b(to|for|it|down|up|be|do|make)\s*$/i.test(pre.slice(-24))) return true;
      var post = text.slice(mt.span[1]).trim();
      if (post === '' || /^[,.;!?]/.test(post)) return true; // sentence-final
      return false;
    }
    meeting.forEach(function (s, si) {
      if (s.facts.money.length || s.facts.counts.length || s.facts.dates.length || s.facts.percent.length || s.facts.terms.length) return;
      var mentions = bareMentions(s.text, allFactSpans(s));
      if (mentions.length !== 1) return;
      var mt = mentions[0];
      if (/(room|page|chapter|version|step|option|floor|suite|line|part|number|item|unit|level|phase|tier|no)\s*$/i.test(s.text.slice(0, mt.span[0]).slice(-20))) return;
      if (mt.value < 2 && mt.fiveBase === null) return;
      if (/^\s+of\b/i.test(s.text.slice(mt.span[1]))) return; // partitive prose ("one of the best")
      if (!barePositioned(s.text, mt)) return;
      var moneyN = null, countN = null;
      for (var dj = -2; dj <= 2; dj++) {
        if (!dj) continue;
        var ns = meeting[si + dj];
        if (!ns) continue;
        if (!moneyN && ns.facts.money.some(function (f) { return !f.bare; })) moneyN = ns;
        if (!countN && ns.facts.counts.some(function (f) { return !f.bare; })) countN = ns;
      }
      if (!moneyN === !countN) return; // neither kind nearby, or both: ambiguous
      if (moneyN) {
        var vals = [];
        for (var dj2 = -2; dj2 <= 2; dj2++) { var ns2 = meeting[si + dj2]; if (ns2) ns2.facts.money.forEach(function (f) { if (!f.bare) vals.push(f.value); }); }
        var scaleK = vals.length > 0 && vals.every(function (v) { return v >= 1000; });
        var val;
        if (mt.fiveBase !== null) { if (!scaleK) return; val = mt.fiveBase * 1000 + 500; }
        else { val = mt.value; if (scaleK && val < 1000) val = val * 1000; }
        var cur = null;
        moneyN.facts.money.forEach(function (f) { if (!f.bare && cur === null) cur = f.currency; });
        s.facts.money.push({ value: val, raw: s.text.slice(mt.span[0], mt.span[1]), span: mt.span, currency: cur || 'USD', bare: true });
      } else {
        if (mt.fiveBase !== null) return;
        var cf = null;
        countN.facts.counts.forEach(function (f) { if (!f.bare && !cf) cf = f; });
        if (!cf) return;
        // pass #11: the adopted number joins the SOURCE fact's chain —
        // the entry builder gives it the source mention's descriptor
        // (minus the noun), so chain grouping treats it as the same
        // item's next mention instead of vetoing it for having no
        // words of its own. (Computed later: chainDesc's stoplist is
        // only initialised further down check().)
        s.facts.counts.push({ value: mt.value, raw: s.text.slice(mt.span[0], mt.span[1]), span: mt.span, noun: cf.noun, nounRaw: cf.nounRaw, bare: true, joinFrom: { s: countN, f: cf } });
      }
    });
    applyCorrections(meeting);

    /* ---- named options (pass #11) ----
       "Option A is $9,000, option B is $12,000 with training." /
       "We'll take option B." Values enumerated under a named option
       belong to that option; once a later sentence SELECTS one option
       by name, the other options' values retire — they carry no
       authority (no missing flags, no counterparts, no floor rescue),
       exactly like a rejected offer. Facts take the nearest option
       label that precedes them in their own sentence; a selection is
       a verb phrase naming an option ("take option B", "go with
       option A") or a fact-free sentence that is just the choice
       ("Option B."). Fewer than two labelled options, or no
       selection, leaves everything untouched. */
    (function applyOptions() {
      var OPT_RE = /\boption\s+([A-Za-z0-9]+)\b/gi;
      var labelled = {};
      meeting.forEach(function (s) {
        var labs = [], m;
        OPT_RE.lastIndex = 0;
        while ((m = OPT_RE.exec(s.text))) labs.push({ key: m[1].toLowerCase(), end: m.index + m[0].length });
        if (!labs.length) return;
        ['money', 'counts', 'dates', 'percent', 'terms'].forEach(function (k) {
          (s.facts[k] || []).forEach(function (f) {
            var best = null;
            labs.forEach(function (L) { if (L.end <= f.span[0]) best = L; });
            if (best) { f.option = best.key; labelled[best.key] = 1; }
          });
        });
      });
      if (Object.keys(labelled).length < 2) return;
      var selected = null;
      meeting.forEach(function (s) {
        if (selected) return;
        var t = ' ' + s.text.toLowerCase().replace(/’/g, "'") + ' ';
        var m2 = t.match(/\b(?:take|choose|pick|select|go with|want|prefer|taking|choosing)\s+(?:the\s+)?option\s+([a-z0-9]+)\b/);
        if (!m2) {
          var factFree = !s.facts.money.length && !s.facts.counts.length && !s.facts.dates.length && !s.facts.percent.length && !s.facts.terms.length;
          if (factFree) m2 = t.match(/^\s+option\s+([a-z0-9]+)\b/);
        }
        if (m2 && labelled[m2[1]]) selected = m2[1];
      });
      if (!selected) return;
      meeting.forEach(function (s) {
        ['money', 'counts', 'dates', 'percent', 'terms'].forEach(function (k) {
          (s.facts[k] || []).forEach(function (f) { if (f.option && f.option !== selected) f.retired = true; });
        });
      });
    })();

    /* -------- stance + history marking (pass #8) --------
       Which value of an item is final is decided POSITIONALLY (see
       resolveChains below): the latest mention that was not rejected.
       Three marks feed that decision, all read off the sentence itself:
       - history: a past marker BEFORE the value in its sentence ("Last
         year the fee was $10,000.") — the value is quoted as the past,
         not asserted as current. It carries no current authority: it is
         invisible to picks, the floor, confirmations, chains and the
         dropped passes, and is visible only to a draft that frames the
         same value as history too. A marker AFTER the value ("we agreed
         on eight thousand, same as we discussed last month") leaves the
         value current.
       - offer: the sentence is a question, or opens with a proposal
         frame ("How about …", "Can we …") — an offer, not an agreement.
       - rejected: an offer whose immediately following sentence refuses
         it without stating a value of its own ("No, that's too steep.")
         — marked during chain resolution, on the fact itself. */
    var HISTORY_MARK_RE = /\b(last\s+(?:year|month|week|spring|summer|fall|autumn|winter)|previously|originally|formerly|used\s+to|in\s+the\s+past|back\s+then)\b/i;
    function factHistory(s, f) {
      // the marker must belong to the value's own clause: only the ~48
      // chars right before the value are searched, so a marker attached
      // to another clause ("the team originally signed in twenty
      // nineteen … the fee … is $9,000") never retires a current value
      return HISTORY_MARK_RE.test(s.text.slice(Math.max(0, f.span[0] - 48), f.span[0]));
    }
    function offerSentence(s) {
      return /\?\s*$/.test(s.text) || /^\s*(how about|what about|can we|can you|could we|could you|shall we|maybe|perhaps|why not)\b/i.test(s.text);
    }
    var REFUSAL_RE = /^\s*(no|nope|nah)\b|\b(can't|cannot|won't|not possible|too (?:much|high|expensive|steep|low)|doesn't work|not a chance|afraid not|i'?m afraid)\b/i;
    ['money', 'counts', 'dates', 'percent', 'terms'].forEach(function (kind) {
      meeting.forEach(function (s) { s.facts[kind].forEach(function (f) { if (factHistory(s, f)) f.history = true; }); });
    });
    /* Conditional values (pass #9): a value floated under a condition
       ("If you sign for two years it would be $9,000") was never agreed
       as the current term — it is a hypothesis, not a statement. The
       mark needs BOTH halves of the conditional shape: an "if" in the
       sentence and a conditional "would" before the value, so a plain
       statement that merely opens with a condition on something else
       ("If we proceed, the fee is $9,000") keeps its authority.
       Conditional facts are treated like history for authority: they
       never hold it, never rescue, never drop-flag — and a draft that
       asserts the floated value as the agreed term is measured against
       the standing value, exactly like a history quote. */
    function factConditional(s, f) {
      if (!/\bif\b/i.test(s.text)) return false; // an if somewhere in the sentence
      var before = s.text.slice(0, f.span[0]);
      return /\b(would|could|might)\b/i.test(before); // in conditional mood before the value
    }
    ['money', 'counts', 'dates', 'percent', 'terms'].forEach(function (kind) {
      meeting.forEach(function (s) { s.facts[kind].forEach(function (f) { if (factConditional(s, f)) f.conditional = true; }); });
    });
    meeting.forEach(function (s) { s.facts.zeroFees.forEach(function (z) { if (factHistory(s, z)) z.history = true; }); });

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
    meeting.forEach(function (s) { s.facts.zeroFees.forEach(function (z) { if (z.history) return; if (!zeroByKey[z.key]) zeroByKey[z.key] = { s: s, z: z }; }); });
    // charged fees indexed by fee noun, so a draft that denies a fee the
    // meeting charges can be caught in the reverse direction too
    var feeByKey = {};
    meeting.forEach(function (s) { s.facts.money.forEach(function (f) { if (f.history || f.conditional || f.retired) return; var k = draftFeeKey(s.text, f.span); if (k && !feeByKey[k]) feeByKey[k] = { s: s, f: f }; }); });
    // (term days are indexed by OPERATIVE value only, after chain
    // resolution — see operativeTermDays below)
    var agreedTotal = null;
    draft.forEach(function (ds) {
      ds.facts.money.forEach(function (f) {
        if (!tMoneyVals[f.value]) return;
        meeting.forEach(function (ms) {
          if (!ms.facts.money.some(function (x) { return Math.abs(x.value - f.value) < 0.005 && !x.history && !x.rejected && !x.conditional && !x.retired; })) return;
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
    function descSet(text, span, barriers) {
      var lo = Math.max(0, span[0] - 45), hi = Math.min(text.length, span[1] + 45);
      // the window stops at a NEIGHBOURING fact's span: descriptors belong
      // to the fact they sit with, so in "The fee is $10,000 with a $2,000
      // deposit upfront" the deposit's words must not describe the fee —
      // unclipped, they outvoted the fee's own exact match and the draft
      // was accused of changing the fee to the deposit (pass #8, case 4)
      if (barriers) {
        for (var bi = 0; bi < barriers.length; bi++) {
          var b = barriers[bi];
          if (b[0] === span[0] && b[1] === span[1]) continue;
          if (b[1] <= span[0] && b[1] > lo) lo = b[1];
          if (b[0] >= span[1] && b[0] < hi) hi = b[0];
        }
      }
      var set = tokens(text.slice(lo, hi));
      var own = tokens(text.slice(span[0], span[1]));
      for (var w in own) delete set[w];
      return set;
    }
    function factSpans(s, kind) { return (s.facts[kind] || []).map(function (f) { return f.span; }); }
    function descOverlap(d, mf, ms, mFact) {
      var a = descSet(d.text, mf.span, factSpans(d, 'money')), b = descSet(ms.text, mFact.span, factSpans(ms, 'money')), n = 0;
      for (var w in a) if (b[w]) n++;
      return n;
    }
    // hard floor: the draft amount itself is said somewhere in the meeting
    // (same value, no currency contradiction, no period contradiction) — it
    // must never be accused against a DIFFERENT meeting value. Returns the
    // confirming fact (the one the draft value actually matches), or null.
    function floorFact(mf, d) {
      var hit = null, histHit = null;
      meeting.forEach(function (ms) {
        ms.facts.money.forEach(function (g, gi) {
          if (Math.abs(g.value - mf.value) >= 0.005) return;
          if (mf.currency && g.currency && mf.currency !== g.currency) return;
          if (mf.period && g.period && mf.period !== g.period && ANNUAL_FACTOR[mf.period] && ANNUAL_FACTOR[g.period]) return;
          // a rejected offer is not the meeting's truth: it never rescues.
          // A history value rescues only a draft that frames the value as
          // history itself (quoting the past is reference, not error).
          if (g.rejected) return;
          if (g.conditional) return; // a floated value is not the meeting's truth either: it never rescues
          if (g.retired) return; // an unselected option's value is not the meeting's truth either
          if (g.history) { if (!histHit) histHit = { s: ms, fi: gi, f: g }; return; }
          if (!hit) hit = { s: ms, fi: gi, f: g };
        });
      });
      if (hit) return hit;
      if (histHit && d && draftHistoryFramed(d, mf.span)) { histHit.historyFact = true; return histHit; }
      return null;
    }
    function floorHit(mf) { return !!floorFact(mf); }
    // a folded charge is not a counterpart: the draft sentence itself folds
    // the picked item into the draft value (a trailing ", including the
    // blog migration" clause after the amount), and the draft value has an
    // exact home in a different meeting fact — the picked charge belongs
    // to the dropped-amount pass, not to an accusation against the total
    function foldedIntoDraft(d, mf, ms, mFact, home) {
      if (home.s.index === ms.index && home.f === mFact) return false;
      var inc = d.facts.included;
      if (!inc) return false;
      var from = fullSpanOf(mf)[1];
      if (inc.span[0] < from) return false;
      // the separator may ride inside the amount's own raw ("$24,000,")
      if (!/[,;]/.test(d.text.slice(from, inc.span[0])) && !/[,;]\s*$/.test(d.text.slice(0, from))) return false;
      var clauseToks = tokens(d.text.slice(inc.span[0], inc.span[0] + 48));
      var pDesc = descSet(ms.text, mFact.span, factSpans(ms, 'money'));
      return Object.keys(clauseToks).some(function (w) { return pDesc[w] && !CHAIN_GENERIC[w]; });
    }
    // matched-pair bookkeeping for the dropped-amount pass: which meeting
    // sentences were actually compared against, and which of their money
    // facts were accounted for by a comparison
    var matchedMs = {}, matchedMoneyMs = {}, accountedMF = {};
    // a floor-rescued comparison accounted for the CONFIRMING fact, not the
    // picked one: transfer the credit, so the dropped-amount pass still sees
    // the picked fact as uncovered (it was compared, never accounted for)
    function settleOutcome(pick, outcome) {
      if (!outcome || !outcome.floored) return;
      var fe = outcome.floored;
      // a history confirmation settles nothing about the picked fact: the
      // draft was quoting the past, not asserting the current value, so
      // the picked fact keeps its accounting (otherwise the dropped pass
      // would accuse the current fee as "missing" from a history quote)
      if (fe.f.history) return;
      if (fe.s.index === pick.s.index && fe.fi === pick.fi) return;
      delete accountedMF[pick.s.index + ':' + pick.fi];
      accountedMF[fe.s.index + ':' + fe.fi] = 1;
      matchedMs[fe.s.index] = 1; matchedMoneyMs[fe.s.index] = 1;
    }
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
      // if the same figure also appears elsewhere in another role (a deposit).
      // When the floor does rescue the draft value, the rescue is credited to
      // the fact the value actually matches — the picked fact was compared
      // but NOT accounted for, and the caller re-assigns the accounting, so
      // a picked fact the draft never really covered (a charge folded into
      // a total) still surfaces in the dropped-amount pass.
      var ff = floorFact(mf, d);
      // a history rescue is unambiguous reference (the draft frames the
      // value as the past and the meeting said it as the past): it applies
      // even when the pairing is descriptor-confident — the exception
      // below exists for values reused in a different CURRENT role
      if (ff && ff.historyFact) return { floored: ff };
      if (!(pickDesc >= 2)) {
        if (ff) return { floored: ff };
      } else {
        if (ff && foldedIntoDraft(d, mf, ms, mFact, ff)) return { floored: ff };
      }
      addFlag({ type: 'Amount', beta: false, confidence: conf, draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: ms.text, meetingSpan: mFact.span, meetingFactText: mFact.raw, timestamp: ms.timestamp, fix: fixNumFor(d.text, mf.span, mf.raw, mFact) });
    }

    /* -------- superseded values: the LAST mention of an item wins --------
       When the same item is priced (or counted, or dated) more than once in
       the meeting with different values, the earlier values are stages of a
       negotiation, not confirmations: a draft that uses one is using a
       number the meeting moved on from, and the said-elsewhere floor must
       not rescue it. Mentions chain in document order — two mentions chain
       when they sit in different sentences, carry no conflicting
       identifier, and their local descriptor words do not contradict (one
       side may refine the other or be bare; two differently-named items
       never chain). Self-corrections were already retired by
       applyCorrections, so chains span only mentions no marker touched. */
    var CHAIN_GENERIC = {};
    // generic amount vocabulary, period/unit words, and speech-act or
    // discourse words — everything that is not an item's own name. ('fee'
    // is deliberately absent: a fee and a deposit are different items, and
    // mentions that name the fee must not chain onto a deposit.)
    ['total', 'price', 'cost', 'charge', 'amount', 'quote', 'rate', 'pay', 'payment', 'bill', 'billing', 'budget', 'ceiling', 'sum', 'worth', 'invoice', 'per', 'month', 'year', 'week', 'day', 'night', 'hour', 'quarter', 'seat', 'person', 'guest', 'head', 'ticket', 'dollar', 'euro', 'pound', 'say', 'ask', 'get', 'give', 'take', 'make', 'come', 'go', 'put', 'set', 'let', 'plus', 'also', 'confirm', 'mention', 'state', 'write', 'talk', 'need', 'want', 'agree', 'instead', 'rather', 'later', 'dont', 'cant', 'wont', 'isnt', 'arent', 'didnt', 'doesnt', 'couldnt', 'wouldnt', 'shouldnt', 'havent', 'hasnt', 'wasnt', 'werent', 'thats', 'move', 'shift', 'switch', 'change', 'reschedule', 'decide', 'choose', 'pick', 'postpone', 'delay', 'bring', 'settle', 'push', 'pull', 'extend', 'sign', 'work', 'better', 'meet', 'middle', 'tops', 'bump', 'booked', 'keep', 'afraid', 'understand', 'understood', 'launch', 'deal', 'problem', 'sounds', 'agreed', 'done', 'sure', 'okay', 'ok', 'yes', 'yeah'].forEach(function (w) { CHAIN_GENERIC[stem(w)] = 1; });
    var HISTORY_TOK = {};
    ['last', 'previous', 'previously', 'original', 'originally', 'earlier', 'prior', 'former', 'history', 'historical'].forEach(function (w) { HISTORY_TOK[stem(w)] = 1; });
    // closing / agreement language adjusts CONFIDENCE only (a superseded
    // flag is High when the operative sentence closes the matter); it never
    // selects which value is final — position does that (see resolveChains)
    var FINALITY_RE = /\b(okay|ok|deal|final|finally|agreed|agree|go with|locked|settled?|confirmed|sure|fine|works for me|sounds good|cap)\b/i;
    // rule B's restatement test (pass #11): agreement words that mean
    // the closing line itself settled the value — without the bare
    // assent/discourse words (okay / sure / fine) that can just as
    // easily open an offer
    var NEG_FINALITY_RE = /\b(deal|final|finally|agreed|agree|go with|locked|settled?|confirmed)\b/i;
    function chainDesc(text, span, maskSpans) {
      // other facts in the same sentence are masked out of the window:
      // their surface forms (a second date's weekday name, a second
      // amount's number words) are VALUES, not descriptors of this
      // item — leaving them in splits chains that are really one
      // negotiation ("Thursday is booked, let us keep Tuesday" must
      // chain its two dates together, not veto on each other's names)
      var src = text;
      if (maskSpans && maskSpans.length) {
        var chars = text.split('');
        maskSpans.forEach(function (sp) { if (!sp) return; if (sp[0] === span[0] && sp[1] === span[1]) return; for (var ci = sp[0]; ci < sp[1] && ci < chars.length; ci++) chars[ci] = ' '; });
        src = chars.join('');
      }
      // a tight +-28 char window, trimmed to word boundaries so a cut word
      // never becomes a phantom descriptor
      var lo = Math.max(0, span[0] - 28), hi = Math.min(text.length, span[1] + 28);
      var slice = src.slice(lo, hi);
      if (lo > 0) { var c1 = slice.indexOf(' '); if (c1 >= 0) slice = slice.slice(c1 + 1); }
      if (hi < text.length) { var c2 = slice.lastIndexOf(' '); if (c2 >= 0) slice = slice.slice(0, c2); }
      // apostrophes are stripped AFTER slicing (offsets stay valid):
      // "let's" then tokenises as the stopword "lets", not as junk
      var set = tokens(slice.replace(/['’]/g, ''));
      var own = tokens(text.slice(span[0], span[1]).replace(/['’]/g, ''));
      for (var w in own) delete set[w];
      var out = {};
      // contraction remnants ("let'" from "let's") are speech noise, never
      // item descriptors — they must not break a chain
      for (var w2 in set) if (!CHAIN_GENERIC[w2] && w2.indexOf("'") === -1) out[w2] = 1;
      // a sentence-INITIAL discourse token is speech framing, not an item
      // descriptor: "Actually, can we make it Monday?" is about the same
      // signing date as "Let's sign by Friday." — the opener must not split
      // the chain. Position is the signal (first word of the sentence),
      // plus question auxiliaries in a question sentence ("How about …?",
      // "What about …?"). This only loosens GROUPING; which value is final
      // is decided positionally in resolveChains.
      var firstM = text.match(/^\s*([A-Za-z']+)/);
      if (firstM) {
        var fw = stem(firstM[1].toLowerCase().replace(/^[-']+|[-']+$/g, ''));
        var DISC_INIT = { actual: 1, well: 1, so: 1, okay: 1, ok: 1, now: 1, anyway: 1, sure: 1, fine: 1, great: 1, perfect: 1, right: 1, yes: 1, yeah: 1, deal: 1, hmm: 1 };
        var Q_INIT = { how: 1, what: 1, can: 1, could: 1, would: 1, shall: 1, should: 1, do: 1, does: 1, is: 1, are: 1, why: 1, when: 1, who: 1 };
        if (DISC_INIT[fw] || (/\?\s*$/.test(text) && Q_INIT[fw])) delete out[fw];
      }
      return out;
    }
    function descCompatible(a, b) {
      var aOnly = Object.keys(a).some(function (w) { return !b[w]; });
      var bOnly = Object.keys(b).some(function (w) { return !a[w]; });
      return !(aOnly && bOnly);
    }
    /* Per-fact identifiers (pass #11): a sentence can price several
       items at once ("Phase 1 is $6,000, phase 2 is $8,000, phase 3
       is $5,000.") — the sentence-level id map keeps only the LAST
       id of each kind, so every fact in it inherits the wrong item.
       Each fact instead takes the id named in its own segment of the
       sentence (between the neighbouring facts), preferring the label
       that precedes it ("phase 2 is $7,000") and falling back to one
       that follows it ("$7,000 for phase 2"). No local label: the
       sentence-level map stands, exactly as before. */
    function factIds(s, f) {
      var all = [];
      ['money', 'counts', 'dates', 'percent', 'terms'].forEach(function (k) { (s.facts[k] || []).forEach(function (g) { all.push(g); }); });
      all.sort(function (a, b) { return a.span[0] - b.span[0]; });
      var pos = all.indexOf(f);
      if (pos < 0) return s.ids;
      var segStart = pos > 0 ? all[pos - 1].span[1] : 0;
      var segEnd = pos < all.length - 1 ? all[pos + 1].span[0] : s.text.length;
      var re = new RegExp('\\b' + ID_KIND + '\\s*#?\\s*([A-Za-z0-9][A-Za-z0-9-]*)', 'gi');
      var ids = {}, m, found = false;
      function take(mm) { var kind = mm[0].match(/^[A-Za-z]+/)[0].toLowerCase(); ids[kind + ':' + mm[1].toLowerCase()] = kind; found = true; }
      var before = s.text.slice(segStart, f.span[0]);
      while ((m = re.exec(before))) { if (/\d/.test(m[1])) take(m); }
      if (!found) {
        var after = s.text.slice(f.span[1], segEnd), m2 = re.exec(after);
        if (m2 && /\d/.test(m2[1])) take(m2);
      }
      return found ? ids : s.ids;
    }
    /* A conditional fact's descriptor comes from its own CLAUSE, not
       the whole sentence (pass #11): in "If we commit to three years,
       $42,000 a year?" the condition clause ("commit to three years")
       is the deal's terms of acceptance, not the item's name — letting
       it into the descriptor splits the value away from the standing
       price it negotiates against, and the accepted deal then never
       chains. The value's own clause is what the value is about. */
    function clauseDesc(s, f) {
      var text = s.text;
      var b0 = Math.max(text.lastIndexOf(',', f.span[0]), text.lastIndexOf(';', f.span[0])) + 1;
      var b1 = text.length;
      [',', ';'].forEach(function (ch) { var ix = text.indexOf(ch, f.span[1]); if (ix >= 0 && ix < b1) b1 = ix; });
      var sub = text.slice(b0, b1);
      var spans = allFactSpans(s).filter(function (sp) { return sp[0] >= b0 && sp[1] <= b1; }).map(function (sp) { return [sp[0] - b0, sp[1] - b0]; });
      return chainDesc(sub, [f.span[0] - b0, f.span[1] - b0], spans);
    }
    function buildChains(entries) {
      var chains = [];
      entries.forEach(function (e) {
        var placed = false;
        // a mention whose value already appears in a chain restates or
        // confirms that mention ("Okay, $9,000 it is" after the $9,000
        // ask) — it belongs to that chain, never to a different item's
        // chain where it would pose as that item's replacement
        if (typeof e.f.value === 'number') {
          for (var vi = chains.length - 1; vi >= 0 && !placed; vi--) {
            var vc = chains[vi], vlast = vc[vc.length - 1];
            if (vlast.s.index === e.s.index) continue;
            if (idTier(e.ids || e.s.ids, vlast.ids || vlast.s.ids) === 0) continue;
            if (!descCompatible(e.desc, vlast.desc)) continue;
            var hasVal = vc.some(function (g) { return g.s.index !== e.s.index && typeof g.f.value === 'number' && Math.abs(g.f.value - e.f.value) < 0.005; });
            if (!hasVal) continue;
            vc.push(e); placed = true;
          }
        }
        for (var ci = chains.length - 1; ci >= 0 && !placed; ci--) {
          var ch = chains[ci], last = ch[ch.length - 1];
          if (last.s.index === e.s.index) continue;
          if (idTier(e.ids || e.s.ids, last.ids || last.s.ids) === 0) continue;
          if (!descCompatible(e.desc, last.desc)) continue;
          ch.push(e); placed = true; break;
        }
        if (!placed) chains.push([e]);
      });
      return chains;
    }
    function restatesValue(finS, finF, value) {
      // the "final" sentence itself restates the old value alongside the
      // new one ("Two thousand deposit, nine thousand total") — that is a
      // summary keeping both figures alive, not a replacement
      var lists = [finS.facts.money, finS.facts.counts];
      for (var li = 0; li < lists.length; li++) {
        var arr = lists[li] || [];
        for (var i = 0; i < arr.length; i++) { if (arr[i] !== finF && Math.abs(arr[i].value - value) < 0.005) return true; }
      }
      return false;
    }
    function refOnlySkip(dDesc, eDesc, finDesc) {
      // the draft frames the old mention as history in words the final
      // mention dropped ("last year the fee was ...") — quoting the past
      // is reference, not error
      return Object.keys(dDesc).some(function (w) { return HISTORY_TOK[w] && eDesc[w] && !finDesc[w]; });
    }
    function entryKey(e) { return e.s.index + ':' + e.fi; }
    function draftHistoryFramed(d, span) {
      // the draft itself frames this value as the past (a history marker
      // before it, or history words in its descriptor window)
      if (HISTORY_MARK_RE.test(d.text.slice(0, span[0]))) return true;
      var dd = chainDesc(d.text, span);
      return Object.keys(dd).some(function (w) { return HISTORY_TOK[w]; });
    }
    function chainContradicts(dDesc, e, chainOf) {
      // the draft positively names a DIFFERENT item than this chain is
      // about: its descriptors share nothing with any mention in the
      // chain, while the chain's operative mention carries descriptors of
      // its own. A bare draft, a bare operative mention, or any shared
      // word means position rules — never a descriptor veto.
      if (!Object.keys(dDesc).length) return false;
      var ch = chainOf[entryKey(e)] || [e];
      var shared = ch.some(function (g) { return Object.keys(dDesc).some(function (w) { return g.desc[w]; }); });
      if (shared) return false;
      return Object.keys(ch[ch.length - 1].desc).length > 0;
    }
    /* ---- bare assent (pass #9): the closing EVENT ----
       Real agreement usually carries no number: "Yeah." / "Fine by
       me." / "Done." A sentence is a PURE ASSENT when it is nothing
       but agreement — no facts of any value kind, and its whole text
       is one of a small closed class of assent forms. Three traps are
       built into the test:
       - hedge: an assent word followed by qualification ("Yeah, but
         that's too tight", "Okay, let me check with finance", "Sure,
         I'll think about it") is NOT agreement — HEDGE_RE vetoes it
         before the form test, and the exact-match form test vetoes
         anything with content of its own;
       - speaker: handled in resolveChains (the other side must say
         yes; unlabelled closures are capped at Low);
       - proximity: an assent only ever closes the offer whose
         sentence it IMMEDIATELY follows (index + 1) — the same
         discipline rejections already had. */
    var ASSENT_SET = {};
    ['yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'fine', 'done', 'agreed', 'perfect', 'great', 'right', 'correct', 'absolutely', 'definitely', 'certainly', 'understood', 'confirmed', 'deal', 'works',
     'works for me', 'fine by me', 'fine with me', 'sounds good', 'sounds great', 'no problem', 'that works', 'thats fine', 'thats ok', 'thats okay', 'thats good', 'thats right', 'all good', 'good for me', 'lets do it', 'i agree', 'we agree', 'sure thing', 'of course', 'will do', 'okay then', 'fine then', 'agreed then', 'yes please',
     'you have a deal', 'we have a deal', 'its a deal'
    ].forEach(function (w) { ASSENT_SET[w] = 1; });
    ['yeah', 'yes', 'ok', 'okay'].forEach(function (a) { ['sure', 'fine', 'ok', 'okay', 'done', 'agreed', 'great', 'perfect', 'right'].forEach(function (b) { ASSENT_SET[a + ' ' + b] = 1; }); });
    // stacked assent (pass #10): a reply built ENTIRELY of assent words
    // is agreement in any order — "Okay, fine." / "Sure, fine." /
    // "Fine, okay." / "Okay, deal." The exact-match set above only
    // covers the orders someone enumerated; composing from the token
    // class covers them all. The hedge veto still runs FIRST, so a
    // second assent word never masquerades as a hedge and a real hedge
    // ("Hmm, fine, I'll ask") still closes nothing.
    var ASSENT_TOKENS = {};
    ['yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'fine', 'done', 'agreed', 'perfect', 'great', 'right', 'correct', 'absolutely', 'definitely', 'certainly', 'understood', 'confirmed', 'deal', 'works'].forEach(function (w) { ASSENT_TOKENS[w] = 1; });
    var HEDGE_RE = /\bbut\b|\bhmm\b|\bmaybe\b|\bperhaps\b|\bprobably\b|\blet me\b|\bi'?ll\s+(ask|check|think|confirm)\b|\bthink about\b|\bnot sure\b|\bget back\b|\bneed to\s+(ask|check|confirm)\b|\bhave to\s+(ask|check|confirm)\b|\bcheck with\b|\bask\s+(with|first|around)\b|\bi wonder\b/i;
    function assentInfo(s) {
      if (!s || s.facts.money.length || s.facts.counts.length || s.facts.dates.length || s.facts.percent.length) return false;
      var norm = s.text.replace(/’/g, "'");
      if (HEDGE_RE.test(norm)) return false;
      var t = norm.toLowerCase().replace(/['']/g, '').replace(/[!.,;:?]+/g, ' ').replace(/\s+/g, ' ').trim();
      t = t.replace(/\s+(thanks|thank you)$/, '').trim();
      if (ASSENT_SET[t] === 1) return true;
      var words = t.split(' ').filter(function (w) { return w.length; });
      if (words.length >= 2 && words.length <= 3 && words.every(function (w) { return ASSENT_TOKENS[w]; })) return true;
      return false;
    }
    function supConfidence(fin) {
      // an unlabelled bare-assent closure caps the flag at Low when
      // the operative mention is an OFFER (the flag exists only
      // because of that closure, and without speaker labels the
      // "okay" might be the offerer's own); a labelled other-side
      // closure is full finality evidence. A STATEMENT operative
      // never needed the assent to stand, so its own finality words
      // decide, exactly as before.
      if (fin.assentCapped && fin.offer) return 'Low';
      if (fin.assentClosed && !fin.assentCapped) return 'High';
      // a standing value an explicit, unhedged refusal settled (the
      // competing offer was refused outright, no counter needed) is
      // final on the refusal's evidence, not merely positional
      if (fin.settledByRefusal) return 'High';
      return FINALITY_RE.test(fin.s.text) ? 'High' : 'Low';
    }
    /* Anaphoric cancellation (pass #10): a retraction in the sentence
       right after a mention — "scrap that", "scratch that", "forget
       that", "never mind", "scrap it" — withdraws that mention
       WITHOUT naming its value ("Thursday is better." / "Scrap
       that."). The mention is marked rejected during chain
       resolution, so the value it displaced stands again and a later
       assent confirms it. "Don't forget that …" is a reminder, not a
       retraction, and never cancels. */
    var CANCEL_RE = /\b(?:scrap|scratch|forget)\s+(?:that|it)\b|\bnever\s+mind\b/i;
    function cancelSentence(s) {
      if (/\b(?:don'?t|do\s+not)\s+forget\b/i.test(s.text)) return false;
      return CANCEL_RE.test(s.text);
    }
    /* Standing framing (pass #11): a value inside a retraction
       sentence is re-asserted only when the sentence frames it as
       standing — "Wednesday it stays", "keep Wednesday" — not when
       it is merely mentioned ("I have a board meeting Thursday"). */
    function standingFraming(text, g) {
      var after = text.slice(g.span[1], g.span[1] + 30).toLowerCase();
      var before = text.slice(Math.max(0, g.span[0] - 18), g.span[0]).toLowerCase();
      if (/^\s*it\s+(stays|remains|stands|is)\b/.test(after)) return true;
      if (/^\s*(stays|remains|stands)\b/.test(after)) return true;
      if (/\b(keep|stick with|sticking with)\s*$/.test(before)) return true;
      return false;
    }
    /* Positional resolution (pass #8, extended pass #9):
       within a chain, history mentions, conditional mentions and
       rejected offers drop out of authority; the operative value is
       the LATEST remaining mention — offers included, because an
       unrejected, unreplaced offer stands until something later
       replaces it. An offer still pending at the end of the chain is
       a PENDING OFFER: a bare assent in the very next sentence closes
       it (that offer becomes the final value, even though the assent
       repeats no number); without a close there is no honest final
       value — the chain is UNCERTAIN and drafts touching either value
       get a Low flag showing both lines. Agreement language never
       selects the value; it closes offers and sets confidence. */
    function resolveChains(chains, kind, differs, supMap, uncMap, chainOf, restates, info) {
      chains.forEach(function (ch) {
        ch.forEach(function (e) { chainOf[entryKey(e)] = ch; });
      });
      var allEntries = [];
      chains.forEach(function (ch) { ch.forEach(function (e) { allEntries.push(e); }); });
      function entryOfFact(fact) {
        for (var i = 0; i < allEntries.length; i++) if (allEntries[i].f === fact) return allEntries[i];
        return null;
      }
      function chainValKey(k, f) {
        if (k === 'terms') return 't' + f.days;
        if (k === 'dates') return 'd' + (f.month || '') + '-' + (f.day || '') + '-' + (f.weekday == null ? '' : f.weekday) + '-' + (f.week || '');
        return 'v' + f.value;
      }
      function factTextOf(k, e) {
        if (k === 'money') return fullRawOf(e.s.text, e.f);
        if (k === 'counts') return e.f.raw + ' ' + (e.f.nounRaw || e.f.noun);
        return e.f.raw;
      }
      function moveInto(entry, target) {
        if (!entry || !target || chainOf[entryKey(entry)] === target) return;
        var from = chainOf[entryKey(entry)];
        if (from) { var ix = from.indexOf(entry); if (ix >= 0) from.splice(ix, 1); }
        var pos = target.length;
        for (var i = 0; i < target.length; i++) {
          var g = target[i];
          if (g.s.index > entry.s.index || (g.s.index === entry.s.index && g.f.span[0] > entry.f.span[0])) { pos = i; break; }
        }
        target.splice(pos, 0, entry);
        chainOf[entryKey(entry)] = target;
      }
      // rejection marking (proximity discipline: only the sentence
      // immediately after the offer can refuse it)
      allEntries.forEach(function (e) {
        if (e.history || e.conditional || !e.offer) return;
        var nxt = meeting[e.s.index + 1];
        if (!nxt || !REFUSAL_RE.test(nxt.text)) return;
        if (assentInfo(nxt)) return; // "No problem." is an acceptance wearing a refusal's clothes
        // a refusal sentence that restates the offer's OWN value is a
        // self-correction or acceptance of it, not a cancellation;
        // any other refusal cancels the offer — including one that
        // carries a counter-value (the counter stands as its own
        // entry; the offer is still refused)
        if (nxt.facts[kind].some(function (g) { return !differs(g, e.f); })) return;
        e.rejected = true; e.f.rejected = true;
        // pass #10: a bare refusal — no counter-value of this kind in
        // the refusing sentence, and no hedge in it either — settles
        // the standing value outright (see supConfidence)
        if (!nxt.facts[kind].length && !HEDGE_RE.test(nxt.text)) e.refusalClean = true;
      });
      /* Anaphoric cancellation (pass #10): a retraction marker in the
         sentence immediately after a mention withdraws the LATEST
         mention of that sentence, without naming its value. The
         withdrawn mention is marked rejected, exactly like a refused
         offer, so the value it displaced stands again. A retraction
         sentence that re-asserts the same value keeps it instead. */
      var latestBySentence = {};
      allEntries.forEach(function (e) {
        if (e.history || e.conditional || e.rejected) return;
        var cur = latestBySentence[e.s.index];
        if (!cur || e.f.span[0] > cur.f.span[0]) latestBySentence[e.s.index] = e;
      });
      Object.keys(latestBySentence).forEach(function (k) {
        var e = latestBySentence[k], nxt = meeting[e.s.index + 1];
        if (!nxt || !cancelSentence(nxt)) return;
        // pass #11: a value the retraction sentence merely MENTIONS is
        // incidental — it does not revive the mention being withdrawn.
        // Only an explicit standing framing re-asserts a value, and
        // only that value. Incidental mentions of the cancelled value
        // inside the retraction sentence are withdrawn along with it,
        // so the mention cannot resurrect the value by position.
        var mentions = (nxt.facts[kind] || []).filter(function (g) { return !differs(g, e.f); });
        if (mentions.some(function (g) { return standingFraming(nxt.text, g); })) return;
        e.rejected = true; e.f.rejected = true;
        mentions.forEach(function (g) {
          var ge = entryOfFact(g);
          if (ge && ge !== e) { ge.rejected = true; ge.f.rejected = true; }
          g.rejected = true;
        });
      });
      /* Accepted conditional offers (pass #11): a value floated under
         a condition ("If we commit to three years, could we do
         $42,000 a year?") is hypothetical only while it hangs. When
         the very next sentence is a pure assent — the deal line —
         the offer was accepted, condition and all, and joins
         authority like any other closed offer. An unaccepted
         conditional stays excluded, exactly as before. */
      allEntries.forEach(function (e) {
        if (!e.conditional || !e.offer || e.history || e.rejected || e.retired) return;
        var nxt = meeting[e.s.index + 1];
        if (nxt && assentInfo(nxt)) { e.conditional = false; e.f.conditional = false; }
      });
      /* Answer-sentence bridges. Descriptor grouping can strand the
         sentence that ANSWERS an offer in a chain of its own (its
         vocabulary is refusal speech, not the item's), and the values
         it carries then resolve in the wrong negotiation. The answer
         belongs to the offer it answers — positionally, not by
         wording:
         A) counter bridge — a refusal sentence carrying exactly one
            value of this kind: that value is the counter, and joins
            the refused offer's chain;
         B) reversal bridge — the answering sentence names the offered
            value AND restates a value the offer's chain already holds
            ("Thursday is booked, let us keep Tuesday"): the offer is
            refused and both mentions join its chain, so the restated
            (kept) value can become operative by position. */
      allEntries.forEach(function (e) {
        if (e.history || e.conditional || !e.offer) return;
        var ch = chainOf[entryKey(e)], nxt = meeting[e.s.index + 1];
        if (!ch || !nxt) return;
        var nFacts = nxt.facts[kind] || [];
        if (e.rejected && nFacts.length === 1 && differs(nFacts[0], e.f)) {
          moveInto(entryOfFact(nFacts[0]), ch);
          return;
        }
        var namesOffer = nFacts.some(function (g) { return !differs(g, e.f); });
        if (!namesOffer) return;
        var kept = nFacts.filter(function (g) {
          return differs(g, e.f) && ch.some(function (g2) { return g2.s.index < nxt.index && !differs(g2.f, g); });
        });
        if (!kept.length) return;
        e.rejected = true; e.f.rejected = true;
        nFacts.forEach(function (g) {
          var ge = entryOfFact(g);
          moveInto(ge, ch);
          // the answer sentence's own mention of the offered value is
          // the dismissal itself ("Thursday is booked") — it carries
          // no authority either, and leaving it live would make the
          // sentence read as a summary that keeps both values alive
          if (ge && ge !== e && !differs(g, e.f)) { ge.rejected = true; ge.f.rejected = true; }
        });
      });
      chains.forEach(function (ch) {
        // chain info (pass #10): the resolved shape of this chain is
        // exported on the check result, so the estate-wide invariant
        // can verify that no flag ever quotes a superseded entry
        var rec = { operative: null, superseded: [], uncertain: [] };
        if (info) info.push(rec);
        rec.entries = ch.map(entryKey);
        var authority = ch.filter(function (e) { return !e.history && !e.conditional && !e.rejected && !e.retired; });
        if (authority.length < 1) return;
        var operative = authority[authority.length - 1];
        rec.operative = entryKey(operative);
        // bare-assent closing: the sentence immediately after the
        // operative mention is a pure assent. With speaker labels on
        // both sides it must come from a DIFFERENT speaker than the
        // operative mention's (the offerer saying "okay" to their own
        // proposal closes nothing); with a label missing on either
        // side it still closes, but capped (see supConfidence).
        var nxtS = meeting[operative.s.index + 1];
        if (nxtS && assentInfo(nxtS)) {
          var spA = operative.s.speaker || null, spB = nxtS.speaker || null;
          if (!(spA && spB && spA === spB)) {
            operative.assentClosed = true;
            operative.assentCapped = !(spA && spB);
          }
        }
        // refusal-settled (pass #10): this operative stands because a
        // competing offer was refused outright — explicit, unhedged,
        // no counter needed. Flags resting on it carry full finality.
        if (!operative.offer && ch.some(function (e) { return e.rejected && e.refusalClean && differs(e.f, operative.f); })) operative.settledByRefusal = true;
        // pass #11: whether the operative's authority was CLOSED by an
        // assent or a settling refusal — the finalisation pass uses
        // it to tell a closed question-offer (the deal's own record,
        // High stands) from a question that merely hangs (never
        // evidence for a High flag)
        rec.closed = !!(operative.assentClosed || operative.settledByRefusal);
        if (operative.offer && !operative.assentClosed) {
          var standing = null;
          authority.forEach(function (e) { if (!e.offer && differs(e.f, operative.f)) standing = e; });
          if (standing) {
            authority.forEach(function (e) {
              if (e !== operative && e !== standing && differs(e.f, operative.f) && differs(e.f, standing.f)) supMap[entryKey(e)] = standing;
            });
            uncMap[entryKey(standing)] = { standing: standing, offer: operative };
            uncMap[entryKey(operative)] = { standing: standing, offer: operative };
            // a refused value is not one of the two live candidates,
            // but a draft asserting it is still not all-clear: it gets
            // the same Low uncertainty display
            ch.forEach(function (e) {
              if (e.rejected && differs(e.f, operative.f) && differs(e.f, standing.f)) uncMap[entryKey(e)] = { standing: standing, offer: operative };
            });
            rec.uncertain = [entryKey(standing), entryKey(operative)];
            return;
          }
        }
        authority.forEach(function (e) {
          if (!differs(e.f, operative.f)) return;
          // a "final" sentence that itself restates the old value
          // alongside the new one is a summary keeping both figures
          // alive, not a replacement — the old value is not superseded
          if (restates && restates(e, operative)) return;
          supMap[entryKey(e)] = operative;
        });
        // a refused offer is settled business: a draft that asserts
        // the refused value is wrong against the value the meeting
        // actually settled on (never against a still-pending offer —
        // there is no settled value to quote then)
        if (!(operative.offer && !operative.assentClosed)) {
          ch.forEach(function (e) {
            if (e.rejected && differs(e.f, operative.f)) supMap[entryKey(e)] = operative;
          });
        }
        ch.forEach(function (e) { if (supMap[entryKey(e)] === operative) rec.superseded.push(entryKey(e)); });
        // negotiated topic (pass #11, rule B): three or more distinct
        // values were on the table for this one thing and the winner
        // is an OFFER whose only authority is a bare-assent closure —
        // the number was haggled to, never restated in a closing
        // statement. Flags on such a chain present the whole sequence
        // at Low instead of accusing at High (finalisation pass). A
        // closing that restates the value ("Deal at $9,000") is a
        // statement operative, not an offer, and never lands here.
        var seenVal = {}, seq = [], lastK = null;
        ch.forEach(function (e) {
          if (e.history || e.conditional || e.retired) return;
          var k2 = chainValKey(kind, e.f);
          seenVal[k2] = 1;
          if (k2 === lastK) return;
          lastK = k2;
          seq.push({ text: factTextOf(kind, e), sentence: e.s.text, timestamp: e.s.timestamp || null });
        });
        if (Object.keys(seenVal).length >= 3 && operative.assentClosed && !NEG_FINALITY_RE.test(operative.s.text)) {
          rec.negotiated = true;
          rec.sequence = seq;
        }
      });
    }
    var moneyEntries = [];
    meeting.forEach(function (s) { s.facts.money.forEach(function (f, fi) { moneyEntries.push({ s: s, f: f, fi: fi, desc: f.conditional ? clauseDesc(s, f) : chainDesc(s.text, f.span, allFactSpans(s)), offer: offerSentence(s), history: !!f.history, conditional: !!f.conditional, ids: factIds(s, f), retired: !!f.retired }); }); });
    var supersededMoney = {};   // entryKey -> the operative entry of its chain
    var uncertainMoney = {};    // entryKey -> { standing, offer } for chains with no honest final value
    var chainOfMoney = {};
    var infoMoney = [];
    resolveChains(buildChains(moneyEntries), 'money', function (a, b) { return Math.abs(a.value - b.value) >= 0.005; }, supersededMoney, uncertainMoney, chainOfMoney, function (e, op) { return restatesValue(op.s, op.f, e.f.value); }, infoMoney);
    var countEntriesByNoun = {};
    meeting.forEach(function (s) {
      s.facts.counts.forEach(function (f, fi) {
        var desc;
        if (f.joinFrom) { // adopted bare number: the source mention's descriptor (pass #11)
          desc = chainDesc(f.joinFrom.s.text, f.joinFrom.f.span, allFactSpans(f.joinFrom.s));
          delete desc[f.noun]; delete desc[stem(f.noun)];
        } else {
          desc = f.conditional ? clauseDesc(s, f) : chainDesc(s.text, f.span, allFactSpans(s));
          delete desc[f.noun]; delete desc[stem(f.noun)];
        }
        (countEntriesByNoun[f.noun] = countEntriesByNoun[f.noun] || []).push({ s: s, f: f, fi: fi, desc: desc, offer: offerSentence(s), history: !!f.history, conditional: !!f.conditional, ids: factIds(s, f), retired: !!f.retired });
      });
    });
    var supersededCounts = {};
    var uncertainCounts = {};
    var chainOfCounts = {};
    var infoCounts = [];
    Object.keys(countEntriesByNoun).forEach(function (noun) {
      resolveChains(buildChains(countEntriesByNoun[noun]), 'counts', function (a, b) { return Math.abs(a.value - b.value) >= 0.005; }, supersededCounts, uncertainCounts, chainOfCounts, function (e, op) { return restatesValue(op.s, op.f, e.f.value); }, infoCounts);
    });
    var dateEntries = [];
    meeting.forEach(function (s) { s.facts.dates.forEach(function (f, fi) { dateEntries.push({ s: s, f: f, fi: fi, desc: f.conditional ? clauseDesc(s, f) : chainDesc(s.text, f.span, allFactSpans(s)), offer: offerSentence(s), history: !!f.history, conditional: !!f.conditional, ids: factIds(s, f), retired: !!f.retired }); }); });
    var supersededDates = {};
    var uncertainDates = {};
    var chainOfDates = {};
    var infoDates = [];
    resolveChains(buildChains(dateEntries), 'dates', function (a, b) { return dateConflict(a, b); }, supersededDates, uncertainDates, chainOfDates, function (e, op) { return op.s.facts.dates.some(function (g) { return g !== op.f && sameDate(g, e.f); }); }, infoDates);
    /* Percent and payment terms join chain resolution (pass #10):
       until now a renegotiated percent never chained at all — the
       comparison quoted the FIRST percent it paired with, so a
       settled 12% was flagged against the opening 10% (a backwards
       flag on a correct draft), and a superseded "net 30" was
       silently accepted wherever it appeared. Both kinds now get the
       full machinery: standing / offer / pending / assent / refusal /
       history / operative, keyed by descriptor like money. */
    var percentEntries = [];
    meeting.forEach(function (s) { s.facts.percent.forEach(function (f, fi) { percentEntries.push({ s: s, f: f, fi: fi, desc: f.conditional ? clauseDesc(s, f) : chainDesc(s.text, f.span, allFactSpans(s)), offer: offerSentence(s), history: !!f.history, conditional: !!f.conditional, ids: factIds(s, f), retired: !!f.retired }); }); });
    var supersededPercent = {};
    var uncertainPercent = {};
    var chainOfPercent = {};
    var infoPercent = [];
    function restatesPercent(op, value) { return op.s.facts.percent.some(function (g) { return g !== op.f && Math.abs(g.value - value) < 0.005; }); }
    resolveChains(buildChains(percentEntries), 'percent', function (a, b) { return Math.abs(a.value - b.value) >= 0.005; }, supersededPercent, uncertainPercent, chainOfPercent, function (e, op) { return restatesPercent(op, e.f.value); }, infoPercent);
    var termEntries = [];
    meeting.forEach(function (s) { s.facts.terms.forEach(function (f, fi) { termEntries.push({ s: s, f: f, fi: fi, desc: f.conditional ? clauseDesc(s, f) : chainDesc(s.text, f.span, allFactSpans(s)), offer: offerSentence(s), history: !!f.history, conditional: !!f.conditional, ids: factIds(s, f), retired: !!f.retired }); }); });
    var supersededTerms = {};
    var uncertainTerms = {};
    var chainOfTerms = {};
    var infoTerms = [];
    function restatesTerm(op, days) { return op.s.facts.terms.some(function (g) { return g !== op.f && g.days === days; }); }
    resolveChains(buildChains(termEntries), 'terms', function (a, b) { return a.days !== b.days; }, supersededTerms, uncertainTerms, chainOfTerms, function (e, op) { return restatesTerm(op, e.f.days); }, infoTerms);
    // term days the meeting actually settled on — the only ones a
    // draft may use without a comparison (a superseded or refused
    // term said somewhere in the meeting is NOT an acceptance)
    var operativeTermDays = {};
    termEntries.forEach(function (e) { if (!e.history && !e.rejected && !e.conditional && !e.retired && !supersededTerms[entryKey(e)] && !uncertainTerms[entryKey(e)]) operativeTermDays[e.f.days] = 1; });
    var supersededCited = {};   // final facts a supersession flag already explains
    function moneySuperseded(mf, d) {
      var dDesc = chainDesc(d.text, mf.span, allFactSpans(d)), found = null;
      moneyEntries.forEach(function (e) {
        if (found) return;
        var fin = supersededMoney[e.s.index + ':' + e.fi];
        if (!fin) return;
        if (Math.abs(e.f.value - mf.value) >= 0.005) return;
        if (mf.currency && e.f.currency && mf.currency !== e.f.currency) return;
        if (mf.period && e.f.period && mf.period !== e.f.period) return;
        if (mf.period && fin.f.period && mf.period !== fin.f.period) return;
        if (restatesValue(fin.s, fin.f, e.f.value)) return;
        if (refOnlySkip(dDesc, e.desc, fin.desc)) return;
        if (chainContradicts(dDesc, e, chainOfMoney)) return;
        var confirmed = moneyEntries.some(function (g) {
          if (supersededMoney[g.s.index + ':' + g.fi]) return false;
          if (g.history || g.rejected || g.conditional || g.retired) return false;
          if (Math.abs(g.f.value - mf.value) >= 0.005) return false;
          if (mf.currency && g.f.currency && mf.currency !== g.f.currency) return false;
          if (mf.period && g.f.period && mf.period !== g.f.period) return false;
          return descCompatible(dDesc, g.desc);
        });
        if (!confirmed) found = fin;
      });
      return found;
    }
    function moneyUncertain(mf, d) {
      var dDesc = chainDesc(d.text, mf.span, allFactSpans(d)), found = null;
      moneyEntries.forEach(function (e) {
        if (found) return;
        var unc = uncertainMoney[entryKey(e)];
        if (!unc) return;
        if (Math.abs(e.f.value - mf.value) >= 0.005) return;
        if (mf.currency && e.f.currency && mf.currency !== e.f.currency) return;
        if (mf.period && e.f.period && mf.period !== e.f.period) return;
        if (chainContradicts(dDesc, e, chainOfMoney)) return;
        found = unc;
      });
      return found;
    }
    function countSuperseded(cf, d) {
      var dDesc = chainDesc(d.text, cf.span, allFactSpans(d));
      delete dDesc[cf.noun]; delete dDesc[stem(cf.noun)];
      var entries = countEntriesByNoun[cf.noun] || [], found = null;
      entries.forEach(function (e) {
        if (found) return;
        var fin = supersededCounts[e.s.index + ':' + e.fi];
        if (!fin) return;
        if (Math.abs(e.f.value - cf.value) >= 0.005) return;
        if (restatesValue(fin.s, fin.f, e.f.value)) return;
        if (refOnlySkip(dDesc, e.desc, fin.desc)) return;
        if (chainContradicts(dDesc, e, chainOfCounts)) return;
        var confirmed = entries.some(function (g) {
          if (supersededCounts[g.s.index + ':' + g.fi]) return false;
          if (g.history || g.rejected || g.conditional || g.retired) return false;
          if (Math.abs(g.f.value - cf.value) >= 0.005) return false;
          return descCompatible(dDesc, g.desc);
        });
        if (!confirmed) found = fin;
      });
      return found;
    }
    function countUncertain(cf, d) {
      var dDesc = chainDesc(d.text, cf.span, allFactSpans(d));
      delete dDesc[cf.noun]; delete dDesc[stem(cf.noun)];
      var entries = countEntriesByNoun[cf.noun] || [], found = null;
      entries.forEach(function (e) {
        if (found) return;
        var unc = uncertainCounts[entryKey(e)];
        if (!unc) return;
        if (Math.abs(e.f.value - cf.value) >= 0.005) return;
        if (chainContradicts(dDesc, e, chainOfCounts)) return;
        found = unc;
      });
      return found;
    }
    function dateSuperseded(dtf, d) {
      var dDesc = chainDesc(d.text, dtf.span, allFactSpans(d)), found = null;
      dateEntries.forEach(function (e) {
        if (found) return;
        var fin = supersededDates[e.s.index + ':' + e.fi];
        if (!fin) return;
        if (!sameDate(e.f, dtf)) return;
        if (!dateConflict(dtf, fin.f) || dateConsistent(fin.f, dtf)) return;
        // the final sentence restating both dates is a summary keeping
        // both alive, not a replacement — UNLESS the co-mentioned date
        // is itself superseded by this same operative entry: then the
        // sentence names the old value only to dismiss it ("Thursday
        // is booked, let us keep Tuesday"), which is a refusal, not a
        // summary
        if (fin.s.facts.dates.some(function (g) {
          if (g === fin.f || !sameDate(g, e.f)) return false;
          var gFin = supersededDates[fin.s.index + ':' + fin.s.facts.dates.indexOf(g)];
          return gFin !== fin;
        })) return;
        if (refOnlySkip(dDesc, e.desc, fin.desc)) return;
        if (chainContradicts(dDesc, e, chainOfDates)) return;
        var confirmed = dateEntries.some(function (g) {
          if (supersededDates[g.s.index + ':' + g.fi]) return false;
          if (g.history || g.rejected || g.conditional || g.retired) return false;
          if (!sameDate(g.f, dtf) && !dateConsistent(g.f, dtf)) return false;
          return descCompatible(dDesc, g.desc);
        });
        if (!confirmed) found = fin;
      });
      return found;
    }
    function dateUncertain(dtf, d) {
      var dDesc = chainDesc(d.text, dtf.span, allFactSpans(d)), found = null;
      dateEntries.forEach(function (e) {
        if (found) return;
        var unc = uncertainDates[entryKey(e)];
        if (!unc) return;
        if (!sameDate(e.f, dtf)) return;
        if (chainContradicts(dDesc, e, chainOfDates)) return;
        found = unc;
      });
      return found;
    }
    function percentSuperseded(pf, d) {
      var dDesc = chainDesc(d.text, pf.span, allFactSpans(d)), found = null;
      percentEntries.forEach(function (e) {
        if (found) return;
        var fin = supersededPercent[entryKey(e)];
        if (!fin) return;
        if (Math.abs(e.f.value - pf.value) >= 0.005) return;
        if (restatesPercent(fin, e.f.value)) return;
        if (refOnlySkip(dDesc, e.desc, fin.desc)) return;
        if (chainContradicts(dDesc, e, chainOfPercent)) return;
        var confirmed = percentEntries.some(function (g) {
          if (supersededPercent[entryKey(g)]) return false;
          if (g.history || g.rejected || g.conditional || g.retired) return false;
          if (Math.abs(g.f.value - pf.value) >= 0.005) return false;
          return descCompatible(dDesc, g.desc);
        });
        if (!confirmed) found = fin;
      });
      return found;
    }
    function percentUncertain(pf, d) {
      var dDesc = chainDesc(d.text, pf.span, allFactSpans(d)), found = null;
      percentEntries.forEach(function (e) {
        if (found) return;
        var unc = uncertainPercent[entryKey(e)];
        if (!unc) return;
        if (Math.abs(e.f.value - pf.value) >= 0.005) return;
        if (chainContradicts(dDesc, e, chainOfPercent)) return;
        found = unc;
      });
      return found;
    }
    function termSuperseded(tf, d) {
      var dDesc = chainDesc(d.text, tf.span, allFactSpans(d)), found = null;
      termEntries.forEach(function (e) {
        if (found) return;
        var fin = supersededTerms[entryKey(e)];
        if (!fin) return;
        if (e.f.days !== tf.days) return;
        if (restatesTerm(fin, e.f.days)) return;
        if (refOnlySkip(dDesc, e.desc, fin.desc)) return;
        if (chainContradicts(dDesc, e, chainOfTerms)) return;
        var confirmed = termEntries.some(function (g) {
          if (supersededTerms[entryKey(g)]) return false;
          if (g.history || g.rejected || g.conditional || g.retired) return false;
          if (g.f.days !== tf.days) return false;
          return descCompatible(dDesc, g.desc);
        });
        if (!confirmed) found = fin;
      });
      return found;
    }
    function termUncertain(tf, d) {
      var dDesc = chainDesc(d.text, tf.span, allFactSpans(d)), found = null;
      termEntries.forEach(function (e) {
        if (found) return;
        var unc = uncertainTerms[entryKey(e)];
        if (!unc) return;
        if (e.f.days !== tf.days) return;
        if (chainContradicts(dDesc, e, chainOfTerms)) return;
        found = unc;
      });
      return found;
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
          // superseded value: this amount was mentioned for the same item
          // and then replaced later in the meeting — the last mention is
          // the operative one, and no said-elsewhere rescue applies
          var sup = moneySuperseded(mf, d);
          if (sup) {
            var supFix = (mf.period && sup.f.period && mf.period !== sup.f.period && ANNUAL_FACTOR[mf.period] && ANNUAL_FACTOR[sup.f.period])
              ? fixNumFor(d.text, mf.span, mf.raw, { value: sup.f.value * ANNUAL_FACTOR[sup.f.period] / ANNUAL_FACTOR[mf.period], currency: sup.f.currency })
              : fixNumFor(d.text, mf.span, mf.raw, sup.f);
            addFlag({ type: 'Amount', beta: false, confidence: supConfidence(sup), superseded: true, draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: sup.s.text, meetingSpan: sup.f.span, meetingFactText: sup.f.raw, timestamp: sup.s.timestamp, fix: supFix });
            supersededCited[sup.s.index + ':' + sup.fi] = 1;
            return;
          }
          // uncertain chain: the meeting ends on an offer that was never
          // accepted or replaced, with an earlier statement still
          // standing — there is no honest final value, so the flag is
          // Low and shows BOTH lines (earlier, then later)
          var unc = moneyUncertain(mf, d);
          if (unc) {
            addFlag({ type: 'Amount', beta: false, confidence: 'Low', uncertain: true, draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: unc.offer.s.text, meetingSpan: unc.offer.f.span, meetingFactText: unc.offer.f.raw, timestamp: unc.offer.s.timestamp, earlierSentence: unc.standing.s.text, earlierSpan: unc.standing.f.span, earlierFactText: unc.standing.f.raw, earlierTimestamp: unc.standing.s.timestamp, fix: null });
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
              if (fact.history || fact.rejected || fact.conditional || fact.retired) return; // no current authority: never a counterpart
              totalFacts++;
              if (usedMF[c.s.index + ':' + fi]) return;
              options.push({ s: c.s, sc: c.sc, tier: c.tier, fact: fact, fi: fi, desc: descOverlap(d, mf, c.s, fact), exact: (Math.abs(fact.value - mf.value) < 0.005 && !(mf.currency && fact.currency && mf.currency !== fact.currency)) ? 1 : 0 });
            });
          });
          options.sort(function (a, b) { return (b.tier - a.tier) || (b.desc - a.desc) || (b.exact - a.exact) || (b.sc - a.sc) || (a.s.index - b.s.index) || (a.fi - b.fi); });
          var pick = options.length ? options[0] : null;
          // global rule: a superseded value is never quoted as the
          // meeting's truth — when the pick lands on one, the chain's
          // operative entry is the counterpart instead
          if (pick) {
            var supFin = supersededMoney[pick.s.index + ':' + pick.fi];
            if (supFin && !usedMF[supFin.s.index + ':' + supFin.fi]) {
              // the pairing evidence (context score, id tier) was earned
              // against the chain through the superseded mention and
              // transfers to the operative entry — the operative's own
              // sentence may share no words with the draft at all
              // ("Deal at $9,000.")
              pick = { s: supFin.s, sc: pick.sc, tier: pick.tier, fact: supFin.f, fi: supFin.fi, desc: descOverlap(d, mf, supFin.s, supFin.f), exact: (Math.abs(supFin.f.value - mf.value) < 0.005 && !(mf.currency && supFin.f.currency && mf.currency !== supFin.f.currency)) ? 1 : 0 };
            }
          }
          if (pick && pick.sc >= 0.12) {
            usedMF[pick.s.index + ':' + pick.fi] = 1;
            matchedMs[pick.s.index] = 1; matchedMoneyMs[pick.s.index] = 1; accountedMF[pick.s.index + ':' + pick.fi] = 1;
            settleOutcome(pick, compareMoney(d, mf, pick.s, pick.fact, pick.sc, false, pick.desc));
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
            settleOutcome(pick, compareMoney(d, mf, pick.s, pick.fact, pick.sc, totalFacts !== 1, pick.desc));
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
          // superseded percent: the same item was re-quoted later in
          // the meeting — the chain's operative percent is the truth
          var psup = percentSuperseded(pf, d);
          if (psup) {
            addFlag({ type: 'Quantity', beta: false, confidence: supConfidence(psup), superseded: true, draftIndex: d.index, draftSentence: d.text, draftSpan: pf.span, draftFactText: pf.raw, meetingSentence: psup.s.text, meetingSpan: psup.f.span, meetingFactText: psup.f.raw, timestamp: psup.s.timestamp, fix: fixNumFor(d.text, pf.span, pf.raw, psup.f) });
            return;
          }
          // uncertain chain (see money): Low flag, both lines shown
          var punc = percentUncertain(pf, d);
          if (punc) {
            addFlag({ type: 'Quantity', beta: false, confidence: 'Low', uncertain: true, draftIndex: d.index, draftSentence: d.text, draftSpan: pf.span, draftFactText: pf.raw, meetingSentence: punc.offer.s.text, meetingSpan: punc.offer.f.span, meetingFactText: punc.offer.f.raw, timestamp: punc.offer.s.timestamp, earlierSentence: punc.standing.s.text, earlierSpan: punc.standing.f.span, earlierFactText: punc.standing.f.raw, earlierTimestamp: punc.standing.s.timestamp, fix: null });
            return;
          }
          var cands = candsFor('percent', pf.span);
          for (var pci = 0; pci < cands.length; pci++) {
            if (cands[pci].sc < 0.12) break;
            // only operative facts speak for the meeting: history,
            // refused and floated percents are not counterparts
            var authP = cands[pci].s.facts.percent.filter(function (x) { return !x.history && !x.rejected && !x.conditional && !x.retired; });
            if (!authP.length) continue;
            matchedMs[cands[pci].s.index] = 1;
            if (authP.some(function (x) { return Math.abs(x.value - pf.value) < 0.005; })) return;
            var pm = authP[0], pmS = cands[pci].s;
            // never quote a superseded percent as the meeting's
            // truth: the chain's operative mention is the counterpart
            var pFin = supersededPercent[cands[pci].s.index + ':' + cands[pci].s.facts.percent.indexOf(pm)];
            if (pFin) { pm = pFin.f; pmS = pFin.s; }
            if (Math.abs(pm.value - pf.value) < 0.005) return; // the draft matches the operative value
            addFlag({ type: 'Quantity', beta: false, confidence: confOf(cands[pci].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: pf.span, draftFactText: pf.raw, meetingSentence: pmS.text, meetingSpan: pm.span, meetingFactText: pm.raw, timestamp: pmS.timestamp, fix: fixNumFor(d.text, pf.span, pf.raw, pm) });
            return;
          }
        });
      }
      // --- counts by noun ---
      if (df.counts.length) {
        df.counts.forEach(function (cf) {
          // superseded count: the same item was counted again later with a
          // different number — the last count is the operative one
          var csup = countSuperseded(cf, d);
          if (csup) {
            addFlag({ type: 'Quantity', beta: false, confidence: supConfidence(csup), superseded: true, draftIndex: d.index, draftSentence: d.text, draftSpan: cf.span, draftFactText: cf.raw + ' ' + (cf.nounRaw || cf.noun), meetingSentence: csup.s.text, meetingSpan: csup.f.span, meetingFactText: csup.f.raw + ' ' + (csup.f.nounRaw || csup.f.noun), timestamp: csup.s.timestamp, fix: fixNumFor(d.text, cf.span, cf.raw, csup.f) });
            return;
          }
          // uncertain chain (see money): Low flag, both lines shown
          var cunc = countUncertain(cf, d);
          if (cunc) {
            addFlag({ type: 'Quantity', beta: false, confidence: 'Low', uncertain: true, draftIndex: d.index, draftSentence: d.text, draftSpan: cf.span, draftFactText: cf.raw + ' ' + (cf.nounRaw || cf.noun), meetingSentence: cunc.offer.s.text, meetingSpan: cunc.offer.f.span, meetingFactText: cunc.offer.f.raw + ' ' + (cunc.offer.f.nounRaw || cunc.offer.f.noun), timestamp: cunc.offer.s.timestamp, earlierSentence: cunc.standing.s.text, earlierSpan: cunc.standing.f.span, earlierFactText: cunc.standing.f.raw + ' ' + (cunc.standing.f.nounRaw || cunc.standing.f.noun), earlierTimestamp: cunc.standing.s.timestamp, fix: null });
            return;
          }
          // only operative facts speak for the meeting: history and
          // rejected counts are not counterparts (a history-framed draft
          // may still quote the past — reference, not assertion)
          var framed = draftHistoryFramed(d, cf.span);
          var usable = function (x) { return x.noun === cf.noun && (framed || (!x.history && !x.rejected && !x.conditional && !x.retired)); };
          var cands = candsFor('counts', cf.span, usable);
          cands = cands.filter(function (c) { return c.tier !== 0; }); // never compare across different identifiers
          for (var cix = 0; cix < cands.length; cix++) {
            if (cands[cix].sc < 0.12) break;
            var cs2 = cands[cix].s;
            var same = cs2.facts.counts.filter(usable);
            if (!same.length) continue;
            matchedMs[cs2.index] = 1;
            var hit = same.some(function (x) { return Math.abs(x.value - cf.value) < 0.005; });
            if (hit) return;
            var cm2 = same[0], cm2s = cs2;
            // the counts floor, mirroring money: the same count for the
            // same noun stands elsewhere in the meeting (in a mention
            // that was not itself superseded, refused or quoted as
            // history) — never accuse it against this candidate. Like
            // money's floor it YIELDS when the pairing itself is
            // descriptor-confident: "the venue holds 120 guests" pairs
            // with the venue's own 200 by name, and the dinner's 120
            // (same noun, different item) must not rescue it
            var saidElsewhere = (countEntriesByNoun[cf.noun] || []).some(function (g) {
              return !supersededCounts[g.s.index + ':' + g.fi] && !g.history && !g.rejected && !g.conditional && !g.retired && Math.abs(g.f.value - cf.value) < 0.005;
            });
            if (saidElsewhere) {
              // the draft's value IS this candidate's own chain-final
              // (the meeting moved 10 -> 12 and the draft uses 12): the
              // floor always rescues. It yields only when the rescuing
              // value belongs to a different item/mention AND the pairing
              // is descriptor-confident
              var cm2fin = supersededCounts[cs2.index + ':' + cs2.facts.counts.indexOf(cm2)];
              if (cm2fin && Math.abs(cm2fin.f.value - cf.value) < 0.005) return;
              var cdA = descSet(d.text, cf.span, factSpans(d, 'counts')); delete cdA[cf.noun]; delete cdA[stem(cf.noun)];
              var cdB = descSet(cs2.text, cm2.span, factSpans(cs2, 'counts')); delete cdB[cm2.noun]; delete cdB[stem(cm2.noun)];
              var pickDescC = Object.keys(cdA).filter(function (w) { return cdB[w]; }).length;
              if (pickDescC < 2) return;
            }
            // never quote a superseded count as the meeting's truth: the
            // chain's operative mention is the counterpart instead
            for (var six = 0; six < same.length; six++) {
              var cFin = supersededCounts[cs2.index + ':' + cs2.facts.counts.indexOf(same[six])];
              if (cFin) { cm2 = cFin.f; cm2s = cFin.s; break; }
            }
            addFlag({ type: 'Quantity', beta: false, confidence: confOf(cands[cix].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: cf.span, draftFactText: cf.raw + ' ' + (cf.nounRaw || cf.noun), meetingSentence: cm2s.text, meetingSpan: cm2.span, meetingFactText: cm2.raw + ' ' + (cm2.nounRaw || cm2.noun), timestamp: cm2s.timestamp, fix: fixNumFor(d.text, cf.span, cf.raw, cm2) });
            return;
          }
        });
      }
      // --- payment terms ("net 30" vs "net 60") ---
      if (df.terms.length) {
        df.terms.forEach(function (tf) {
          // superseded term: the payment window was renegotiated —
          // the chain's operative term is the meeting's truth
          var tsup = termSuperseded(tf, d);
          if (tsup) {
            addFlag({ type: 'Date', beta: false, confidence: supConfidence(tsup), superseded: true, draftIndex: d.index, draftSentence: d.text, draftSpan: tf.span, draftFactText: tf.raw, meetingSentence: tsup.s.text, meetingSpan: tsup.f.span, meetingFactText: tsup.f.raw, timestamp: tsup.s.timestamp, fix: fixFor(d.text, tf.span, tsup.f.raw) });
            return;
          }
          // uncertain chain (see money): Low flag, both lines shown
          var tunc = termUncertain(tf, d);
          if (tunc) {
            addFlag({ type: 'Date', beta: false, confidence: 'Low', uncertain: true, draftIndex: d.index, draftSentence: d.text, draftSpan: tf.span, draftFactText: tf.raw, meetingSentence: tunc.offer.s.text, meetingSpan: tunc.offer.f.span, meetingFactText: tunc.offer.f.raw, timestamp: tunc.offer.s.timestamp, earlierSentence: tunc.standing.s.text, earlierSpan: tunc.standing.f.span, earlierFactText: tunc.standing.f.raw, earlierTimestamp: tunc.standing.s.timestamp, fix: null });
            return;
          }
          if (operativeTermDays[tf.days]) return; // the settled term is said somewhere in the meeting
          var cands = candsFor('terms', tf.span);
          for (var tci = 0; tci < cands.length; tci++) {
            if (cands[tci].sc < 0.12) break;
            // only operative facts speak for the meeting: history,
            // refused and floated terms are not counterparts
            var authT = cands[tci].s.facts.terms.filter(function (x) { return !x.history && !x.rejected && !x.conditional && !x.retired; });
            if (!authT.length) continue;
            matchedMs[cands[tci].s.index] = 1;
            var tmf = authT[0], tmS = cands[tci].s;
            // never quote a superseded term as the meeting's truth:
            // the chain's operative mention is the counterpart
            var tFin = supersededTerms[cands[tci].s.index + ':' + cands[tci].s.facts.terms.indexOf(tmf)];
            if (tFin) { tmf = tFin.f; tmS = tFin.s; }
            if (tmf.days === tf.days) return;
            addFlag({ type: 'Date', beta: false, confidence: confOf(cands[tci].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: tf.span, draftFactText: tf.raw, meetingSentence: tmS.text, meetingSpan: tmf.span, meetingFactText: tmf.raw, timestamp: tmS.timestamp, fix: fixFor(d.text, tf.span, tmf.raw) });
            return;
          }
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
          if (hit && hit.f.rejected) hit = null; // the meeting refused this fee: the draft is right to deny it
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
          // superseded date: the same item was re-dated later in the
          // meeting — the last date is the operative one
          var dsup = dateSuperseded(dtf, d);
          if (dsup) {
            addFlag({ type: 'Date', beta: false, confidence: supConfidence(dsup), superseded: true, draftIndex: d.index, draftSentence: d.text, draftSpan: dtf.span, draftFactText: dtf.raw, meetingSentence: dsup.s.text, meetingSpan: dsup.f.span, meetingFactText: dsup.f.raw, timestamp: dsup.s.timestamp, fix: fixFor(d.text, dtf.span, dsup.f.raw) });
            return;
          }
          // uncertain chain (see money): Low flag, both lines shown
          var dunc = dateUncertain(dtf, d);
          if (dunc) {
            addFlag({ type: 'Date', beta: false, confidence: 'Low', uncertain: true, draftIndex: d.index, draftSentence: d.text, draftSpan: dtf.span, draftFactText: dtf.raw, meetingSentence: dunc.offer.s.text, meetingSpan: dunc.offer.f.span, meetingFactText: dunc.offer.f.raw, timestamp: dunc.offer.s.timestamp, earlierSentence: dunc.standing.s.text, earlierSpan: dunc.standing.f.span, earlierFactText: dunc.standing.f.raw, earlierTimestamp: dunc.standing.s.timestamp, fix: null });
            return;
          }
          // a draft that frames the date as history is quoting the past,
          // not asserting it as current — reference, not error
          if (draftHistoryFramed(d, dtf.span)) return;
          var dDesc = chainDesc(d.text, dtf.span, allFactSpans(d));
          var cands = candsFor('dates', dtf.span);
          var firstClash = null, examined = 0;
          for (var ci = 0; ci < cands.length; ci++) {
            if (cands[ci].sc < 0.12) break;
            // only operative facts speak for the meeting: history,
            // rejected and superseded dates are not its current truth
            var csD = cands[ci].s;
            var darr = csD.facts.dates.filter(function (x, xi) {
              return !x.history && !x.rejected && !x.conditional && !supersededDates[csD.index + ':' + xi];
            });
            if (!darr.length) continue;
            examined++;
            matchedMs[csD.index] = 1;
            var conf = null;
            for (var di = 0; di < darr.length; di++) { if (sameDate(darr[di], dtf) || dateConsistent(darr[di], dtf)) { conf = darr[di]; break; } }
            if (conf) {
              // a confirming mention rescues the draft: immediately when
              // it is the best-matching candidate, otherwise when its
              // chain does not positively contradict the draft's item —
              // so a clash with one item's date can never pre-empt the
              // confirming mention of the draft's own item (the backwards
              // date flag), and a different item's date never rescues
              var confEntry = null;
              dateEntries.forEach(function (e) { if (e.s === csD && e.f === conf) confEntry = e; });
              if (examined === 1 || !confEntry || !chainContradicts(dDesc, confEntry, chainOfDates)) return;
            }
            if (!firstClash) {
              for (var i2 = 0; i2 < darr.length; i2++) { if (dateConflict(dtf, darr[i2])) { firstClash = { s: csD, sc: cands[ci].sc, f: darr[i2] }; break; } }
            }
          }
          if (firstClash) {
            // pass #11: the candidate loop breaks at the first
            // low-context sentence, so a confirming mention that
            // shares no words with the draft ("May 5 it is." after
            // "The deadline is April 28.") is never examined, and the
            // clash with the OLD date becomes a backwards flag on a
            // correct draft. Before the clash may fire, scan every
            // candidate for a confirming operative date under the
            // same discipline as the in-loop rescue: it rescues
            // unless its chain positively contradicts the draft's
            // item (a different item's date never rescues).
            var rescued = false;
            for (var ci2 = 0; ci2 < cands.length && !rescued; ci2++) {
              var csD2 = cands[ci2].s;
              var darr2 = csD2.facts.dates.filter(function (x, xi) {
                return !x.history && !x.rejected && !x.conditional && !x.retired && !supersededDates[csD2.index + ':' + xi];
              });
              for (var di2 = 0; di2 < darr2.length; di2++) {
                if (!(sameDate(darr2[di2], dtf) || dateConsistent(darr2[di2], dtf))) continue;
                var confEntry2 = null;
                dateEntries.forEach(function (e) { if (e.s === csD2 && e.f === darr2[di2]) confEntry2 = e; });
                if (!confEntry2 || !chainContradicts(dDesc, confEntry2, chainOfDates)) rescued = true;
                break;
              }
            }
            if (rescued) return;
            addFlag({ type: 'Date', beta: false, confidence: confOf(firstClash.sc), draftIndex: d.index, draftSentence: d.text, draftSpan: dtf.span, draftFactText: dtf.raw, meetingSentence: firstClash.s.text, meetingSpan: firstClash.f.span, meetingFactText: firstClash.f.raw, timestamp: firstClash.s.timestamp, fix: fixFor(d.text, dtf.span, firstClash.f.raw) });
            return;
          }
          // fallback pairing for dates, mirroring money's: no candidate
          // scored high enough to pair, but the meeting (after
          // corrections and resolution) holds exactly ONE operative date
          // and the draft contradicts it — a moved date whose surviving
          // lines share no words with the draft is still a moved date
          var opDates = [];
          dateEntries.forEach(function (e) { if (!e.history && !e.rejected && !e.conditional && !e.retired && !supersededDates[entryKey(e)]) opDates.push(e); });
          var distinctOp = [];
          opDates.forEach(function (e) { if (!distinctOp.some(function (g) { return sameDate(g.f, e.f); })) distinctOp.push(e); });
          if (distinctOp.length === 1 && opDates.length) {
            var opE = opDates[opDates.length - 1];
            if (dateConflict(dtf, opE.f) && !dateConsistent(opE.f, dtf)) {
              addFlag({ type: 'Date', beta: false, confidence: supConfidence(opE), draftIndex: d.index, draftSentence: d.text, draftSpan: dtf.span, draftFactText: dtf.raw, meetingSentence: opE.s.text, meetingSpan: opE.f.span, meetingFactText: opE.f.raw, timestamp: opE.s.timestamp, fix: fixFor(d.text, dtf.span, opE.f.raw) });
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
          // evidence honesty: when a meeting sentence genuinely matches
          // this claim's topic, the card quotes it — the meeting may well
          // have said the opposite — and "nothing in the meeting record"
          // is reserved for claims with no counterpart at all
          var evS = (best.s && best.sc >= 0.10) ? best.s : null;
          addFlag({ type: 'Promise', beta: true, confidence: absent.length >= Math.ceil(toksArr.length * 0.6) ? 'High' : 'Low', draftIndex: d.index, draftSentence: d.text, draftSpan: null, draftFactText: d.text, meetingSentence: evS ? evS.text : null, meetingSpan: null, meetingFactText: null, timestamp: evS ? evS.timestamp : null, fix: null });
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
    // pass #10: missingness is judged on OPERATIVE entries only — a
    // superseded entry never generates a missing flag itself; when
    // the draft omits the operative value too, the OPERATIVE is what
    // is missing, and it (never the old value) is what gets quoted
    var missingDone = {};
    meeting.forEach(function (ms) {
      if (!matchedMoneyMs[ms.index]) return;
      ms.facts.money.forEach(function (f, fi) {
        if (accountedMF[ms.index + ':' + fi]) return;
        if (supersededCited[ms.index + ':' + fi]) return; // a supersession flag already explains this fact's absence
        if (f.history || f.rejected || f.conditional || f.retired) return; // the past, refused offers and floated values are not dropped commitments
        var supFinT1 = supersededMoney[ms.index + ':' + fi];
        if (supFinT1) {
          var opKey1 = entryKey(supFinT1);
          if (!draftValPresent(supFinT1.f.value) && !accountedMF[opKey1] && !missingDone[opKey1] && !alreadyCited(supFinT1.s, supFinT1.f)) {
            missingDone[opKey1] = 1;
            flags.push(droppedAmountFlag(supFinT1.s, supFinT1.f, 'High'));
          }
          return; // replaced later: this entry itself is never missing
        }
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
    // inclusion claims: a draft sentence that folds an item into a total
    // the meeting recognises ("including the blog migration") anchors the
    // meeting's separate charge for that item — the draft says the item
    // sits inside the matched total, the meeting priced it on top of it
    var inclClaims = [];
    draft.forEach(function (d) {
      if (!d.facts.included) return;
      if (!d.facts.money.some(function (f) { return tMoneyVals[f.value]; })) return;
      var sp = d.facts.included.span;
      inclClaims.push({ toks: tokens(d.text.slice(Math.max(0, sp[0] - 15), Math.min(d.text.length, sp[1] + 40))) });
    });
    meeting.forEach(function (ms) {
      if (matchedMs[ms.index]) return;
      var turnAnchor = !!(ms.speaker && matchedBlocks[blockId[ms.index]]);
      if (!turnAnchor && !Object.keys(anchorFeeKeys).length && !inclClaims.length) return;
      ms.facts.money.forEach(function (f, fi) {
        if (supersededCited[ms.index + ':' + fi]) return;
        if (f.history || f.rejected || f.conditional || f.retired) return; // the past, refused offers and floated values are not dropped commitments
        var fk = draftFeeKey(ms.text, f.span);
        if (fk && (draftZeroKeys[fk] || zeroByKey[fk])) return; // a denied fee belongs to the fee rules, not to this pass
        var inclHit = false;
        if (inclClaims.length) {
          var fd2 = descSet(ms.text, f.span, factSpans(ms, 'money'));
          inclHit = inclClaims.some(function (c) { return Object.keys(c.toks).some(function (w) { return fd2[w] && !CHAIN_GENERIC[w]; }); });
        }
        if (!turnAnchor && !(fk && anchorFeeKeys[fk]) && !inclHit) return;
        var supFinT2 = supersededMoney[ms.index + ':' + fi];
        if (supFinT2) {
          // pass #10: judged by the operative entry, as in tier 1 —
          // this entry itself never generates a missing flag
          var opKey2 = entryKey(supFinT2);
          var fkOp = draftFeeKey(supFinT2.s.text, supFinT2.f.span);
          if (fkOp && draftZeroKeys[fkOp]) return;
          if (!draftValPresent(supFinT2.f.value) && !accountedMF[opKey2] && !missingDone[opKey2] && !alreadyCited(supFinT2.s, supFinT2.f)) {
            missingDone[opKey2] = 1;
            flags.push(droppedAmountFlag(supFinT2.s, supFinT2.f, 'Low'));
          }
          return;
        }
        if (draftValPresent(f.value)) return;
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
      ms.facts.money.forEach(function (f, fi) { if (!f.history && !f.rejected && !f.conditional && !f.retired && !supersededMoney[ms.index + ':' + fi] && !draftMoneyVals[f.value]) carried = { kind: 'money', f: f }; });
      if (!carried) ms.facts.dates.forEach(function (f, fi) { var k = (f.month || '') + '-' + (f.day || '') + '-' + (f.weekday == null ? '' : f.weekday) + '-' + (f.week || ''); if (!f.history && !f.rejected && !f.conditional && !f.retired && !supersededDates[ms.index + ':' + fi] && !draftDateKeys[k]) carried = { kind: 'date', f: f }; });
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

    /* ================= pass #11 finalisation =================
       A structural safety layer over EVERY flag, applied after all
       comparison paths have run and before anything is returned.
       Three mechanical rules, no exceptions by kind or path:

       (B) NEGOTIATED LABEL — a flag whose cited fact belongs to a
       chain resolveChains marked negotiated (3+ values, bare-assent
       closure, never restated) is capped at Low, loses its Copy fix,
       and carries the chain's value sequence: the honest output for
       a haggled number is the haggle itself, not an accusation.

       (A) THE CAP RULE — a High flag whose draft value appears in
       the meeting at a LATER position than the flag's evidence line
       cannot stand at High: the meeting itself contains the draft's
       number after the quoted line, so the quoted line is not the
       meeting's last word on it. The flag is demoted to Low and
       reframed as an uncertainty (Earlier: the evidence line; Later:
       the last later mention of the draft's value), with no Copy
       fix. The rule is purely positional — it does not ask WHY the
       value appears later (a later rejection can therefore cap a
       true flag; that cost is accepted, the Low flag still shows
       both lines).

       (C4) QUESTION EVIDENCE — an offer/question sentence may never
       be the sole evidence of a High mismatch flag. If the cap rule
       did not already reframe it, the flag is demoted the same way,
       reframed Earlier (the question) -> Later (the chain's
       operative line) when the chain provides one. */
    (function finalise() {
      var infosByKind = { money: infoMoney, counts: infoCounts, dates: infoDates, percent: infoPercent, terms: infoTerms };
      var entryRec = {};
      Object.keys(infosByKind).forEach(function (k) {
        (infosByKind[k] || []).forEach(function (rec) {
          (rec.entries || []).forEach(function (ek) { entryRec[k + '|' + ek] = rec; });
        });
      });
      function factText(k, s, f) {
        if (k === 'money') return fullRawOf(s.text, f);
        if (k === 'counts') return f.raw + ' ' + (f.nounRaw || f.noun);
        return f.raw;
      }
      function findFact(k, s, text) {
        var arr = s.facts[k] || [], i, g;
        for (i = 0; i < arr.length; i++) { g = arr[i]; if (factText(k, s, g) === text || g.raw === text) return g; }
        for (i = 0; i < arr.length; i++) { g = arr[i]; if (text && factText(k, s, g).indexOf(text) === 0) return g; }
        return null;
      }
      function kindsFor(fl) {
        if (fl.type === 'Amount') return ['money'];
        if (fl.type === 'Quantity') return ['counts', 'percent'];
        if (fl.type === 'Date') return ['dates', 'terms'];
        return [];
      }
      function sameVal(k, a, b) {
        if (k === 'money') return Math.abs(a.value - b.value) < 0.005 && !(a.currency && b.currency && a.currency !== b.currency);
        if (k === 'counts' || k === 'percent') return Math.abs(a.value - b.value) < 0.005;
        if (k === 'terms') return a.days === b.days;
        if (k === 'dates') return sameDate(a, b) || dateConsistent(a, b);
        return false;
      }
      flags.forEach(function (fl) {
        if (!fl.meetingSentence || !fl.meetingFactText) return;
        var cited = null;
        for (var si = 0; si < meeting.length; si++) if (meeting[si].text === fl.meetingSentence) { cited = meeting[si]; break; }
        if (!cited) return;
        // resolve the flag's kind + cited fact by evidence lookup
        var kind = null, citedFact = null, kinds = kindsFor(fl);
        for (var ki = 0; ki < kinds.length; ki++) {
          var cf2 = findFact(kinds[ki], cited, fl.meetingFactText);
          if (cf2) { kind = kinds[ki]; citedFact = cf2; break; }
        }
        if (!kind) return;
        var citedFi = (cited.facts[kind] || []).indexOf(citedFact);
        var rec = entryRec[kind + '|' + cited.index + ':' + citedFi];
        // (B) negotiated label
        if (rec && rec.negotiated) {
          fl.negotiated = true;
          fl.sequence = rec.sequence;
          fl.confidence = 'Low';
          fl.fix = null;
        }
        if (fl.confidence !== 'High' || fl.uncertain) return;
        // the draft's asserted fact for this flag
        var dFact = null;
        if (!fl.dropped && fl.draftFactText && fl.draftIndex >= 0 && draft[fl.draftIndex]) {
          dFact = findFact(kind, draft[fl.draftIndex], fl.draftFactText);
        }
        if (!dFact) return;
        // (A) the cap rule: the draft's value for THIS thing (the
        // cited fact's own chain), mentioned later than the evidence
        var chainKeys = null;
        if (rec && rec.entries) { chainKeys = {}; rec.entries.forEach(function (ek) { chainKeys[ek] = 1; }); }
        var laterFact = null, laterSent = null;
        for (var li = cited.index + 1; li < meeting.length; li++) {
          var larr = meeting[li].facts[kind] || [];
          for (var lj = 0; lj < larr.length; lj++) {
            if (chainKeys && !chainKeys[li + ':' + lj]) continue;
            if (sameVal(kind, larr[lj], dFact)) { laterFact = larr[lj]; laterSent = meeting[li]; }
          }
        }
        // a question that was CLOSED (assent / settling refusal) is
        // the deal's own record — it may carry a High flag; only a
        // question that merely hangs is barred from High evidence
        var citedIsOperative = rec && rec.operative === cited.index + ':' + citedFi;
        var questionEvidence = offerSentence(cited) && !(citedIsOperative && rec.closed);
        if (!laterFact && !questionEvidence) return;
        fl.capped = true;
        fl.confidence = 'Low';
        fl.fix = null;
        fl.superseded = false;
        if (!laterFact) {
          // presentation fallback: the draft's value mentioned later
          // anywhere (the demotion is already decided; the Later
          // line just shows the reader where their value came from)
          for (var ai = cited.index + 1; ai < meeting.length; ai++) {
            var aarr = meeting[ai].facts[kind] || [];
            for (var aj = 0; aj < aarr.length; aj++) if (sameVal(kind, aarr[aj], dFact)) { laterFact = aarr[aj]; laterSent = meeting[ai]; }
          }
        }
        if (laterFact) {
          fl.uncertain = true;
          fl.earlierSentence = fl.meetingSentence; fl.earlierSpan = fl.meetingSpan; fl.earlierFactText = fl.meetingFactText; fl.earlierTimestamp = fl.timestamp;
          fl.meetingSentence = laterSent.text; fl.meetingSpan = laterFact.span; fl.meetingFactText = factText(kind, laterSent, laterFact); fl.timestamp = laterSent.timestamp;
        } else if (rec && rec.operative) {
          // question evidence only: reframe against the chain's operative line
          var parts = rec.operative.split(':');
          var os = meeting[+parts[0]], of2 = os && (os.facts[kind] || [])[+parts[1]];
          if (os && of2 && os.index !== cited.index) {
            fl.uncertain = true;
            fl.earlierSentence = fl.meetingSentence; fl.earlierSpan = fl.meetingSpan; fl.earlierFactText = fl.meetingFactText; fl.earlierTimestamp = fl.timestamp;
            fl.meetingSentence = os.text; fl.meetingSpan = of2.span; fl.meetingFactText = factText(kind, os, of2); fl.timestamp = os.timestamp;
          }
        }
      });
    })();

    // display sanity: quotes are the matched sentence, never a wall of text
    flags.forEach(function (f) {
      if (f.meetingSentence) { var cq1 = capQuote(f.meetingSentence, f.meetingSpan); f.meetingSentence = cq1.text; f.meetingSpan = cq1.span; }
      if (f.draftSentence) { var cq2 = capQuote(f.draftSentence, f.draftSpan); f.draftSentence = cq2.text; f.draftSpan = cq2.span; }
      if (f.earlierSentence) { var cq3 = capQuote(f.earlierSentence, f.earlierSpan); f.earlierSentence = cq3.text; f.earlierSpan = cq3.span; }
    });

    flags.sort(function (a, b) {
      var ca = a.confidence === 'High' ? 0 : 1, cb = b.confidence === 'High' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.draftIndex < 0 ? 999 : a.draftIndex) - (b.draftIndex < 0 ? 999 : b.draftIndex);
    });

    return {
      flags: flags,
      stats: { transcriptWords: tWords, draftWords: dWords, truncatedTranscript: tTrunc, truncatedDraft: dTrunc, meetingSentences: meeting.length, draftSentences: draft.length },
      meeting: meeting, draft: draft,
      // resolved chains per kind (pass #10): [{operative, superseded,
      // uncertain}] with entry keys "sentenceIndex:factIndex" — the
      // estate-wide invariant verifies flags against this
      chains: { money: infoMoney, counts: infoCounts, dates: infoDates, percent: infoPercent, terms: infoTerms }
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

  /* ---------------- file import (Part B): any supported file -> box text ------
     Zero network, no libraries. Detection is by CONTENT — the extension is
     only a hint: ZIP signature -> DOCX, JSON braces -> the Fireflies JSON
     reader, WEBVTT / timing arrows -> the subtitle reader, markdown markers
     -> a light strip, anything else -> plain text with speaker-block joining.
     A file that cannot be decoded, unzipped, or parsed into at least one
     turn resolves { ok:false }: the page shows one plain message and runs no
     check, so an unreadable file can never end as "No mismatches found". */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  // Minimal ZIP reader: central directory -> one entry's raw bytes.
  function zipEntry(bytes, want) {
    var n = bytes.length, eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 65558); i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    var count = u16(bytes, eocd + 10), off = u32(bytes, eocd + 16);
    for (var e = 0; e < count; e++) {
      if (off + 46 > n || u32(bytes, off) !== 0x02014b50) return null;
      var method = u16(bytes, off + 10), csize = u32(bytes, off + 20);
      var nl = u16(bytes, off + 28), xl = u16(bytes, off + 30), cl = u16(bytes, off + 32);
      var name = '';
      for (var j = 0; j < nl; j++) name += String.fromCharCode(bytes[off + 46 + j]);
      if (name === want) {
        var lo = u32(bytes, off + 42);
        if (lo + 30 > n || u32(bytes, lo) !== 0x04034b50) return null;
        var start = lo + 30 + u16(bytes, lo + 26) + u16(bytes, lo + 28);
        if (start + csize > n) return null;
        return { method: method, data: bytes.subarray(start, start + csize) };
      }
      off += 46 + nl + xl + cl;
    }
    return null;
  }
  function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('DecompressionStream unavailable'));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }
  function xmlToLines(xml) {
    var s = String(xml || '');
    s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t').replace(/<w:br\b[^>]*\/?>/g, '\n');
    s = s.replace(/<\/w:p>/g, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    return s;
  }
  function docxText(bytes) {
    var entry = zipEntry(bytes, 'word/document.xml');
    if (!entry) return Promise.resolve(null);
    function done(raw) {
      try { return xmlToLines(new TextDecoder('utf-8').decode(raw)); }
      catch (e) { return null; }
    }
    if (entry.method === 0) return Promise.resolve(done(entry.data));
    if (entry.method === 8) return inflateRaw(entry.data).then(done, function () { return null; });
    return Promise.resolve(null);
  }
  function decodeText(bytes) {
    try {
      if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
      var text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // binary that happens to decode: control-char soup is not a transcript
      var sample = text.slice(0, 4000), bad = 0;
      for (var i = 0; i < sample.length; i++) {
        var c = sample.charCodeAt(i);
        if (c === 0xFFFD || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
      }
      if (sample.length && bad / sample.length > 0.02) return null;
      return text;
    } catch (e) { return null; }
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }
  function clockVal(v) {
    if (typeof v === 'number' && isFinite(v)) return fmtClock(v);
    if (typeof v === 'string') {
      var m = v.match(/\d{1,2}:\d{2}(?::\d{2})?/);
      if (m) return m[0];
      var f = parseFloat(v);
      if (isFinite(f)) return fmtClock(f);
    }
    return null;
  }
  // Fireflies JSON: sentences carry speaker name / text / start time. Tolerant
  // about key spellings and about where the sentence list lives.
  function jsonToText(obj) {
    var arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && typeof obj === 'object') {
      var keys = ['sentences', 'transcript', 'segments', 'utterances', 'results'];
      for (var i = 0; i < keys.length; i++) if (Array.isArray(obj[keys[i]])) { arr = obj[keys[i]]; break; }
    }
    var lines = [];
    if (arr) {
      for (var j = 0; j < arr.length; j++) {
        var it = arr[j];
        if (!it || typeof it !== 'object') continue;
        var text = it.text || it.sentence || it.content || '';
        if (typeof text !== 'string' || !text.trim()) continue;
        var spk = it.speaker_name != null ? it.speaker_name : (it.speakerName != null ? it.speakerName : (it.speaker != null ? it.speaker : it.name));
        if (spk && typeof spk === 'object') spk = spk.name || null;
        var ts = clockVal(it.start_time != null ? it.start_time : (it.startTime != null ? it.startTime : (it.start != null ? it.start : it.timestamp)));
        lines.push((ts ? '[' + ts + '] ' : '') + (spk ? String(spk).trim() + ': ' : '') + text.trim());
      }
    }
    if (lines.length) return lines.join('\n');
    // unknown shape: best-effort leaf text, only when the keys hint at a transcript
    if (obj && typeof obj === 'object' && /sentence|transcript|speaker/i.test(Object.keys(obj).join(' '))) {
      var leaves = [];
      (function walk(o, depth) {
        if (depth > 6 || leaves.length > 400) return;
        if (typeof o === 'string') { if (o.trim().length >= 2) leaves.push(o.trim()); return; }
        if (Array.isArray(o)) { for (var a = 0; a < o.length; a++) walk(o[a], depth + 1); return; }
        if (o && typeof o === 'object') { for (var k in o) walk(o[k], depth + 1); }
      })(obj, 0);
      if (leaves.length) return leaves.join('\n');
    }
    return null;
  }
  function stripMarkdown(text) {
    return String(text || '').split(/\r?\n/).map(function (line) {
      var s = line;
      s = s.replace(/^\s{0,3}#{1,6}\s+/, '');
      s = s.replace(/^\s*>\s?/, '');
      s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');
      s = s.replace(/(^|\W)(\*|_)([^*_]+?)\2(?=\W|$)/g, '$1$3');
      s = s.replace(/`([^`]+)`/g, '$1');
      return s;
    }).join('\n');
  }
  function looksMarkdown(text) {
    var head = text.slice(0, 4000);
    return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(head) || /\*\*[^*\n]{2,}\*\*/.test(head) || /__[^_\n]{2,}__/.test(head);
  }
  /* Speaker-block joining: Otter / Meet / Teams exports put the speaker and
     time on their own line(s) and the words on the lines after. Join each
     block into one "[ts] Name: text" line so the normal turn parser sees the
     speaker and the timestamp. Only whole-line headers trigger a join, so
     inline "Name: text" lines and plain prose pass through untouched. */
  var HDR_RE = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*:?\s*$/;
  var NAME_ONLY_RE = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2})$/;
  var BARE_TS_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?$/;
  function nameOk(name) {
    return name.split(' ').every(function (w) { return !NAME_STOP[w]; });
  }
  function joinSpeakerBlocks(text) {
    var lines = String(text || '').split(/\r?\n/), out = [], i = 0, changed = false;
    function isNameLine(s) { return NAME_ONLY_RE.test(s) && nameOk(s); }
    while (i < lines.length) {
      var line = lines[i].trim(), name = null, ts = null, headLen = 0;
      var hm = line.match(HDR_RE);
      if (hm && nameOk(hm[1])) { name = hm[1]; ts = hm[2]; headLen = 1; }
      else if (isNameLine(line) && i + 1 < lines.length) {
        var tm = lines[i + 1].trim().match(BARE_TS_RE);
        if (tm) { name = line; ts = tm[1]; headLen = 2; }
      }
      if (name) {
        var j = i + headLen, body = [];
        while (j < lines.length) {
          var bl = lines[j].trim();
          if (!bl) { j++; break; }
          if (HDR_RE.test(bl) && nameOk(bl.match(HDR_RE)[1])) break;
          if (isNameLine(bl) && j + 1 < lines.length && BARE_TS_RE.test(lines[j + 1].trim())) break;
          body.push(bl); j++;
        }
        if (body.length) {
          out.push('[' + ts + '] ' + name + ': ' + body.join(' '));
          changed = true; i = j; continue;
        }
      }
      out.push(lines[i]); i++;
    }
    return changed ? out.join('\n') : text;
  }
  function importFileData(name, data) {
    var bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
    var ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    function finish(text, format) {
      if (text == null) return { ok: false, format: format || null };
      var turns = parseLines(text);
      if (!turns.length) return { ok: false, format: format || null };
      return { ok: true, text: text, format: format, turns: turns };
    }
    // a DOCX is a ZIP, whatever the file happens to be called
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return docxText(bytes).then(function (text) {
        if (text == null) return { ok: false, format: 'docx' };
        return finish(joinSpeakerBlocks(text), 'docx');
      }, function () { return { ok: false, format: 'docx' }; });
    }
    var text = decodeText(bytes);
    if (text == null) return Promise.resolve({ ok: false, format: null });
    var trimmed = text.trim(), head = text.slice(0, 4000);
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      var obj = null;
      try { obj = JSON.parse(trimmed); } catch (e) { obj = null; }
      if (obj !== null) {
        var jt = jsonToText(obj);
        return Promise.resolve(jt != null ? finish(jt, 'json') : { ok: false, format: 'json' });
      }
      // braces but not JSON: fall through to the plain-text path
    }
    if (/^WEBVTT/i.test(trimmed) || /\d{1,2}:\d{2}(?::\d{2})?[.,]?\d*\s*-->/.test(head) || ext === 'vtt' || ext === 'srt') {
      return Promise.resolve(finish(parseSubtitleFile(text), 'subtitle'));
    }
    if (ext === 'md' || looksMarkdown(text)) {
      return Promise.resolve(finish(joinSpeakerBlocks(stripMarkdown(text)), 'markdown'));
    }
    return Promise.resolve(finish(joinSpeakerBlocks(text), 'text'));
  }

  return {
    check: check,
    parseLines: parseLines,
    extractFacts: extractFacts,
    SAMPLE: SAMPLE,
    parseSubtitleFile: parseSubtitleFile,
    importFileData: importFileData,
    _internal: { wordVal: wordVal, dateConflict: dateConflict, tokens: tokens }
  };
});
