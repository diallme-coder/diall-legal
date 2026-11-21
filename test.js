#!/usr/bin/env node
'use strict';
// Node tests for the Red Flag & Risk Detector engine and build. No frameworks.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const RFD = require('./engine.js');
const TAX = require('./taxonomy.json');
const SAMPLE = fs.readFileSync(path.join(__dirname, 'sample-contract.txt'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + String(e && e.message).split('\n').join('\n       ')); }
}

const asyncQueue = [];
function testAsync(name, fn) { asyncQueue.push([name, fn]); }

// Pad a clause with a neutral heading so it is long enough to read like a real paragraph.
const analyze = (text, tax) => RFD.analyze(text, tax || TAX);
const hits = (text) => {
  const r = analyze(text);
  const s = new Set();
  r.findings.forEach((f) => { s.add(f.ruleId); f.alsoMatches.forEach((x) => s.add(x)); });
  return s;
};
const primary = (text) => analyze(text).findings.map((f) => f.ruleId);
const mini = (rules, extra) => Object.assign({
  severity_rubric: TAX.severity_rubric, scoring: { modifiers: [] }, qc_checks: [], rules
}, extra || {});
const rule = (id, base, trig, extra) => Object.assign({ id, category: 'T', title: id, group: 'core', base_score: base, triggers: [trig], mitigators: [], aggravators: [], mitigator_delta: 0, why_it_matters: 'w', suggested_fix: 'f' }, extra || {});

console.log('Core rules: positive and benign clauses');

const CASES = {
  'auto-renewal-trap': {
    pos: [
      'This Agreement will automatically renew for successive one-year terms unless Customer gives written notice of non-renewal.',
      'The subscription shall auto-renew each year at the then-current price.',
      'The term is evergreen and continues until cancelled.'
    ],
    neg: [
      'This Agreement has a fixed term of twelve months and expires at the end of that term. Any extension requires a written amendment signed by both parties.'
    ]
  },
  'unilateral-change': {
    pos: [
      'Provider may increase the fees at any time by notifying Customer.',
      'Provider reserves the right to modify these terms at any time by posting the revised terms on its website.',
      'Prices are subject to change without notice.'
    ],
    neg: [
      'The fees are fixed for the Term and can only be amended by a written agreement signed by both parties.',
      'Each party may update its notice address by giving the other party an email.'
    ]
  },
  'broad-indemnification': {
    pos: [
      'Customer shall indemnify, defend and hold harmless Provider from any and all claims, losses and expenses arising out of the Agreement.',
      'Client agrees to hold harmless the Company from all claims and liabilities of any kind.'
    ],
    neg: [
      'Provider will perform the Services in a professional manner and will correct any defects reported within thirty days.'
    ]
  },
  'non-compete-restrictive-covenant': {
    pos: [
      'During the Term and for two years after, Customer shall not, directly or indirectly, compete with Provider.',
      'Contractor agrees to a non-solicitation of Provider employees for 24 months.',
      'Distributor will not solicit any customer of the Company during the restricted period.'
    ],
    neg: [
      'Nothing in this Agreement restricts either party from competing in the marketplace or working with other vendors.'
    ]
  },
  'jury-waiver-arbitration': {
    pos: [
      'Each party waives the right to a jury trial in any action arising out of this Agreement.',
      'Any dispute shall be resolved by binding arbitration administered by a neutral provider.',
      'Customer agrees to a class action waiver and will not bring any claim on a class basis.'
    ],
    neg: [
      'Any dispute will be heard in the state or federal courts located in the agreed venue, and either party may seek relief in court.'
    ]
  }
};
Object.keys(CASES).forEach((id) => {
  CASES[id].pos.forEach((t, i) => test(id + ' positive #' + (i + 1), () => {
    assert.ok(hits(t).has(id), 'expected ' + id + ' for: ' + t + ' got ' + [...hits(t)].join(','));
  }));
  CASES[id].neg.forEach((t, i) => test(id + ' benign #' + (i + 1) + ' is not flagged', () => {
    assert.ok(!hits(t).has(id), 'unexpected ' + id + ' for: ' + t);
  }));
});

console.log('Negation');
test('"does not automatically renew" is skipped', () => {
  assert.ok(!hits('This Agreement does not automatically renew and ends on the stated expiry date.').has('auto-renewal-trap'));
});
test('"shall not auto-renew" is skipped', () => {
  assert.ok(!hits('The subscription shall not auto-renew without a new signed order.').has('auto-renewal-trap'));
});
test('"without" before the trigger skips it', () => {
  assert.ok(!hits('Customer remains free to leave without any automatic renewal of the subscription.').has('auto-renewal-trap'));
});
test('"does not waive jury trial" is skipped', () => {
  assert.ok(!hits('Customer does not waive its right to a jury trial under this Agreement.').has('jury-waiver-arbitration'));
});
test('"will not sell data" is skipped for the data rule', () => {
  assert.ok(!hits('Provider will not sell Customer Data to any third party for marketing.').has('data-use-sale-rights'));
});
test('negation does not leak across a sentence boundary', () => {
  assert.ok(hits('Fees are not refundable after thirty days. This Agreement automatically renews for successive one-year terms.').has('auto-renewal-trap'));
});
test('"no later than" is not treated as negation', () => {
  assert.ok(hits('Notice must be given no later than 30 days before the date on which the Agreement automatically renews.').has('auto-renewal-trap'));
});

