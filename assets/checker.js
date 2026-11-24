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
  var NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var NUMWORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and)';
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
    var ws = t.toLowerCase().replace(/-/g, ' ').split(/\s+/), tot = 0, cur = 0, seen = false;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w === 'and' || w === 'dollars' || w === 'dollar' || w === 'usd') continue;
      if (w === 'a' || w === 'an') { if (!cur) cur = 1; continue; }
      if (NUMW[w] !== undefined) { cur += NUMW[w]; seen = true; continue; }
      if (w === 'hundred') { cur = (cur || 1) * 100; seen = true; continue; }
      if (w === 'thousand') { tot += (cur || 1) * 1000; cur = 0; seen = true; continue; }
      if (w === 'million') { tot += (cur || 1) * 1000000; cur = 0; seen = true; continue; }
    }
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
  var SPK_RE = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2})\s*:\s+/;
  function parseLines(text) {
    var lines = String(text || '').split(/\r?\n/), out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var ts = null, speaker = null, m;
      if ((m = line.match(TS_RE))) { ts = m[1]; line = line.slice(m[0].length); }
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
    return { facts: facts, spans: spans };
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
  function sameDate(a, b) {
    return (a.month || 0) === (b.month || 0) && (a.day || 0) === (b.day || 0) && (a.weekday == null ? null : a.weekday) === (b.weekday == null ? null : b.weekday) && (a.week || 0) === (b.week || 0) && (a.part || '') === (b.part || '');
  }

  /* ---------------- fact extraction ---------------- */
  var MONEY_CTX = /\b(price|priced|cost|costs|fee|fees|budget|quote|quoted|total|charge|charged|charges|pay|paid|payment|invoice|invoiced|amount|sum|worth|billing|billed|bill|per month|per year|monthly|annually|yearly|salary|rate|retainer|deposit|discount)\b/i;
  function extractFacts(s) {
    var facts = { money: [], percent: [], counts: [], dates: [], names: [], actors: [], promise: false, included: null, billed: null };
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
    var m;
    // money: $ amounts
    var reD = /\$\s?\d[\d,]*(?:\.\d+)?[kK]?/g;
    while ((m = reD.exec(work))) { var v = amtValOf(m[0]); if (v !== null) { facts.money.push({ value: v, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    // money: digits + dollars/USD, digits with k suffix
    var reDK = /\b\d[\d,]*(?:\.\d+)?\s*(?:dollars?|USD)\b/gi;
    while ((m = reDK.exec(work))) { var v2 = amtValOf(m[0]); if (v2 !== null) { facts.money.push({ value: v2, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    var reK = /\b\d[\d,]*(?:\.\d+)?[kK]\b/g;
    while ((m = reK.exec(work))) { var v3 = amtValOf(m[0]); if (v3 !== null && MONEY_CTX.test(s)) { facts.money.push({ value: v3, raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); } }
    work = masked.join('');
    // percent: digits
    var reP = /\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent\b|per cent\b)/gi;
    while ((m = reP.exec(work))) { facts.percent.push({ value: parseFloat(m[0].replace(/[^0-9.]/g, '')), raw: s.slice(m.index, m.index + m[0].length), span: [m.index, m.index + m[0].length] }); mask(m.index, m.index + m[0].length); }
    work = masked.join('');
    // word-number expressions (money w/ dollars, percent, counts)
    var reW = new RegExp('\\b' + NUMWORD + '(?:[-\\s]+' + NUMWORD + ')*', 'gi');
    while ((m = reW.exec(work))) {
      var rawW = m[0];
      if (!/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i.test(rawW)) continue;
      var val = wordVal(rawW);
      if (val === null) continue;
      var after = work.slice(m.index + rawW.length, m.index + rawW.length + 30);
      var afterM = after.match(/^\s*(dollars?|USD|%|percent|per cent)\b/i);
      if (afterM) {
        var full = [m.index, m.index + rawW.length + afterM[0].length];
        if (/dollars?|USD/i.test(afterM[1])) facts.money.push({ value: val, raw: s.slice(full[0], full[1]), span: full });
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
    return facts;
  }
  function amtValOf(t) {
    t = t.trim();
    if (/^\$/.test(t) || /^\d/.test(t)) {
      var k = /[kK]\s*$/.test(t) || /[kK]\s+(?:dollars?|USD)\s*$/i.test(t);
      var n = parseFloat(t.replace(/[$,\s]/g, '').replace(/[kK]$/, ''));
      if (isNaN(n)) return null;
      return k ? n * 1000 : n;
    }
    return wordVal(t);
  }

  /* ---------------- matching + comparison ---------------- */
  function buildSentences(text) {
    return parseLines(text).map(function (s, i) {
      return { text: s.text, timestamp: s.timestamp, speaker: s.speaker, index: i, facts: extractFacts(s.text), toks: tokens(s.text) };
    });
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

    var flags = [];
    function addFlag(f) {
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
          out.push({ s: ms, sc: ctxScore(d, span, ms) });
        });
        out.sort(function (a, b) { return b.sc - a.sc; });
        return out;
      }

      // --- money (per-fact assignment so multi-amount sentences pair up correctly) ---
      if (df.money.length) {
        var usedMF = {};
        df.money.forEach(function (mf) {
          var cands = candsFor('money', mf.span);
          if (!cands.length) return;
          var pick = null, pickFact = null;
          for (var ci = 0; ci < cands.length; ci++) {
            var facts = cands[ci].s.facts.money;
            for (var fi = 0; fi < facts.length; fi++) {
              var key = cands[ci].s.index + ':' + fi;
              if (!usedMF[key]) { pick = cands[ci]; pickFact = facts[fi]; usedMF[key] = 1; break; }
            }
            if (pick) break;
          }
          if (!pick || pick.sc < 0.12) return;
          if (Math.abs(pickFact.value - mf.value) < 0.005) return;
          // if the draft value is genuinely said in another, nearly-as-good sentence, stay quiet
          var holders = meeting.filter(function (ms) { return ms.facts.money.some(function (x) { return Math.abs(x.value - mf.value) < 0.005; }); });
          if (holders.length && holders.indexOf(pick.s) < 0) {
            var hBest = 0; holders.forEach(function (ms) { var sc = ctxScore(d, mf.span, ms); if (sc > hBest) hBest = sc; });
            if (!(pick.sc >= 0.30 && hBest < pick.sc - 0.15)) return;
          }
          addFlag({ type: 'Amount', beta: false, confidence: confOf(pick.sc), draftIndex: d.index, draftSentence: d.text, draftSpan: mf.span, draftFactText: mf.raw, meetingSentence: pick.s.text, meetingSpan: pickFact.span, meetingFactText: pickFact.raw, timestamp: pick.s.timestamp, fix: fixFor(d.text, mf.span, pickFact.raw) });
        });
      }
      // --- percent (reported as Quantity) ---
      if (df.percent.length) {
        df.percent.forEach(function (pf) {
          var cands = candsFor('percent', pf.span);
          if (!cands.length || cands[0].sc < 0.12) return;
          var pm = cands[0].s.facts.percent[0];
          if (Math.abs(pm.value - pf.value) < 0.005) return;
          addFlag({ type: 'Quantity', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: pf.span, draftFactText: pf.raw, meetingSentence: cands[0].s.text, meetingSpan: pm.span, meetingFactText: pm.raw, timestamp: cands[0].s.timestamp, fix: fixFor(d.text, pf.span, pm.raw) });
        });
      }
      // --- counts by noun ---
      if (df.counts.length) {
        df.counts.forEach(function (cf) {
          var cands = candsFor('counts', cf.span, function (x) { return x.noun === cf.noun; });
          if (!cands.length || cands[0].sc < 0.12) return;
          var same = cands[0].s.facts.counts.filter(function (x) { return x.noun === cf.noun; });
          var hit = same.some(function (x) { return Math.abs(x.value - cf.value) < 0.005; });
          if (hit) return;
          var cm2 = same[0];
          addFlag({ type: 'Quantity', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: cf.span, draftFactText: cf.raw + ' ' + cf.noun, meetingSentence: cands[0].s.text, meetingSpan: cm2.span, meetingFactText: cm2.raw + ' ' + cm2.noun, timestamp: cands[0].s.timestamp, fix: fixFor(d.text, cf.span, cm2.raw) });
        });
      }
      // --- dates (per-fact: walk candidates until one confirms or conflicts) ---
      if (df.dates.length) {
        df.dates.forEach(function (dtf) {
          var cands = candsFor('dates', dtf.span);
          for (var ci = 0; ci < cands.length; ci++) {
            if (cands[ci].sc < 0.12) break;
            var darr = cands[ci].s.facts.dates;
            if (darr.some(function (x) { return sameDate(x, dtf); })) return;
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
          var hit = cands[0].s.facts.actors.some(function (x) { return x.name.toLowerCase() === af.name.toLowerCase(); });
          if (hit) return;
          var am = cands[0].s.facts.actors[0];
          addFlag({ type: 'Name', beta: false, confidence: confOf(cands[0].sc), draftIndex: d.index, draftSentence: d.text, draftSpan: af.span, draftFactText: af.name, meetingSentence: cands[0].s.text, meetingSpan: am.span, meetingFactText: am.name, timestamp: cands[0].s.timestamp, fix: fixFor(d.text, af.span, am.name) });
        });
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
      var bestD = 0;
      draft.forEach(function (d) { var sc = score(d, ms); if (sc > bestD) bestD = sc; });
      if (bestD >= 0.3) return;
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
      line = line.replace(/<[^>]+>/g, '').trim();
      if (!line) continue;
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
