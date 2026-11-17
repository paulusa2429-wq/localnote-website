/* The No-Invention Lint — shared engine for roast.html and the homepage demo.
   ONE source for both pages: roast.html and index.html both load this file;
   neither carries an inline copy. The matching core is a faithful port of
   the LocalNote app's commitmentLint: same normalisation, same stopwords,
   same "at least half the content words, and at least two" rule.
   Deterministic, no model, no network. Tested by test/roast-lint.test.mjs. */
/* ROAST-ENGINE-START */
/* ============================================================================
   The No-Invention Lint — web port for roast.html.
   The matching core (normaliseWords, contentWords, verifyQuote, findQuote,
   dateStatedInTranscript and their helpers) is a faithful port of the
   LocalNote app's src/shared/commitmentLint.ts: same normalisation, same
   stopword list, same "at least half the content words, and at least two"
   rule, same date shapes. Everything is deterministic: same words in, same
   verdict out. No model, no network.
   The app runs the lint on structured commitments a local model extracts
   (owner / task / due). This page only has raw text, so the parts below the
   port are the honest deterministic subset: claims are sentences split from
   the summary, the owner check becomes a per-name presence check, and the
   date check runs on the date phrases found inside each sentence.
   ============================================================================ */

/* ---- ported core: identical logic to commitmentLint.ts ---- */

const normaliseWords = (s) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOPWORDS = new Set('the a an and or of to in on for with we you our your it is are was were be been have has had will would should can could this that these those from by at as i me my he she they them his her their its not no'.split(' '));

const contentWords = (s) => [...new Set(normaliseWords(s).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w)))];

function verifyQuote(quote, transcript) {
  const q = normaliseWords(quote);
  if (!q) return false;
  return ` ${normaliseWords(transcript)} `.includes(` ${q} `);
}