console.log('Regression: verifier-reported defects');
const REG = [
  ['auto-renewal-trap', '8.1 Term. The subscription continues for successive twelve-month periods unless Customer gives written notice of non-renewal at least ninety (90) days before the end of the then-current period.'],
  ['auto-renewal-trap', 'Upon expiry of the Initial Term, this Agreement will be extended automatically for further one-year terms, and Client will be billed the then-current rates, unless cancelled in writing 60 days beforehand.'],
  ['unilateral-change', 'Provider may, at any time and in its sole discretion, increase the fees payable under this Agreement by giving Customer written notice, and the increased fees apply from the next billing cycle.'],
  ['non-compete-restrictive-covenant', 'During the Term and for 24 months afterward, Consultant agrees not to provide services to any competitor of the Client within a 100-mile radius of any Client office.'],
  ['jury-waiver-arbitration', 'Any dispute shall be resolved exclusively by binding individual arbitration, and the parties give up the right to a jury trial or to participate in a class action.'],
  // new, differently worded
  ['auto-renewal-trap', 'Following the initial period, the Agreement rolls over for additional twelve-month terms unless either party terminates by notice of cancellation at least 45 days prior.'],
  ['unilateral-change', 'Company reserves the right, from time to time and without further consent, to adjust the subscription charges applicable to Client.'],
  ['non-compete-restrictive-covenant', 'For eighteen months following termination, Contractor is restricted from competing with the Company in the State of Ohio.'],
  ['jury-waiver-arbitration', 'By signing, Customer knowingly and voluntarily surrenders any right to have disputes decided by a jury.']
];
REG.forEach(([id, t], i) => test('regression #' + (i + 1) + ' primary finding is ' + id, () => {
  const r = analyze(t);
  assert.strictEqual(r.findings.length, 1, 'findings: ' + r.findings.map((f) => f.ruleId));
  assert.strictEqual(r.findings[0].ruleId, id);
  assert.strictEqual(r.findings[0].severity === 'High' || r.findings[0].severity === 'Medium', true);
}));
test('arbitration clause reports the core rule even when engagement rules are enabled', () => {
  const r = RFD.analyze(REG[4][1], TAX, { groups: ['core', 'extra', 'engagement'] });
  assert.strictEqual(r.findings[0].ruleId, 'jury-waiver-arbitration');
});
test('false positive: "Nothing in this Agreement waives ... jury" yields no finding', () => {
  const t = 'Nothing in this Agreement waives either party\'s right to a trial by jury.';
  assert.strictEqual(analyze(t).findings.length, 0);
  assert.strictEqual(RFD.analyze(t, TAX, { groups: ['core', 'extra', 'engagement'] }).findings.length, 0);
});
[
  'The Company retains the right to a jury trial, and nothing herein shall require any party to waive trial by jury.',
  'This Agreement does not limit or waive any party\'s right to a jury trial.',
  'Each party preserves its right to a jury trial and the parties shall not be deemed to waive jury rights.'
].forEach((t, i) => test('preservation language is not flagged #' + (i + 1), () => assert.strictEqual(analyze(t).findings.length, 0, JSON.stringify(analyze(t).findings.map((f) => f.ruleId)))));
test('preservation language does not hide a real waiver in the next sentence', () => {
  assert.ok(hits('Nothing in this Section limits Customer\'s audit rights. Each party waives its right to a trial by jury.').has('jury-waiver-arbitration'));
});
test('plain mutual jury waiver still scores High (>= 70)', () => {
  const f = analyze('EACH PARTY WAIVES ITS RIGHT TO A TRIAL BY JURY').findings[0];
  assert.strictEqual(f.ruleId, 'jury-waiver-arbitration');
  assert.ok(f.score >= 70 && f.severity === 'High', 'score ' + f.score);
});
test('mutual mitigation still applies to other rules (confidentiality)', () => {
  const a = analyze('Customer shall keep all Provider information confidential in perpetuity.').findings;
  const b = analyze('Each party shall keep the other party\'s information confidential in perpetuity.').findings;
  assert.ok(a.length && b.length && b[0].score < a[0].score, 'a=' + (a[0] && a[0].score) + ' b=' + (b[0] && b[0].score));
});
test('ignore_modifiers skips only the listed modifier ids', () => {
  const tax = mini([rule('r', 60, 'trigger', { ignore_modifiers: ['mutual'] })], { scoring: { modifiers: [{ id: 'mutual', pattern: 'each party', delta: -8 }, { id: 'other', pattern: 'sole', delta: -4 }] } });
  assert.strictEqual(analyze('each party trigger sole', tax).findings[0].score, 56);
});
[
  'The Agreement begins on the Effective Date and ends on December 31, 2027 unless extended by a written amendment signed by both parties.',
  'Contractor remains free to work for any other client, including competitors of the Company, during and after the term.'
].forEach((t, i) => test('new benign clause #' + (i + 1) + ' stays clean', () => assert.strictEqual(analyze(t).findings.length, 0, JSON.stringify(analyze(t).findings.map((f) => f.ruleId)))));
test('widened patterns stay linear on adversarial input', () => {
  const t0 = Date.now();
  analyze('may ' + 'increase '.repeat(500) + 'x');
  analyze('not ' + 'to work '.repeat(500));
  analyze(('continues ' + 'a '.repeat(60)).repeat(60));
  analyze('unless ' + 'notice of '.repeat(400));
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});

console.log('Engagement group is opt-in');
const ENG = 'Client shall pay a non-refundable retainer of $5,000 which is earned upon receipt and will not be returned under any circumstances.';
test('engagement rules do not run by default', () => {
  const r = analyze(ENG);
  assert.ok(r.findings.every((f) => f.group !== 'engagement'));
  assert.deepStrictEqual(r.groups, ['core', 'extra']);
  assert.ok(!r.findings.some((f) => /^eng-/.test(f.ruleId)));
});
test('engagement rules run when opts.groups includes engagement', () => {
  const r = RFD.analyze(ENG, TAX, { groups: ['core', 'extra', 'engagement'] });
  assert.ok(r.findings.some((f) => f.group === 'engagement'), 'got ' + r.findings.map((f) => f.ruleId));
  assert.ok(r.groups.includes('engagement'));
});
test('default run over the sample never yields eng-* findings', () => {
  assert.ok(!analyze(SAMPLE).findings.some((f) => /^eng-/.test(f.ruleId)));
});
test('UI exposes the engagement toggle (default off) and the markdown export names the groups', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(/id="optEng"/.test(html) && !/id="optEng"[^>]*checked/.test(html));
  assert.ok(/Also check engagement-letter terms \(retainers, sponsor agreements\)/.test(html));
  assert.ok(/Rule groups checked: /.test(html) && /groups: state\.groups/.test(html));
});

console.log('One finding per clause, alsoMatches');
test('multi-rule clause yields one finding and lists the others', () => {
  const t = 'Customer shall indemnify, defend and hold harmless Provider from any and all claims, and all disputes shall be resolved by binding arbitration.';
  const r = analyze(t);
  assert.strictEqual(r.findings.length, 1);
  const f = r.findings[0];
  assert.strictEqual(f.ruleId, 'broad-indemnification');
  assert.ok(f.alsoMatches.includes('jury-waiver-arbitration'), 'alsoMatches: ' + f.alsoMatches);
  assert.ok(!f.alsoMatches.includes(f.ruleId));
});
test('the highest-scoring rule is the primary one', () => {
  const tax = mini([rule('low', 30, 'alpha'), rule('high', 60, 'beta')]);
  const f = analyze('alpha and beta in one clause', tax).findings;
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].ruleId, 'high');
  assert.deepStrictEqual(f[0].alsoMatches, ['low']);
});

