/* Fixture tests for the No-Invention Lint port embedded in roast.html.
   Run: node test/roast-lint.test.mjs   (no dependencies)
   The engine is extracted from the page itself, so what is tested here is
   exactly what ships. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'roast.html'), 'utf8');
const m = html.match(/\/\* ROAST-ENGINE-START \*\/([\s\S]*?)\/\* ROAST-ENGINE-END \*\//);
if (!m) { console.error('FAIL engine block not found in roast.html'); process.exit(1); }
const win = {};
new Function('window', m[1])(win);
const L = win.RoastLint;

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fails++; };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* (a) the canonical fixture: the summary invents "15 July"; the meeting only
   ever said "mid July, roughly" — the claim must be UNCONFIRMED, on the date,
   with the real hedge shown as the closest line. */
{
  const transcript = [
    'Alex: Where are we on the launch date?',
    'Priya: We’ll aim for mid July, roughly — nothing is locked in yet.',
    'Alex: Okay, let’s keep it flexible then.'
  ].join('\n');
  const r = L.checkSummary('The launch deadline is 15 July.', transcript);
  eq('(a) one claim', r.total, 1);
  eq('(a) verdict', r.claims[0].state, 'unconfirmed');
  ok('(a) date named missing', r.claims[0].missing.includes('date'), JSON.stringify(r.claims[0].missing));
  ok('(a) quote named missing', r.claims[0].missing.includes('quote'), JSON.stringify(r.claims[0].missing));
  ok('(a) closest line is the real hedge', (r.claims[0].nearest || '').includes('mid July'), r.claims[0].nearest);
}

/* (b) a claim the transcript backs word for word — SUPPORTED, and the line
   shown is the exact transcript line, speaker included. */
{
  const line = 'Marcus: The vendor contract renews in March, and support stays on the current plan.';
  const r = L.checkSummary('The vendor contract renews in March.', line);
  eq('(b) verdict', r.claims[0].state, 'supported');
  eq('(b) backing line is byte-exact', r.claims[0].quote, line);
}

/* (c) an invented person and an invented commitment, absent from the
   transcript — UNCONFIRMED, with the name named. */
{
  const transcript = ['Sam: I’ll update the onboarding doc this week.', 'Lee: Sounds good, thanks.'].join('\n');
  const r = L.checkSummary('The plan also has Jordan hiring two engineers next month.', transcript);
  eq('(c) verdict', r.claims[0].state, 'unconfirmed');
  ok('(c) name named missing', r.claims[0].missing.includes('name'), JSON.stringify(r.claims[0].missing));
  eq('(c) the invented name', r.claims[0].badNames, ['Jordan']);
}

/* (d) a supported paraphrase: not the transcript's words, but it shares at
   least half its content words with a real line — SUPPORTED, per the rule. */
{
  const line = 'Priya: I will send the budget spreadsheet to the finance team by Friday.';
  const r = L.checkSummary('Priya will send the budget spreadsheet to finance by Friday.', line);
  eq('(d) verdict', r.claims[0].state, 'supported');
  eq('(d) backing line', r.claims[0].quote, line);
}

/* (e) the page's own example, end to end: two honest claims supported, the
   invented deadline and the invented hire unconfirmed. */
{
  const transcript = [
    'Alex: Where are we on the launch date?',
    'Priya: We’ll aim for mid July, roughly — nothing is locked in yet.',
    'Alex: Okay, let’s keep it flexible then.',
    'Priya: I will send the budget spreadsheet to the finance team by Friday.',
    'Marcus: The vendor contract renews in March, and support stays on the current plan.'
  ].join('\n');
  const summary = [
    'The launch deadline is 15 July.',
    'Priya will send the budget spreadsheet to finance by Friday.',
    'The vendor contract renews in March.',
    'Jordan will hire two new engineers next month.'
  ].join('\n');
  const r = L.checkSummary(summary, transcript);
  eq('(e) counts', [r.total, r.supported, r.unconfirmed], [4, 2, 2]);
  eq('(e) verdicts in order', r.claims.map((c) => c.state), ['unconfirmed', 'supported', 'supported', 'unconfirmed']);
}

/* (f) structure is not claims: headings and bullets are handled, decimals
   are not split in two. */
{
  eq('(f) heading skipped, bullets read', L.splitClaims('Action items:\n- Priya will send the report.\n- The review took 3.5 hours.'),
    ['Priya will send the report.', 'The review took 3.5 hours.']);
}

console.log(fails ? `\n${fails} fixture(s) FAILED` : '\nAll fixtures passed');
process.exit(fails ? 1 : 0);