function findQuote(task, transcript, hints = {}) {
  const words = contentWords(task);
  if (!words.length) return null;
  const need = words.length <= 1 ? 1 : Math.max(2, Math.ceil(words.length / 2));
  const ownerKey = hints.owner ? normaliseWords(hints.owner) : '';
  const dueWords = hints.due ? contentWords(hints.due) : [];
  let best = null;
  for (const raw of transcript.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const folded = ` ${normaliseWords(line)} `;
    const covered = words.filter((w) => folded.includes(` ${w} `)).length;
    if (covered < need) continue;
    let bonus = 0;
    if (ownerKey && folded.includes(` ${ownerKey} `)) bonus += 2;
    if (dueWords.some((w) => folded.includes(` ${w} `))) bonus += 1;
    if (!best || covered > best.covered || (covered === best.covered && bonus > best.bonus)) best = { line, covered, bonus };
  }
  return best ? best.line : null;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const ABBR_FOR_MONTH = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function explicitDate(dueFolded) {
  const monthIdx = (name) => MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : MONTH_ABBR[name] ?? -1;
  const mdy = /^([a-z]+) (\d{1,2})( \d{4})?$/.exec(dueFolded);
  if (mdy && monthIdx(mdy[1]) >= 0) return { month: monthIdx(mdy[1]), day: Number(mdy[2]) };
  const dmy = /^(\d{1,2}) ([a-z]+)( \d{4})?$/.exec(dueFolded);
  if (dmy && monthIdx(dmy[2]) >= 0) return { month: monthIdx(dmy[2]), day: Number(dmy[1]) };
  const iso = /^(\d{4}) (\d{1,2}) (\d{1,2})$/.exec(dueFolded);
  if (iso) return { month: Number(iso[2]) - 1, day: Number(iso[3]) };
  const slash = /^(\d{1,2}) (\d{1,2})( \d{4})?$/.exec(dueFolded);
  if (slash) return { month: Number(slash[1]) - 1, day: Number(slash[2]) };
  return null;
}

const dayToken = (foldedLine, day) =>
  new RegExp(`(^| )${day}(st|nd|rd|th)?( |$)`).test(foldedLine);

function dateStatedInTranscript(due, transcript) {
  const folded = ` ${normaliseWords(transcript)} `;
  const lines = transcript.split('\n').map((l) => ` ${normaliseWords(l)} `);
  const d = normaliseWords(due).replace(/^by /, '');
  if (!d) return false;
  const weekday = WEEKDAYS.find((w) => d.split(' ').includes(w));
  if (weekday) return folded.includes(` ${weekday} `);
  const explicit = explicitDate(d);
  if (explicit) {
    const names = [MONTHS[explicit.month], ABBR_FOR_MONTH[explicit.month], ...(explicit.month === 8 ? ['sept'] : [])];
    const numMonth = String(explicit.month + 1);
    return lines.some((line) =>
      (names.some((n) => line.includes(` ${n} `)) && dayToken(line, explicit.day))
      || line.includes(` ${numMonth} ${explicit.day} `) || line.includes(` ${explicit.day} ${numMonth} `));
  }
  const inN = /^in (\d+|a|an) (day|days|week|weeks|month|months)$/.exec(d);
  if (inN) {
    const amount = inN[1], unit = inN[2].replace(/s$/, '');
    return folded.includes(` in ${amount} ${unit} `) || folded.includes(` ${amount} ${unit}s `) || folded.includes(` ${amount} ${unit} `);
  }
  const variants = [d];
  if (d === 'end of week') variants.push('end of the week');
  if (d === 'end of day' || d === 'eod') variants.push('end of day', 'eod');
  return variants.some((v) => folded.includes(` ${v} `));
}

/* ---- page additions: the deterministic subset (no model) ---- */

/* Headings and list markers are structure, not claims; a line that ends in a
   colon with no sentence punctuation of its own is treated as a heading.
   Decimals are protected so "3.5 hours" is not split in two. */
function splitClaims(summary) {
  const out = [];
  for (const rawLine of String(summary).split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;
    line = line.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '');
    if (!line) continue;
    if (/:$/.test(line) && !/[.!?]/.test(line.slice(0, -1))) continue;
    const safe = line.replace(/(\d)\.(\d)/g, '$1\u0001$2');
    const parts = safe.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
    for (const p of parts) {
      const s = p.replace(/\u0001/g, '.').trim();
      if (s && contentWords(s).length) out.push(s);
    }
  }
  return out;
}

const MONTH_NAME_RE = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';

/* The date phrases a sentence states, in the shapes dateStatedInTranscript
   knows how to look for. Explicit dates are claimed first so a bare-month
   pass cannot re-claim the same words. */