console.log('Scoring');
test('score = base + aggravators + rule mitigator + global modifiers', () => {
  const tax = mini([rule('r', 50, 'trigger', { aggravators: [{ pattern: 'worse', delta: 10, reason: 'x' }], mitigators: ['better'], mitigator_delta: -6 })],
    { scoring: { modifiers: [{ id: 'g+', pattern: 'sole', delta: 4 }, { id: 'g-', pattern: 'mutual', delta: -3 }] } });
  const f = analyze('trigger worse better sole mutual', tax).findings[0];
  assert.strictEqual(f.score, 50 + 10 - 6 + 4 - 3);
  assert.strictEqual(f.mitigation, -9);
  assert.strictEqual(f.baseScore, 64);
  assert.strictEqual(f.mitigatorsFound.length, 2);
  assert.strictEqual(f.aggravatorsFound.length, 2);
});
test('mitigator_delta is applied once even if several mitigators match', () => {
  const tax = mini([rule('r', 50, 'trigger', { mitigators: ['one', 'two', 'three'], mitigator_delta: -7 })]);
  const f = analyze('trigger one two three', tax).findings[0];
  assert.strictEqual(f.score, 43);
  assert.strictEqual(f.mitigatorsFound.length, 3);
});
test('mitigation reduction is capped at 25 points', () => {
  const tax = mini([rule('r', 80, 'trigger', { mitigators: ['m1'], mitigator_delta: -20 })],
    { scoring: { modifiers: [{ id: 'a', pattern: 'ga', delta: -8 }, { id: 'b', pattern: 'gb', delta: -8 }] } });
  const f = analyze('trigger m1 ga gb', tax).findings[0];
  assert.strictEqual(f.mitigation, -25);
  assert.strictEqual(f.score, 55);
});
test('cap applies only to mitigation, aggravators are not capped', () => {
  const tax = mini([rule('r', 40, 'trigger', { aggravators: [{ pattern: 'a1', delta: 20 }, { pattern: 'a2', delta: 20 }], mitigators: ['m'], mitigator_delta: -30 })]);
  const f = analyze('trigger a1 a2 m', tax).findings[0];
  assert.strictEqual(f.score, 40 + 40 - 25);
});
test('score clamps to 100 and to 1', () => {
  const hi = mini([rule('r', 95, 'trigger', { aggravators: [{ pattern: 'x', delta: 30 }] })]);
  assert.strictEqual(analyze('trigger x', hi).findings[0].score, 100);
  const lo = mini([rule('r', 10, 'trigger', { mitigators: ['m'], mitigator_delta: -40 })]);
  assert.strictEqual(analyze('trigger m', lo).findings[0].score, 1);
});
test('severity boundaries follow the rubric (69/70, 39/40)', () => {
  const tax = mini([rule('a', 70, 'aaa'), rule('b', 69, 'bbb'), rule('c', 40, 'ccc'), rule('d', 39, 'ddd'), rule('e', 1, 'eee')]);
  const sev = {};
  analyze('aaa\n\nbbb\n\nccc\n\nddd\n\neee', tax).findings.forEach((f) => { sev[f.ruleId] = f.severity; });
  assert.deepStrictEqual(sev, { a: 'High', b: 'Medium', c: 'Medium', d: 'Low', e: 'Low' });
  assert.strictEqual(RFD.severityFor(100, TAX), 'High');
  assert.strictEqual(RFD.severityFor(1, TAX), 'Low');
});
test('summary counts match findings', () => {
  const tax = mini([rule('a', 80, 'aaa'), rule('b', 50, 'bbb'), rule('c', 20, 'ccc')]);
  const r = analyze('aaa\n\naaa again\n\nbbb\n\nccc', tax);
  assert.deepStrictEqual({ H: r.summary.High, M: r.summary.Medium, L: r.summary.Low, T: r.summary.total }, { H: 2, M: 1, L: 1, T: 4 });
});
test('a real clause with a cap and mutual language scores below its base', () => {
  const t = 'In no event shall either party be liable for indirect damages. Except for fraud, each party\'s aggregate liability shall not exceed the fees paid in the last twelve months.';
  const f = analyze(t).findings[0];
  assert.strictEqual(f.ruleId, 'one-sided-liability-limit');
  assert.ok(f.score < 65 && f.mitigation < 0 && f.mitigation >= -25);
});

console.log('Ranking');
test('findings are sorted by score desc, then document order', () => {
  const tax = mini([rule('a', 50, 'aaa'), rule('b', 80, 'bbb')]);
  const r = analyze('aaa one\n\nbbb one\n\naaa two\n\nbbb two', tax);
  assert.deepStrictEqual(r.findings.map((f) => f.ruleId + ':' + f.matches[0].text), ['b:bbb', 'b:bbb', 'a:aaa', 'a:aaa']);
  assert.ok(r.findings[0].matches[0].start < r.findings[1].matches[0].start);
  assert.ok(r.findings[2].matches[0].start < r.findings[3].matches[0].start);
  assert.deepStrictEqual(r.findings.map((f) => f.rank), [1, 2, 3, 4]);
});
test('ranking over the sample is non-increasing in score', () => {
  const r = analyze(SAMPLE);
  for (let i = 1; i < r.findings.length; i++) assert.ok(r.findings[i - 1].score >= r.findings[i].score);
});

console.log('QC checks');
test('QC warns when a required clause is absent', () => {
  const r = analyze('This is a short agreement about nothing in particular, signed on a Tuesday by two friendly parties.');
  const ids = r.qc.map((q) => q.id);
  assert.ok(ids.includes('qc-missing-governing-law'));
  assert.ok(ids.includes('qc-missing-termination'));
  const q = r.qc.find((x) => x.id === 'qc-missing-governing-law');
  assert.ok(q.title && q.severity && q.message);
});
test('QC stays quiet when the clause is present', () => {
  const r = analyze('This Agreement is governed by the laws of the State of Texas. Either party may terminate with thirty days notice.');
  const ids = r.qc.map((q) => q.id);
  assert.ok(!ids.includes('qc-missing-governing-law'));
  assert.ok(!ids.includes('qc-missing-termination'));
});
test('QC sees reversed cancellation-window phrasing', () => {
  const r = analyze('Customer must give at least 90 days notice of non-renewal before the term ends, otherwise the term continues.');
  assert.ok(!r.qc.some((q) => q.id === 'qc-missing-cancellation-window'));
});

