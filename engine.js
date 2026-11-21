/*! Red Flag & Risk Detector: detection engine. Pure, no DOM, no dependencies.
 *  Browser: window.RFD   Node: require('./engine.js')
 *  analyze(text, taxonomy, opts) -> { clauses, findings, qc, summary, groups, governingLaw }
 *  opts.groups: rule groups to run (default ['core','extra']; add 'engagement' for engagement-letter rules)
 *  Flags text patterns for lawyer review. It is not legal advice. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RFD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_INPUT = 200000;       // total characters accepted
  var MAX_PASS = 5000;          // characters of one clause fed to one regex pass
  var SPLIT_TARGET = 1800;      // overlong paragraphs are split near this size
  var MITIGATION_CAP = 25;      // max points removed by mitigation
  var MAX_MATCHES = 25;         // per regex per clause

  var DEFAULT_GROUPS = ['core', 'extra'];

  var DEFAULT_RUBRIC = {
    High: { score_range: [70, 100] },
    Medium: { score_range: [40, 69] },
    Low: { score_range: [1, 39] }
  };

  /* ---------- helpers ---------- */

  function compile(pattern) {
    try {
      if (typeof pattern !== 'string' || !pattern) return null;
      return new RegExp(pattern, 'gi');
    } catch (e) {
      return null;
    }
  }

  // All matches of a global regex in text (zero-length safe, capped).
  function allMatches(re, text) {
    var out = [];
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      if (out.length >= MAX_MATCHES) break;
    }
    re.lastIndex = 0;
    return out;
  }

  function severityFor(score, taxonomy) {
    var rub = (taxonomy && taxonomy.severity_rubric) || DEFAULT_RUBRIC;
    var order = ['High', 'Medium', 'Low'];
    for (var i = 0; i < order.length; i++) {
      var r = rub[order[i]] || DEFAULT_RUBRIC[order[i]];
      var range = r.score_range || DEFAULT_RUBRIC[order[i]].score_range;
      if (score >= range[0] && score <= range[1]) return order[i];
    }
    return score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
  }

  /* ---------- clause splitting ---------- */

  var HEADING_RE = new RegExp(
    '^\\s*(?:' +
    '\\d+(?:\\.\\d+)+\\.?\\s+\\S' +                      // 1.1  text
    '|\\d+[.)]\\s+\\S' +                                 // 1. text / 1) text
    '|(?:ARTICLE|Article|SECTION|Section|CLAUSE|Clause)\\s+(?:\\d+(?:\\.\\d+)*|[IVXLC]+)(?:\\s*[.:\\-\\u2013\\u2014)]|\\s*$|\\s+[A-Z])' +
    ')'
  );

  function isHeadingLine(line) { return HEADING_RE.test(line); }

  function trimRange(text, s, e) {
    while (s < e && /\s/.test(text.charAt(s))) s++;
    while (e > s && /\s/.test(text.charAt(e - 1))) e--;
    return { start: s, end: e };
  }

  // Sentence ranges inside text[from,to) (absolute offsets), trimmed.
  function sentenceRanges(text, from, to) {
    var out = [];
    var re = /[.!?]["')\]”’]*\s+(?=["(“‘]?[A-Z0-9])/g;
    var seg = text.slice(from, to);
    var last = 0, m;
    while ((m = re.exec(seg)) !== null) {
      var end = m.index + m[0].length;
      out.push(trimRange(text, from + last, from + end));
      last = end;
    }
    if (last < seg.length) out.push(trimRange(text, from + last, to));
    return out.filter(function (r) { return r.end > r.start; });
  }

  // Break one block that is too long into pieces near SPLIT_TARGET at sentence boundaries.
  function splitLongBlock(text, s, e) {
    if (e - s <= SPLIT_TARGET) return [{ start: s, end: e }];
    var sents = sentenceRanges(text, s, e);
    var pieces = [];
    var cur = null;
    function push(r) { pieces.push(r); }
    sents.forEach(function (sn) {
      // hard-split a single enormous sentence at whitespace
      var parts = [];
      var a = sn.start;
      while (sn.end - a > MAX_PASS - 500) {
        var cut = text.lastIndexOf(' ', a + MAX_PASS - 500);
        if (cut <= a) cut = a + MAX_PASS - 500;
        parts.push({ start: a, end: cut });
        a = cut;
      }
      parts.push({ start: a, end: sn.end });
      parts.forEach(function (p) {
        p = trimRange(text, p.start, p.end);
        if (p.end <= p.start) return;
        if (!cur) { cur = { start: p.start, end: p.end }; return; }
        if (p.end - cur.start > SPLIT_TARGET) { push(cur); cur = { start: p.start, end: p.end }; }
        else cur.end = p.end;
      });
    });
    if (cur) push(cur);
    return pieces;
  }

  function splitClauses(text) {
    var blocks = [];
    var cur = null;
    var pos = 0;
    var len = text.length;
    function flush() {
      if (cur) {
        var r = trimRange(text, cur.start, cur.end);
        if (r.end > r.start) blocks.push(r);
        cur = null;
      }
    }
    while (pos <= len) {
      var nl = text.indexOf('\n', pos);
      var lineEnd = nl === -1 ? len : nl;
      var line = text.slice(pos, lineEnd);
      if (line.trim() === '') {
        flush();
      } else {
        if (cur && isHeadingLine(line)) flush();
        if (!cur) cur = { start: pos, end: lineEnd };
        else cur.end = lineEnd;
      }
      if (nl === -1) break;
      pos = nl + 1;
    }
    flush();

    // merge a short heading-only block into the following body block
    var merged = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var t = text.slice(b.start, b.end);
      var next = blocks[i + 1];
      if (next && t.indexOf('\n') === -1 && t.length <= 80 && isHeadingLine(t) &&
          !isHeadingLine(text.slice(next.start, next.end).split('\n')[0]) && !/[.;]$/.test(t.replace(/^\s*\d+[.)]\s*/, '')) ) {
        blocks[i + 1] = { start: b.start, end: next.end };
        continue;
      }
      merged.push(b);
    }

    var clauses = [];
    var parents = []; // heading-only clauses seen so far
    merged.forEach(function (b) {
      splitLongBlock(text, b.start, b.end).forEach(function (p) {
        var ctext = text.slice(p.start, p.end);
        var info = headingInfo(ctext);
        var heading = info.heading;
        if (!heading && info.num && info.num.indexOf('.') !== -1) {
          for (var k = parents.length - 1; k >= 0; k--) {
            if (info.num.indexOf(parents[k].num + '.') === 0) { heading = parents[k].heading; break; }
          }
        }
        var cl = {
          id: 'c' + (clauses.length + 1),
          start: p.start,
          end: p.end,
          text: ctext,
          heading: heading,
          locator: info.locator,
          headingOnly: info.only
        };
        if (info.only) parents.push({ num: info.num, heading: info.heading });
        clauses.push(cl);
      });
    });
    return clauses;
  }

  var SMALL_WORDS = /^(a|an|and|the|of|to|in|on|for|or|by|with|at|as|vs)$/i;
  function looksLikeTitle(h) {
    var words = h.split(/\s+/);
    if (words.length > 9) return false;
    return words.every(function (w) { return SMALL_WORDS.test(w) || /^[A-Z0-9("&]/.test(w); });
  }

  function headingInfo(ctext) {
    var none = { heading: null, locator: null, num: null, only: false };
    var first = ctext.split('\n')[0];
    if (!isHeadingLine(first)) return none;
    var m = /^\s*(?:(ARTICLE|Article|SECTION|Section|CLAUSE|Clause)\s+)?(\d+(?:\.\d+)*|[IVXLC]+)\s*[.):\-\u2013\u2014]?\s*(.*)$/.exec(first);
    if (!m) return none;
    var word = m[1] ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : 'Section';
    var info = { heading: null, locator: word + ' ' + m[2], num: m[2], only: false };
    var rest = (m[3] || '').trim();
    var hm;
    if (ctext.indexOf('\n') === -1 && rest && rest.length <= 90 && (hm = /^([A-Z][^.:\n]{0,80}?)\s*[.:]?$/.exec(rest)) && looksLikeTitle(hm[1])) {
      info.heading = hm[1]; info.only = true;           // heading on its own line
    } else if ((hm = /^([A-Z][^.:\n]{1,60}?)\s*[:\u2013\u2014]\s+\S/.exec(rest)) && looksLikeTitle(hm[1])) {
      info.heading = hm[1];                              // "Title: body"
    } else if ((hm = /^([A-Z][^.:\n]{1,40}?)\.\s+[A-Z]/.exec(rest)) && looksLikeTitle(hm[1])) {
      info.heading = hm[1];                              // "Title. Body"
    }
    return info;
  }

  /* ---------- negation ---------- */

  var NEG_RE = /\b(?:not|no(?!\s+(?:later|earlier|less|more)\b)|never|neither|nor|without)\b/i;

  // Preservation / savings language: "nothing in this ... waives/limits/prevents",
  // "does not waive/limit", "preserves its right to", "retains the right to".
  var PRESERVE_RE = new RegExp(
    '\\bnothing\\s+(?:in|herein|contained|else)\\b' +
    '|\\bdoes\\s+not\\s+(?:waive|limit|restrict|prevent|affect|impair)\\b' +
    '|\\bshall\\s+not\\s+(?:be\\s+(?:construed|deemed|interpreted)\\s+(?:to|as)\\s+)?(?:waive|limit|restrict|prevent|impair)' +
    '|\\b(?:preserves?|retains?)\\s+(?:its|their|the|each|all|his|her|any)?\\s*(?:party[\'\u2019]?s?\\s+)?(?:right|rights)\\s+(?:to|of)\\b' +
    '|\\bis\\s+not\\s+waived\\b', 'i');

  function isNegated(ctext, matchStart) {
    var from = Math.max(0, matchStart - 40);
    var win = ctext.slice(from, matchStart);
    var cut = Math.max(win.lastIndexOf('.'), win.lastIndexOf(';'), win.lastIndexOf(':'), win.lastIndexOf('!'), win.lastIndexOf('?'));
    if (cut >= 0) win = win.slice(cut + 1);
    if (NEG_RE.test(win)) return true;
    // wider same-sentence window for preservation language
    var from2 = Math.max(0, matchStart - 120);
    var win2 = ctext.slice(from2, matchStart);
    var cut2 = Math.max(win2.lastIndexOf('.'), win2.lastIndexOf(';'), win2.lastIndexOf(':'), win2.lastIndexOf('!'), win2.lastIndexOf('?'));
    if (cut2 >= 0) win2 = win2.slice(cut2 + 1);
    return PRESERVE_RE.test(win2);
  }

  /* ---------- taxonomy compilation (cached) ---------- */

  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function compileList(list, fn) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (item) {
      var c = fn(item);
      if (c) out.push(c);
    });
    return out;
  }

  function compileTaxonomy(tax) {
    if (cache && cache.has(tax)) return cache.get(tax);
    var rules = compileList(tax && tax.rules, function (r) {
      if (!r || typeof r !== 'object') return null;
      var triggers = compileList(r.triggers, compile);
      if (!triggers.length) return null; // rule can never fire
      return {
        rule: r,
        triggers: triggers,
        mitigators: compileList(r.mitigators, compile),
        aggravators: compileList(r.aggravators, function (a) {
          if (!a) return null;
          var re = compile(a.pattern);
          return re ? { re: re, delta: Number(a.delta) || 0, reason: a.reason || '' } : null;
        })
      };
    });
    var mods = compileList(tax && tax.scoring && tax.scoring.modifiers, function (m) {
      if (!m) return null;
      var re = compile(m.pattern);
      return re ? { re: re, id: m.id, delta: Number(m.delta) || 0, reason: m.reason || '' } : null;
    });
    var qc = compileList(tax && tax.qc_checks, function (q) {
      if (!q) return null;
      var re = compile(q.trigger_absent);
      return re ? { re: re, q: q } : null;
    });
    var out = { rules: rules, mods: mods, qc: qc };
    if (cache) cache.set(tax, out);
    return out;
  }

  /* ---------- scoring one rule on one clause ---------- */

  function evalRule(cr, ctext, offset, tax, mods) {
    var rule = cr.rule;
    var matches = [];
    var useNegation = rule.negation_check === true;
    cr.triggers.forEach(function (re) {
      allMatches(re, ctext).forEach(function (m) {
        if (useNegation && isNegated(ctext, m.start)) return;
        matches.push(m);
      });
    });
    if (!matches.length) return null;
    matches.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    // drop exact duplicates
    var uniq = [];
    matches.forEach(function (m) {
      var p = uniq[uniq.length - 1];
      if (!p || p.start !== m.start || p.end !== m.end) uniq.push(m);
    });
    matches = uniq;

    var aggravatorsFound = [];
    var mitigatorsFound = [];
    var aggSum = 0;
    var mitSum = 0;

    cr.aggravators.forEach(function (a) {
      var ms = allMatches(a.re, ctext);
      if (!ms.length) return;
      var d = a.delta;
      var rec = { kind: 'rule', text: ms[0].text, start: offset + ms[0].start, end: offset + ms[0].end, delta: d, reason: a.reason };
      if (d >= 0) { aggSum += d; aggravatorsFound.push(rec); }
      else { mitSum += d; mitigatorsFound.push(rec); }
    });

    var ruleMitCounted = false;
    var ruleMitDelta = Number(rule.mitigator_delta) || 0;
    cr.mitigators.forEach(function (re) {
      var ms = allMatches(re, ctext);
      if (!ms.length) return;
      var d = 0;
      if (!ruleMitCounted) { d = ruleMitDelta; mitSum += d; ruleMitCounted = true; }
      mitigatorsFound.push({ kind: 'rule', text: ms[0].text, start: offset + ms[0].start, end: offset + ms[0].end, delta: d, reason: 'Mitigating language' });
    });

    var skipMods = Array.isArray(rule.ignore_modifiers) ? rule.ignore_modifiers : [];
    mods.forEach(function (m) {
      if (skipMods.indexOf(m.id) !== -1) return;
      var ms = allMatches(m.re, ctext);
      if (!ms.length) return;
      var rec = { kind: 'modifier', id: m.id, text: ms[0].text, start: offset + ms[0].start, end: offset + ms[0].end, delta: m.delta, reason: m.reason };
      if (m.delta >= 0) { aggSum += m.delta; aggravatorsFound.push(rec); }
      else { mitSum += m.delta; mitigatorsFound.push(rec); }
    });

    var base = Number(rule.base_score) || 0;
    var pre = base + aggSum;
    var mitigation = Math.max(-MITIGATION_CAP, Math.min(0, mitSum));
    var score = Math.round(Math.max(1, Math.min(100, pre + mitigation)));

    return {
      rule: rule,
      score: score,
      base: base,
      preMitigation: Math.max(1, Math.min(100, pre)),
      mitigation: mitigation,
      matches: matches,
      aggravatorsFound: aggravatorsFound,
      mitigatorsFound: mitigatorsFound
    };
  }

  /* ---------- governing law ---------- */

  function detectGoverningLaw(text) {
    var m = /governed\s+by[^.;]{0,80}?\blaws?\s+of\s+(?:the\s+)?(?:(?:State|Commonwealth|Province)\s+of\s+)?([A-Z][A-Za-z]+(?:\s+(?:and\s+)?[A-Z][A-Za-z]+){0,2})/.exec(text.slice(0, MAX_INPUT));
    return m ? m[1].replace(/\s+(Without|Excluding|Exclusive)$/i, '') : null;
  }

  /* ---------- analyze ---------- */

  function analyze(text, taxonomy, opts) {
    if (typeof text !== 'string') throw new TypeError('analyze: text must be a string');
    if (text.length > MAX_INPUT) {
      throw new Error('Input too large: ' + text.length + ' characters exceeds the limit of ' + MAX_INPUT + '.');
    }
    opts = opts || {};
    taxonomy = taxonomy || { rules: [] };
    var ct = compileTaxonomy(taxonomy);
    // Default: core + extra only. Engagement-letter rules run only when asked for.
    var groups = Array.isArray(opts.groups) && opts.groups.length ? opts.groups.slice() : DEFAULT_GROUPS.slice();
    var rules = ct.rules.filter(function (r) { return groups.indexOf(r.rule.group || 'core') !== -1; });

    var clauses = splitClauses(text);
    var findings = [];

    clauses.forEach(function (cl) {
      if (cl.headingOnly) return;
      var ctext = cl.text.length > MAX_PASS ? cl.text.slice(0, MAX_PASS) : cl.text;
      var hits = [];
      rules.forEach(function (cr, idx) {
        var h = evalRule(cr, ctext, cl.start, taxonomy, ct.mods);
        if (h) { h.order = idx; hits.push(h); }
      });
      if (!hits.length) return;
      hits.sort(function (a, b) { return b.score - a.score || b.base - a.base || a.order - b.order; });
      var best = hits[0];
      var r = best.rule;

      var matches = best.matches.map(function (m) {
        return { start: cl.start + m.start, end: cl.start + m.end, text: m.text };
      });

      // quote = the sentence containing the first match (what the UI highlights)
      var sents = sentenceRanges(text, cl.start, cl.start + ctext.length);
      var first = matches[0];
      var q = { start: first.start, end: first.end };
      for (var i = 0; i < sents.length; i++) {
        if (first.start >= sents[i].start && first.start < sents[i].end) { q = { start: sents[i].start, end: Math.max(sents[i].end, first.end) }; break; }
      }
      var lead = /^\s*\d+(?:\.\d+)*[.)]?\s+(?=\S)/.exec(text.slice(q.start, q.end));
      if (lead && q.start === cl.start && q.end - q.start - lead[0].length > 10) q.start += lead[0].length;
      q.text = text.slice(q.start, q.end);

      findings.push({
        id: 'f-' + cl.id,
        clauseId: cl.id,
        ruleId: r.id,
        category: r.category,
        title: r.title,
        group: r.group,
        severity: severityFor(best.score, taxonomy),
        score: best.score,
        baseScore: best.preMitigation,
        mitigation: best.mitigation,
        matches: matches,
        quote: q,
        why: r.why_it_matters || '',
        fix: r.suggested_fix || '',
        jurisdictionNote: r.jurisdiction_note || '',
        mitigatorsFound: best.mitigatorsFound,
        aggravatorsFound: best.aggravatorsFound,
        alsoMatches: hits.slice(1).map(function (h) { return h.rule.id; }),
        _pos: cl.start
      });
    });

    findings.sort(function (a, b) { return b.score - a.score || a._pos - b._pos; });
    findings.forEach(function (f, i) { f.rank = i + 1; delete f._pos; });

    var qc = [];
    ct.qc.forEach(function (c) {
      c.re.lastIndex = 0;
      var found = c.re.test(text);
      c.re.lastIndex = 0;
      if (!found) qc.push({ id: c.q.id, title: c.q.title, severity: c.q.severity, message: c.q.message });
    });

    var summary = { High: 0, Medium: 0, Low: 0, total: findings.length };
    summary.clauses = clauses.filter(function (c) { return !c.headingOnly; }).length;
    findings.forEach(function (f) { summary[f.severity]++; });

    return {
      clauses: clauses,
      findings: findings,
      qc: qc,
      summary: summary,
      groups: groups,
      governingLaw: detectGoverningLaw(text)
    };
  }

  return {
    analyze: analyze,
    splitClauses: splitClauses,
    detectGoverningLaw: detectGoverningLaw,
    severityFor: severityFor,
    MAX_INPUT: MAX_INPUT,
    MAX_PASS: MAX_PASS,
    MITIGATION_CAP: MITIGATION_CAP
  };
});
