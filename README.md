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
2. `node build.js` regenerates `index.html` from `index.template.html`, `engine.js`, `taxonomy.json`, `sample-contract.txt` and the `vendor/` files (`pdf-extract.js`, pdf.js).
3. `node test.js` runs the tests, including per-regex timing limits (every pattern must stay under 200 ms on 200k characters of pathological input). Add a positive and a benign test for each change.

Never edit `index.html` directly; it is generated.

## PDF import

Choose or drop a `.pdf` file and its text is extracted in your browser, then goes through the same path as pasted text (200,000-character limit, 100-character minimum).

- **Supported:** PDFs with selectable text, up to 15 MB (2 MB for .txt, .md and .docx). Pages are read in reading order (lines rebuilt from text positions, paragraph breaks kept, words hyphenated across a line break rejoined). Only the first 300 pages are read; a notice says so when a PDF is longer. Layout, tables and images are not kept.
- **Not supported:** scanned or image-only PDFs. OCR is not built in, so these show "This PDF looks scanned (images, no text)..." and nothing is loaded; paste the text or use a text version. Password-protected PDFs ask you to remove the password first. A file named `.pdf` that is not a PDF, or a damaged PDF, shows a friendly error and never replaces the text already in the box.
- **How it works:** [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla, Apache License 2.0; copy in `vendor/LICENSE`, files `vendor/pdf.min.mjs` and `vendor/pdf.worker.min.mjs`, version 6.2.108) is embedded in `index.html` as inert base64 text and only decoded into Blob URLs when you pick a PDF. Nothing is fetched: no external fonts or character maps are used, so text in PDFs that need them (some non-embedded CJK fonts) may come out degraded. The PDF is read once and the pdf.js document and worker are destroyed afterwards. The extraction logic is `vendor/pdf-extract.js` (ours, not pdf.js).
- **CSP change:** `script-src` is now `'unsafe-inline' blob:` (it was `'unsafe-inline'`) so the page can load its embedded pdf.js from a Blob URL. Nothing else changed: `default-src 'none'`, `connect-src 'none'` and `worker-src blob:` are as before, no remote host is allowed, and neither `'unsafe-eval'` nor `'wasm-unsafe-eval'` is needed.
- **Size:** embedding pdf.js makes `index.html` about 2.4 MB.
- **Tests:** `node test.js` runs the extraction function on the PDFs in `fixtures/` with pdf.js's legacy build in Node (regenerate fixtures with `node fixtures/make-fixtures.js`, which needs pdf-lib and qpdf). `node fixtures/chrome-check.js` drives headless Chrome through the real upload flow (needs playwright-core).

## Known limitations

- Regex pattern matching can miss unusual wording. Recall was about 60% on the first independently worded test set and about 100% on a later small set after fixes (samples of 10-15 clauses, so treat these as rough), so a clean result does not mean a contract is safe.
- Assumes you are the customer or client.
- English only.
- Not legal advice. Jurisdiction notes are general cautions to verify locally.

## Privacy

Everything runs in your browser. Contract text is never uploaded, stored or sent anywhere (the page's Content-Security-Policy blocks network connections). PDF import runs pdf.js locally from the embedded copy.

## Security notes

The CSP keeps `'unsafe-inline'` for scripts and styles because the page is a single self-contained file, and allows `blob:` scripts only so the embedded pdf.js can load. Switching to hash-based script and style allow-listing is a possible future hardening.