console.log('Robustness');
test('bad regexes are skipped and never throw', () => {
  const bad = mini([
    rule('badtrig', 60, '(unclosed'),
    Object.assign(rule('mixed', 60, 'good'), { triggers: ['[', 'good', '*bad'], mitigators: ['(', 'fine'], aggravators: [{ pattern: '(', delta: 5 }, { pattern: 'ok', delta: 5 }], mitigator_delta: -5 })
  ], { scoring: { modifiers: [{ id: 'bad', pattern: '(?<', delta: 5 }, { id: 'ok', pattern: 'ok', delta: 2 }] }, qc_checks: [{ id: 'q', title: 't', severity: 'Low', message: 'm', trigger_absent: '(' }, { id: 'q2', title: 't', severity: 'Low', message: 'm', trigger_absent: 'zzz' }] });
  let r;
  assert.doesNotThrow(() => { r = analyze('good fine ok', bad); });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].ruleId, 'mixed');
  assert.strictEqual(r.findings[0].score, 60 + 5 - 5 + 2);
  assert.deepStrictEqual(r.qc.map((q) => q.id), ['q2']);
});
test('malformed taxonomy pieces do not throw', () => {
  assert.doesNotThrow(() => analyze('some text here', { rules: [null, 5, {}, { id: 'x' }, { id: 'y', triggers: 'nope' }] }));
  assert.doesNotThrow(() => analyze('some text here', {}));
});
test('input over 200,000 characters throws a clear error', () => {
  assert.throws(() => analyze('a'.repeat(200001)), /too large.*200000/i);
  assert.throws(() => analyze(12345), TypeError);
});
test('input of exactly 200,000 characters is accepted and fast', () => {
  const t0 = Date.now();
  const r = analyze('lorem ipsum dolor sit amet '.repeat(7400).slice(0, 200000));
  assert.ok(Array.isArray(r.findings));
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});
test('pathological repetition does not hang (backtracking guard)', () => {
  const t0 = Date.now();
  analyze(('indemnify ' + 'x '.repeat(200) + ' ').repeat(400));
  analyze('renew ' + 'a'.repeat(100000));
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});
test('a 20,000-word contract analyzes in under 3 seconds', () => {
  const body = (SAMPLE + '\n\n').repeat(Math.ceil(20000 / 687));
  const t0 = Date.now();
  const r = analyze(body.slice(0, 200000));
  assert.ok(r.findings.length > 100);
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});
test('empty and whitespace-only input yield an empty result', () => {
  const r = analyze('   \n\n  ');
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.summary.total, 0);
});

console.log('Clause splitting and offsets');
test('clause offsets index the original text exactly', () => {
  const r = analyze(SAMPLE);
  r.clauses.forEach((c) => assert.strictEqual(SAMPLE.slice(c.start, c.end), c.text));
  for (let i = 1; i < r.clauses.length; i++) assert.ok(r.clauses[i].start >= r.clauses[i - 1].end);
});
test('match, quote and mitigator offsets index the original text', () => {
  const text = '\n\n  Intro.\r\n\r\n1.1 Customer shall indemnify, defend and hold harmless Provider from any and all claims, except to the extent caused by Provider\'s gross negligence or willful misconduct.';
  const r = analyze(text);
  const f = r.findings[0];
  f.matches.forEach((m) => assert.strictEqual(text.slice(m.start, m.end), m.text));
  assert.strictEqual(text.slice(f.quote.start, f.quote.end), f.quote.text);
  f.mitigatorsFound.forEach((m) => assert.strictEqual(text.slice(m.start, m.end), m.text));
  assert.ok(f.mitigatorsFound.length >= 1);
});
test('numbered headings, Section and ARTICLE start new clauses without blank lines', () => {
  const t = '1. Term\nThe term is one year.\n1.1 Renewal\nIt renews.\nSection 4 Fees\nFees are due.\nARTICLE V Other\nMisc.';
  const heads = RFD.splitClauses(t).map((c) => c.text.split('\n')[0]);
  assert.deepStrictEqual(heads.slice(0, 4), ['1. Term', '1.1 Renewal', 'Section 4 Fees', 'ARTICLE V Other']);
});
test('blank-line paragraphs are separate clauses', () => {
  assert.strictEqual(RFD.splitClauses('First paragraph here.\n\nSecond paragraph here.\n\n\n\nThird one.').length, 3);
});
test('overlong paragraphs split at sentence boundaries', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog near the river bank. ';
  const t = sentence.repeat(120).trim();
  const cs = RFD.splitClauses(t);
  assert.ok(cs.length >= 3, 'got ' + cs.length);
  cs.forEach((c) => { assert.ok(c.text.length <= 2000); assert.ok(/[.]$/.test(c.text), 'ends mid-sentence: ' + c.text.slice(-20)); assert.strictEqual(t.slice(c.start, c.end), c.text); });
});
test('a single enormous sentence is hard-split below the regex cap', () => {
  const cs = RFD.splitClauses('word '.repeat(5000));
  assert.ok(cs.length > 1);
  cs.forEach((c) => assert.ok(c.text.length <= RFD.MAX_PASS));
});
test('clauses inherit a parent section heading and a locator', () => {
  const r = RFD.splitClauses('8. Indemnification\n\n8.1 Customer shall indemnify Provider.');
  const c = r.find((x) => x.locator === 'Section 8.1');
  assert.ok(c); assert.strictEqual(c.heading, 'Indemnification');
});
test('governing law is detected', () => {
  assert.strictEqual(RFD.detectGoverningLaw('This Agreement is governed by the laws of the State of Delaware, without regard to conflicts.'), 'Delaware');
  assert.strictEqual(RFD.detectGoverningLaw('Nothing here.'), null);
});

console.log('Taxonomy hygiene');
test('every taxonomy regex compiles', () => {
  const bad = [];
  const tryRe = (where, p) => { try { new RegExp(p, 'i'); } catch (e) { bad.push(where + ': ' + p); } };
  TAX.rules.forEach((r) => {
    r.triggers.forEach((p) => tryRe(r.id + ' trigger', p));
    r.mitigators.forEach((p) => tryRe(r.id + ' mitigator', p));
    r.aggravators.forEach((a) => tryRe(r.id + ' aggravator', a.pattern));
  });
  TAX.scoring.modifiers.forEach((m) => tryRe('modifier ' + m.id, m.pattern));
  TAX.qc_checks.forEach((q) => tryRe('qc ' + q.id, q.trigger_absent));
  assert.deepStrictEqual(bad, []);
});
test('rule ids are unique and the five core rules exist', () => {
  const ids = TAX.rules.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  ['auto-renewal-trap', 'unilateral-change', 'broad-indemnification', 'non-compete-restrictive-covenant', 'jury-waiver-arbitration'].forEach((id) => assert.ok(ids.includes(id), id));
});