function extractDatePhrases(text) {
  const found = [];
  const taken = [];
  const take = (re, make) => {
    const r = new RegExp(re.source, 'gi');
    let m;
    while ((m = r.exec(text))) {
      const span = [m.index, m.index + m[0].length];
      if (taken.some(([a, b]) => span[0] < b && span[1] > a)) continue;
      taken.push(span);
      found.push(make(m[0]));
    }
  };
  take(new RegExp(`\\b${MONTH_NAME_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`), (s) => s);
  take(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_NAME_RE}\\b`), (s) => s);
  take(/\b\d{4}-\d{2}-\d{2}\b/, (s) => s);
  take(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, (s) => s);
  take(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/, (s) => s);
  take(/\b(?:tomorrow|yesterday)\b/, (s) => s);
  take(/\b(?:next|last)\s+(?:week|month|year)\b/, (s) => s);
  take(/\bend of (?:the )?(?:week|month|day)\b/, (s) => s.replace(/end of the /i, 'end of '));
  take(/\bin\s+(?:\d+|a|an)\s+(?:days?|weeks?|months?)\b/, (s) => s);
  take(new RegExp(`\\b${MONTH_NAME_RE}\\b`), (s) => s);
  return found;
}

/* Capitalised words that are not names: months and weekdays are dates, the
   rest are ordinary sentence furniture. A capitalised first word is skipped —
   it may be a name or may just start the sentence, and this check will not
   guess. (The app knows the owner as a fact; the page can only look.) */
const NON_NAME = new Set([...MONTHS, ...Object.keys(MONTH_ABBR), ...WEEKDAYS,
  'the a an it this that these those we they he she you in on by for at as but and so then also overall deadline action items summary notes note meeting team ai key decisions decision update updates next steps step attendees agenda topic topics owner status date time'.split(' ')]);

function extractNames(claim) {
  const tokens = String(claim).split(/\s+/).map((t) => t.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, ''));
  const names = [];
  tokens.forEach((tok, i) => {
    if (i === 0) return;
    if (!/^[A-Z][a-z]+(?:['’-][A-Za-z]+)*$/.test(tok)) return;
    if (NON_NAME.has(normaliseWords(tok))) return;
    names.push(tok);
  });
  return [...new Set(names)];
}

/* The transcript line closest to the claim — shown beside an unconfirmed
   claim as the closest thing actually said. Scored exactly like findQuote
   (coverage, then the owner/due bonus) but with the bar lowered to a single
   shared content word, so the line about the claim's own date or person wins
   over an earlier line that merely shares a topic word. */
function nearestLine(task, transcript, hints = {}) {
  const words = contentWords(task);
  if (!words.length) return null;
  const ownerKey = hints.owner ? normaliseWords(hints.owner) : '';
  const dueWords = hints.due ? contentWords(hints.due) : [];
  let best = null;
  for (const raw of String(transcript).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const folded = ` ${normaliseWords(line)} `;
    const covered = words.filter((w) => folded.includes(` ${w} `)).length;
    if (!covered) continue;
    let bonus = 0;
    if (ownerKey && folded.includes(` ${ownerKey} `)) bonus += 2;
    if (dueWords.some((w) => folded.includes(` ${w} `))) bonus += 1;
    if (!best || covered > best.covered || (covered === best.covered && bonus > best.bonus)) best = { line, covered, bonus };
  }
  return best ? best.line : null;
}

/* One claim against the transcript — the page's lintCommitment. A claim is
   SUPPORTED only when all three hold, mirroring the app: a transcript line
   backs it (quote), every date it states was actually said (date), and every
   person it names appears in the transcript (name). */
function checkClaim(claim, transcript) {
  const dates = extractDatePhrases(claim);
  const names = extractNames(claim);
  const found = findQuote(claim, transcript, { owner: names[0], due: dates.length ? dates[0] : null });
  const quote = found && verifyQuote(found, transcript) ? found : null;
  const missing = [];
  if (!quote) missing.push('quote');
  const badDates = dates.filter((d) => !dateStatedInTranscript(d, transcript));
  if (badDates.length) missing.push('date');
  const foldedTranscript = ` ${normaliseWords(transcript)} `;
  const badNames = names.filter((n) => !foldedTranscript.includes(` ${normaliseWords(n)} `));
  if (badNames.length) missing.push('name');
  return {
    claim,
    state: missing.length ? 'unconfirmed' : 'supported',
    missing,
    quote,
    badDates,
    badNames,
    nearest: quote ? null : nearestLine(claim, transcript, { owner: names[0], due: dates.length ? dates[0] : null }),
  };
}

function checkSummary(summary, transcript) {
  const claims = splitClaims(summary).map((c) => checkClaim(c, transcript));
  return {
    claims,
    total: claims.length,
    supported: claims.filter((c) => c.state === 'supported').length,
    unconfirmed: claims.filter((c) => c.state === 'unconfirmed').length,
  };
}

const RoastLint = { normaliseWords, contentWords, verifyQuote, findQuote, dateStatedInTranscript, splitClaims, extractDatePhrases, extractNames, checkClaim, checkSummary };
if (typeof window !== 'undefined') window.RoastLint = RoastLint;

/* ROAST-ENGINE-END */
