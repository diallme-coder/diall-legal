# Red Flag & Risk Detector

A single-page tool that reads a contract and flags clauses that commonly deserve a lawyer's attention (auto-renewal traps, one-sided changes, broad indemnities, non-competes and so on), each with a severity, a plain-language explanation and a suggested starting point.

## Open it

Open `index.html` in a browser. There is no server and no network access; the page is fully self-contained.

## How it works

- **Clause splitting:** the text is split into numbered or headed clauses and paragraphs, and each finding points back to its clause.
- **Rules:** all rules live in `taxonomy.json` (triggers, aggravators, mitigators, global modifiers, "not found" QC checks). `engine.js` applies them.
- **Scoring and severity bands:** score = base score + matched aggravators + mitigators (applied once) + global modifiers, clamped to 1-100. Bands: High 70-100, Medium 40-69, Low 1-39. Scores rank review priority; they do not predict enforceability.
- **Mitigation cap:** mitigating language lowers a score by a bounded amount, so a clause with one soft mitigator is never hidden.
- **Negation and preservation checks:** language such as "shall not automatically renew" or "nothing herein waives" suppresses or adjusts a match so benign clauses are not flagged.
- **Opt-in engagement group:** engagement-letter terms (retainers, fee disputes and similar) are checked only when the option is ticked.
- **Export:** print report or copy as Markdown (contract-derived text is escaped).

## Extend it

1. Edit `taxonomy.json` (add or tune a rule, trigger, mitigator or QC check).
2. `node build.js` regenerates `index.html` from `index.template.html`, `engine.js`, `taxonomy.json` and `sample-contract.txt`.
3. `node test.js` runs the tests, including per-regex timing limits (every pattern must stay under 200 ms on 200k characters of pathological input). Add a positive and a benign test for each change.

Never edit `index.html` directly; it is generated.

## Known limitations

- Regex pattern matching can miss unusual wording. Recall was about 60% on the first independently worded test set and about 100% on a later small set after fixes (samples of 10-15 clauses, so treat these as rough), so a clean result does not mean a contract is safe.
- Assumes you are the customer or client.
- English only.
- Not legal advice. Jurisdiction notes are general cautions to verify locally.

## Privacy

Everything runs in your browser. Contract text is never uploaded, stored or sent anywhere (the page's Content-Security-Policy blocks network connections).

## Security notes

The CSP keeps `'unsafe-inline'` for scripts and styles because the page is a single self-contained file. Switching to hash-based script and style allow-listing is a possible future hardening.