console.log('Sample contract');
test('sample yields all five core categories', () => {
  const r = analyze(SAMPLE);
  const primaryIds = r.findings.map((f) => f.ruleId);
  ['auto-renewal-trap', 'unilateral-change', 'broad-indemnification', 'non-compete-restrictive-covenant', 'jury-waiver-arbitration'].forEach((id) => assert.ok(primaryIds.includes(id), 'missing ' + id));
});
test('sample meets the spec: 8+ findings, every severity, 5+ categories, 2+ with mitigators, #1 is High', () => {
  const r = analyze(SAMPLE);
  assert.ok(r.findings.length >= 8, 'findings ' + r.findings.length);
  assert.ok(r.summary.High > 0 && r.summary.Medium > 0 && r.summary.Low > 0, JSON.stringify(r.summary));
  assert.ok(new Set(r.findings.map((f) => f.category)).size >= 5);
  assert.ok(r.findings.filter((f) => f.mitigatorsFound.length > 0).length >= 2);
  assert.strictEqual(r.findings[0].severity, 'High');
  assert.strictEqual(r.governingLaw, 'Delaware');
});
test('sample benign clauses are not flagged', () => {
  const r = analyze(SAMPLE);
  const flagged = r.findings.map((f) => f.quote.text).join('\n');
  ['Provider will process Customer Data solely', 'Notices must be sent by email', 'entire agreement', 'employees to use the Service'].forEach((s) => assert.ok(flagged.indexOf(s) === -1, 'flagged benign: ' + s));
});
test('sample is labelled fictional', () => {
  assert.ok(/^SAMPLE ONLY - FICTIONAL CONTRACT/.test(SAMPLE));
  const words = SAMPLE.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 600 && words <= 1300, 'words ' + words);
});
test('finding objects carry the documented API fields', () => {
  const f = analyze(SAMPLE).findings[0];
  ['id', 'clauseId', 'ruleId', 'category', 'title', 'group', 'severity', 'score', 'matches', 'why', 'fix', 'jurisdictionNote', 'mitigatorsFound', 'aggravatorsFound', 'alsoMatches'].forEach((k) => assert.ok(k in f, 'missing ' + k));
  const r = analyze(SAMPLE);
  assert.ok(r.clauses[0].id && 'start' in r.clauses[0] && 'end' in r.clauses[0] && 'text' in r.clauses[0]);
  assert.ok(Array.isArray(r.qc));
  ['High', 'Medium', 'Low', 'total'].forEach((k) => assert.ok(k in r.summary));
});

console.log('Regression round 2: wording variants, wrong rule, false positive');
const R2_POS = [
  ['unilateral-change', 'The rates in Schedule A are subject to modification by Supplier at its discretion on thirty days\' notice, and Buyer\'s sole remedy if it objects is to stop using the Services.'],
  ['unilateral-change', 'Company reserves the unilateral right to raise the price of any plan, tier or add-on without Customer\'s consent.'],
  ['broad-indemnification', 'Subscriber shall hold Provider entirely harmless from every claim, cost, expense and liability whatsoever, including those resulting from Provider\'s sole negligence or willful misconduct.'],
  ['broad-indemnification', 'Tenant assumes all risk and agrees to indemnify Landlord against any and all loss, injury or damage of any nature occurring on or about the premises, howsoever caused.'],
  ['non-compete-restrictive-covenant', 'Following separation from the Company for any reason, Associate will refrain from working in a competing capacity for a period of eighteen months within the Tri-State area.'],
  ['jury-waiver-arbitration', 'The parties knowingly relinquish any entitlement to have disputes decided by a jury, and agree that all claims will be determined by a single arbitrator whose decision is final.'],
  // additional differently worded positives
  ['unilateral-change', 'Vendor may revise the subscription charges from time to time at its sole discretion and the revised charges apply immediately.'],
  ['unilateral-change', 'Our pricing is subject to adjustment at any time, and we may implement any increase to the fees without Client\'s prior consent.'],
  ['broad-indemnification', 'Contractor must defend and reimburse Owner for all claims, damages and liabilities connected with the Work, however caused.'],
  ['broad-indemnification', 'Licensee agrees to hold the Licensor and its affiliates completely harmless from any suit, loss or cost of any kind.'],
  ['non-compete-restrictive-covenant', 'After the termination of employment, Employee shall not accept a role with any competitor of the Company for twenty-four months within a fifty-mile radius.'],
  ['non-compete-restrictive-covenant', 'Upon resignation, Executive will abstain from engaging in any business that competes with Employer for a period of two years in the Northeast region.'],
  ['jury-waiver-arbitration', 'Both sides forgo any entitlement to a jury and agree that every dispute will be settled by a sole arbitrator.'],
  ['jury-waiver-arbitration', 'User may not bring or join a class action, and renounces the right to have any claim tried before a jury.']
];
R2_POS.forEach(([id, t], i) => test('round2 positive #' + (i + 1) + ' ' + id, () => {
  assert.ok(hits(t).has(id), 'expected ' + id + ' for: ' + t + ' got ' + [...hits(t)].join(','));
}));
test('round2: arbitration clause is not mislabelled broad-indemnification', () => {
  const t = R2_POS[5][1];
  const r = analyze(t);
  assert.ok(!hits(t).has('broad-indemnification'));
  assert.strictEqual(r.findings[0].ruleId, 'jury-waiver-arbitration');
});
test('round2: bare "all claims" without an indemnity verb is not broad-indemnification', () => {
  assert.ok(!hits('The parties agree that all claims will be submitted to the courts of the agreed venue.').has('broad-indemnification'));
});
test('round2: seat increase is not a unilateral price change', () => {
  const t = 'Customer may increase the number of seats at any time by notifying Provider, and additional seats will be charged at the rate then stated in the order form.';
  assert.strictEqual(analyze(t).findings.length, 0, JSON.stringify(analyze(t).findings.map((f) => f.ruleId)));
});
test('round2: price increases by Provider stay flagged', () => {
  assert.ok(hits('Provider may increase the fees at any time by notifying Customer.').has('unilateral-change'));
  assert.ok(hits('Provider may, at any time and in its sole discretion, increase the fees payable under this Agreement.').has('unilateral-change'));
});
[
  'Customer may reduce the number of seats at any time on written notice, effective from the next billing period.',
  'Either party may terminate this Agreement for material breach by the other party on 30 days written notice if the breach remains uncured.',
  'Each party shall keep the other party\'s Confidential Information confidential and use it only to perform this Agreement.'
].forEach((t, i) => test('round2 benign near-miss #' + (i + 1) + ' yields no finding', () => {
  assert.strictEqual(analyze(t).findings.length, 0, JSON.stringify(analyze(t).findings.map((f) => f.ruleId)) + ' ' + t);
}));

console.log('Round 3: ReDoS, recall, Markdown escaping, build hardening');
const timeMs = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
test('analyze() on 200k digits finishes in under 1 second', () => {
  const ms = timeMs(() => analyze('1'.repeat(200000)));
  assert.ok(ms < 1000, 'took ' + ms.toFixed(0) + ' ms');
});
test('analyze() on 10 runs of 20k digits finishes in under 1 second each', () => {
  for (let i = 0; i < 10; i++) {
    const ms = timeMs(() => analyze('1'.repeat(20000)));
    assert.ok(ms < 1000, 'run ' + i + ' took ' + ms.toFixed(0) + ' ms');
  }
});
test('every taxonomy regex runs under 200 ms on 200k of 1, a, space, "a ", "1 "', () => {
  const pats = [];
  TAX.rules.forEach((r) => {
    (r.triggers || []).forEach((x) => pats.push([r.id + ' trigger', x]));
    (r.mitigators || []).forEach((x) => pats.push([r.id + ' mitigator', x]));
    (r.aggravators || []).forEach((a) => pats.push([r.id + ' aggravator', a.pattern]));
  });
  ((TAX.scoring && TAX.scoring.modifiers) || []).forEach((m) => pats.push(['modifier ' + m.id, m.pattern]));
  (TAX.qc_checks || []).forEach((q) => pats.push([q.id + ' qc', q.trigger_absent]));
  assert.ok(pats.length > 100, 'collected ' + pats.length);
  const inputs = ['1', 'a', ' ', 'a ', '1 '].map((u) => u.repeat(Math.ceil(200000 / u.length)).slice(0, 200000));
  const slow = [];
  pats.forEach(([name, src]) => {
    if (typeof src !== 'string' || !src) return;
    const re = new RegExp(src, 'gi');
    inputs.forEach((inp, k) => {
      re.lastIndex = 0;
      const ms = timeMs(() => { let m, n = 0; while ((m = re.exec(inp)) && n++ < 1000) { if (m[0] === '') re.lastIndex++; } });
      if (ms >= 200) slow.push(name + ' on input#' + k + ': ' + ms.toFixed(0) + ' ms');
    });
  });
  assert.deepStrictEqual(slow, []);
});
test('recall: reserve the right to adjust subscription charges / price nouns', () => {
  assert.ok(hits('We reserve the right to adjust subscription charges from time to time without your consent.').has('unilateral-change'));
  ['pricing', 'the price list', 'prices', 'fees', 'rates', 'the tariff'].forEach((n) => {
    assert.ok(hits('Provider reserves the right to adjust ' + n + ' at any time.').has('unilateral-change'), n);
  });
});
test('recall: employee non-compete phrased as shall not work for any competing business', () => {
  assert.ok(hits('Employee shall not, for two years after employment ends, work for any business competing with the Company anywhere in the United States.').has('non-compete-restrictive-covenant'));
});
test('recall near-misses stay clean', () => {
  [
    'Provider may adjust subscription seats at any time to match the number of active users.',
    'The employee is competent and shall work for the Company in good faith for the benefit of all clients.',
    'Employee shall not work on weekends for the Company; the Company is competent in this field.'
  ].forEach((t) => {
    const h = hits(t);
    assert.ok(!h.has('unilateral-change') && !h.has('non-compete-restrictive-covenant'), t);
  });
});
test('Markdown export escapes contract-derived text (mdEsc / buildMarkdown)', () => {
  const vm = require('node:vm');
  const tpl = fs.readFileSync(path.join(__dirname, 'index.template.html'), 'utf8');
  const a = tpl.indexOf('function mdEsc('), b = tpl.indexOf('async function copyMarkdown');
  assert.ok(a > 0 && b > a, 'markdown functions found');
  const evil = '![x](https://evil.example/t?id=1)';
  const finding = { id: 'f1', rank: 1, severity: 'High', dcat: 'Cat', ctitle: '1. *Bold* [h](u)', title: 'T', score: 80, baseScore: 80, mitigation: 0, locator: 'Section 1',
    quote: { text: 'Customer pays. ' + evil + '\n- list item' }, why: 'w', fix: 'f', jurisdictionNote: '',
    mitigatorsFound: [{ text: 'see ' + evil }] };
  const ctx = vm.createContext({
    state: { reviewed: new Set(), result: { governingLaw: null, qc: [] }, groups: ['core'] },
    openFindings: () => [finding], summaryCounts: () => ({ total: 1, High: 1, Medium: 0, Low: 0 }),
    plural: (n, w) => n + ' ' + w, trunc: (x) => x, DISCLAIMER: 'd', today: () => '2000-01-01', groupsLabel: () => 'core'
  });
  vm.runInContext(tpl.slice(a, b).replace('function today() { return new Date().toISOString().slice(0, 10); }', ''), ctx);
  const md = vm.runInContext('buildMarkdown()', ctx);
  assert.ok(md.indexOf(evil) === -1, 'raw payload must not appear');
  assert.ok(md.indexOf('\\!\\[x\\]\\(https://evil.example/t?id=1\\)') !== -1, 'escaped payload present');
  assert.ok(md.indexOf('\\*Bold\\* \\[h\\]\\(u\\)') !== -1, 'heading escaped');
  assert.ok(md.indexOf('> \\- list item') !== -1, 'leading dash escaped');
  assert.strictEqual(vm.runInContext('mdEsc("a\\\\b`c*d_e{f}g[h]i(j)k#l+m!n|o<p>q~r")', ctx), 'a\\\\b\\`c\\*d\\_e\\{f\\}g\\[h\\]i\\(j\\)k\\#l\\+m\\!n\\|o\\<p\\>q\\~r');
});
test('template: docx hardening and worker fallback rules are in place', () => {
  const tpl = fs.readFileSync(path.join(__dirname, 'index.template.html'), 'utf8');
  assert.ok(/var MAX_XML = 10 \* 1024 \* 1024;/.test(tpl) && !/40 \* 1024 \* 1024/.test(tpl));
  assert.ok(/<!DOCTYPE\/i\.test\(xml\)/.test(tpl));
  assert.ok(/onerror = function[^\n]*finish\(null, new Error/.test(tpl) && !/onerror[^\n]*syncRun/.test(tpl));
  assert.ok(/state\.text\.length <= 50000\) syncRun\(\)/.test(tpl));
});
test('build.js injects in a single pass and refuses "</script" / "<!--"', () => {
  const b = fs.readFileSync(path.join(__dirname, 'build.js'), 'utf8');
  assert.ok(/html\.replace\(\/__TAXONOMY__\|__SAMPLE__/.test(b) && /<!--/.test(b));
});

console.log('Build output');
test('index.html is generated from the single sources', () => {
  const htmlPath = path.join(__dirname, 'index.html');
  assert.ok(fs.existsSync(htmlPath), 'run node build.js first');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = /<script type="application\/json" id="taxonomy">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'taxonomy block');
  assert.deepStrictEqual(JSON.parse(m[1]), TAX);
  const s = /<script type="application\/json" id="sample">([\s\S]*?)<\/script>/.exec(html);
  assert.strictEqual(JSON.parse(s[1]), SAMPLE.replace(/\r\n?/g, '\n'));
  assert.ok(html.indexOf(fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8')) !== -1, 'engine inlined verbatim');
  assert.ok(!/__TAXONOMY__|__SAMPLE__|__ENGINE__/.test(html));
});
test('index.html never uses innerHTML/outerHTML/insertAdjacentHTML/document.write/eval', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const app = html.slice(html.lastIndexOf('<script>'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/.test(app));
});
test('index.html makes no network requests and uses no storage or external assets', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  // The only allowed non-app payloads are the two vendored pdf.js blocks: inert text/plain, pure base64.
  const vend = /<script type="text\/plain" id="(pdfjs-lib|pdfjs-worker)">([A-Za-z0-9+\/]+=*)<\/script>/g;
  const ids = []; let m;
  while ((m = vend.exec(html))) ids.push(m[1]);
  assert.deepStrictEqual(ids.sort(), ['pdfjs-lib', 'pdfjs-worker'], 'exactly the two vendored pdf.js blocks, base64 only');
  const stripped = html.replace(vend, '<!--vendored-->');
  assert.ok(stripped.length < 400000, 'nothing else large is embedded (' + stripped.length + ' chars after removing pdf.js blobs)');
  const app = stripped.slice(stripped.lastIndexOf('<script>'));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie/.test(stripped.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '')), 'no fetch/XHR/WebSocket/beacon/storage in page code');
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|@import|url\(\s*['"]?https?:/i.test(stripped));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/|schemas\.openxmlformats\.org\/)[^\s"'<>)]+/.test(app.replace(/\/\*[\s\S]*?\*\//g, '')), 'no external URLs in app script');
  assert.ok(/connect-src 'none'/.test(html) && /default-src 'none'/.test(html));
});
test('CSP: only blob: added to script-src; no remote hosts, no wasm-unsafe-eval, no unsafe-eval', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  const dirs = {}; csp.split(';').forEach((d) => { const [k, ...v] = d.trim().split(/\s+/); if (k) dirs[k] = v; });
  assert.deepStrictEqual(dirs['script-src'], ["'unsafe-inline'", 'blob:']);
  assert.deepStrictEqual(dirs['worker-src'], ['blob:']);
  assert.deepStrictEqual(dirs['connect-src'], ["'none'"]);
  assert.deepStrictEqual(dirs['default-src'], ["'none'"]);
  assert.ok(!/unsafe-eval|wasm-unsafe-eval|https?:|\*/.test(csp), csp);
});
test('template: PDF import rules (lazy load, limits, friendly errors, no innerHTML)', () => {
  const tpl = fs.readFileSync(path.join(__dirname, 'index.template.html'), 'utf8');
  assert.ok(/pdfBytes: 15 \* 1024 \* 1024/.test(tpl) && /pdfPages: 300/.test(tpl) && /fileBytes: 2 \* 1024 \* 1024/.test(tpl));
  assert.ok(!/UNSUPPORTED = \{[^}]*\bpdf:/.test(tpl), 'pdf removed from UNSUPPORTED');
  assert.ok(/accept="[^"]*\.pdf/.test(tpl));
  assert.ok(/isEvalSupported: false/.test(tpl) && /useSystemFonts: true/.test(tpl) && !/cMapUrl|standardFontDataUrl|wasmUrl/.test(tpl));
  assert.ok(/await import\(libUrl\)/.test(tpl) && /GlobalWorkerOptions\.workerSrc = workerUrl/.test(tpl));
  assert.ok(/task\.destroy\(\)/.test(tpl), 'pdf.js document/worker destroyed after reading');
  assert.ok(tpl.indexOf("This PDF looks scanned (images, no text). OCR isn't built in; paste the text or use a text version.") !== -1);
  assert.ok(tpl.indexOf('This PDF is password-protected. Remove the password and try again.') !== -1);
  assert.ok(/Scanned PDFs \(pictures of pages\) are not/.test(tpl));
});
test('build.js embeds pdf.js as base64 text/plain blocks and still guards "</script" / "<!--"', () => {
  const b = fs.readFileSync(path.join(__dirname, 'build.js'), 'utf8');
  assert.ok(/toString\('base64'\)/.test(b) && /__PDFJS_LIB__/.test(b) && /__PDFJS_WORKER__/.test(b));
});

/* ---------- PDF import: the SAME extraction function the page uses, run on real fixtures with pdf.js (legacy build, node) ---------- */
console.log('PDF import');
const PdfText = require('./vendor/pdf-extract.js');
const FX = (f) => path.join(__dirname, 'fixtures', f);
const LEGACY = process.env.PDFJS_LEGACY_DIR || '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build';
let pdfjsP = null;
const pdfjs = () => pdfjsP || (pdfjsP = import(require('node:url').pathToFileURL(path.join(LEGACY, 'pdf.mjs')).href).then((m) => {
  m.GlobalWorkerOptions.workerSrc = require('node:url').pathToFileURL(path.join(LEGACY, 'pdf.worker.mjs')).href;   // node: fake worker, no thread
  return m;
}));
async function openPdf(buf) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, useWorkerFetch: false, enableXfa: false, verbosity: 0 });
  return { task, doc: await task.promise };
}
async function extractFile(f, opts) {
  const { task, doc } = await openPdf(fs.readFileSync(FX(f)));
  try { return await PdfText.extract(doc, opts); } finally { await task.destroy(); }
}
const ruleSet = (text) => { const r = analyze(text); const set = new Set(); r.findings.forEach((x) => { set.add(x.ruleId); x.alsoMatches.forEach((a) => set.add(a)); }); return { set, r }; };
const CORE5 = ['auto-renewal-trap', 'unilateral-change', 'broad-indemnification', 'non-compete-restrictive-covenant', 'jury-waiver-arbitration'];

testAsync('sample-contract.pdf: same five core categories and same severity counts as the txt sample', async () => {
  const res = await extractFile('sample-contract.pdf');
  assert.ok(!res.scanned && res.pagesRead >= 2, 'pages: ' + res.pagesRead);
  const pdf = ruleSet(res.text), txt = ruleSet(SAMPLE);
  CORE5.forEach((id) => assert.ok(pdf.set.has(id), 'PDF text missing ' + id));
  assert.deepStrictEqual([...pdf.set].sort(), [...txt.set].sort());
  assert.deepStrictEqual(pdf.r.summary, txt.r.summary);
});
testAsync('simple-agreement.pdf (3 pages): reads every page, keeps paragraph breaks, finds core rules', async () => {
  const res = await extractFile('simple-agreement.pdf');
  assert.strictEqual(res.pagesRead, 3); assert.strictEqual(res.truncated, false); assert.strictEqual(res.scanned, false);
  assert.ok(/\n\n1\. Services\n\n1\.1 Provider will deliver/.test(res.text), 'paragraph breaks preserved');
  assert.ok(!/\n\n\n/.test(res.text));
  const { set } = ruleSet(res.text);
  CORE5.forEach((id) => assert.ok(set.has(id), 'missing ' + id));
});
testAsync('scanned.pdf (image-only pages) is flagged as scanned with no text', async () => {
  const res = await extractFile('scanned.pdf');
  assert.strictEqual(res.scanned, true); assert.strictEqual(res.text, ''); assert.ok(res.avgChars < PdfText.SCAN_AVG);
});
testAsync('password.pdf rejects with PasswordException', async () => {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(fs.readFileSync(FX('password.pdf'))), verbosity: 0 });
  try { await task.promise; assert.fail('should have rejected'); }
  catch (e) { assert.strictEqual(e.name, 'PasswordException'); }
  finally { await task.destroy(); }
});
testAsync('plain text renamed .pdf is rejected by the %PDF- header check (and a text file with junk is not a PDF)', async () => {
  assert.strictEqual(PdfText.hasPdfHeader(fs.readFileSync(FX('not-really.pdf'))), false);
  assert.strictEqual(PdfText.hasPdfHeader(fs.readFileSync(FX('sample-contract.pdf'))), true);
  assert.strictEqual(PdfText.hasPdfHeader(Buffer.concat([Buffer.alloc(300, 0x20), Buffer.from('%PDF-1.7\n')])), true, 'header within first 1024 bytes');
  assert.strictEqual(PdfText.hasPdfHeader(Buffer.concat([Buffer.alloc(2000, 0x20), Buffer.from('%PDF-1.7\n')])), false, 'header after 1024 bytes');
  assert.strictEqual(PdfText.hasPdfHeader(new Uint8Array(0)), false);
});
testAsync('corrupt (truncated) PDF rejects with an error and does not hang', async () => {
  const buf = fs.readFileSync(FX('sample-contract.pdf')).subarray(0, 700);
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(buf), verbosity: 0 });
  let err = null;
  try { const doc = await task.promise; await PdfText.extract(doc); } catch (e) { err = e; } finally { await task.destroy(); }
  assert.ok(err && err.name !== 'PasswordException', 'expected a non-password error, got ' + (err && err.name));
});
testAsync('page cap: 305-page document reads only 300 pages and reports truncation; cancel stops early', async () => {
  let got = 0;
  const mk = (n) => ({ numPages: n, getPage: async () => { got++; return { getTextContent: async () => ({ items: [{ str: 'x'.repeat(40), transform: [10, 0, 0, 10, 50, 700], width: 200, height: 10 }] }), cleanup() {} }; } });
  const r = await PdfText.extract(mk(305), { maxPages: 300 });
  assert.strictEqual(r.pagesRead, 300); assert.strictEqual(r.truncated, true); assert.strictEqual(got, 300);
  const r2 = await PdfText.extract(mk(10));
  assert.strictEqual(r2.truncated, false);
  let calls = 0;
  const r3 = await PdfText.extract(mk(50), { isCancelled: () => ++calls > 3 });
  assert.strictEqual(r3.cancelled, true);
});

const item = (str, x, y, w, h) => ({ str, transform: [h || 10, 0, 0, h || 10, x, y], width: w == null ? str.length * 5 : w, height: h || 10 });
test('pageText: lines by y (tolerance), left-to-right, spaces only at gaps', () => {
  const t = PdfText.pageText([item('World', 100, 700.8), item('Hello', 50, 700), item('Next', 50, 686)]);
  assert.strictEqual(t, 'Hello World\nNext');
  assert.strictEqual(PdfText.pageText([item('Hel', 50, 700), item('lo', 65, 700)]), 'Hello', 'touching fragments join without a space');
  assert.strictEqual(PdfText.pageText([item('Hello', 50, 700), item(' ', 75, 700, 3), item('there', 78, 700)]), 'Hello there', 'no double space');
});
test('pageText: blank line only when the vertical gap exceeds ~1.5x the normal line gap', () => {
  const lines = [item('a1', 50, 700), item('a2', 50, 686), item('a3', 50, 672), item('b1', 50, 644), item('b2', 50, 630)];
  assert.strictEqual(PdfText.pageText(lines), 'a1\na2\na3\n\nb1\nb2');
});
test('pageText: hyphenated word merged only when the next line starts lowercase', () => {
  const mk = (a, b) => PdfText.pageText([item(a, 50, 700), item(b, 50, 686), item('pad', 50, 672), item('pad', 50, 658)]);
  assert.strictEqual(mk('the agree-', 'ment is signed').split('\n')[0], 'the agreement is signed');
  assert.strictEqual(mk('the agree-', 'Ment is signed').split('\n')[0], 'the agree-');
  assert.strictEqual(mk('well -', 'known').split('\n')[0], 'well -');
  assert.strictEqual(mk('term of 12-', '24 months').split('\n')[0], 'term of 12-');
});
test('pageText: ligatures and odd spaces are normalised; empty and non-text items ignored', () => {
  assert.strictEqual(PdfText.pageText([item('oﬃce clﬁ', 50, 700)]), 'office clfi');
  assert.strictEqual(PdfText.pageText([{ type: 'beginMarkedContent' }, item('', 10, 10)]), '');
});

(async () => {
  for (const [name, fn] of asyncQueue) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + String(e && e.message).split('\n').join('\n       ')); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('Failed: ' + failures.join('; ')); process.exit(1); }
})();
