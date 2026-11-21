#!/usr/bin/env node
'use strict';
// Builds index.html from index.template.html + engine.js + taxonomy.json + sample-contract.txt
// + vendor/pdf-extract.js + vendor/pdf.min.mjs + vendor/pdf.worker.min.mjs (pdf.js, Apache-2.0).
// Single source of truth: edit those files, then run `node build.js`.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const taxonomy = JSON.parse(read('taxonomy.json')); // throws on invalid JSON
const sample = read('sample-contract.txt').replace(/\r\n?/g, '\n');
const engine = read('engine.js');
const pdfExtract = read('vendor/pdf-extract.js');
// pdf.js is embedded as base64 inside inert <script type="text/plain"> blocks, so no byte of it can
// close the element or open a comment. The page decodes it to Blob URLs only when a PDF is chosen.
const b64 = (f) => fs.readFileSync(path.join(dir, f)).toString('base64');
const pdfjsLib = b64('vendor/pdf.min.mjs');
const pdfjsWorker = b64('vendor/pdf.worker.min.mjs');

// Embed JSON safely inside a <script> element: escape "<" and JS line separators.
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const embed = (v) => JSON.stringify(v)
  .replace(/</g, '\\u003c')
  .split(LS).join('\\u2028')
  .split(PS).join('\\u2029');

let html = read('index.template.html');
const TOKENS = ['__TAXONOMY__', '__SAMPLE__', '/*__ENGINE__*/', '/*__PDFEXTRACT__*/', '__PDFJS_LIB__', '__PDFJS_WORKER__'];
for (const token of TOKENS) {
  if (html.split(token).length !== 2) throw new Error('template token missing or duplicated: ' + token);
}
const values = {
  '__TAXONOMY__': embed(taxonomy), '__SAMPLE__': embed(sample), '/*__ENGINE__*/': engine,
  '/*__PDFEXTRACT__*/': pdfExtract, '__PDFJS_LIB__': pdfjsLib, '__PDFJS_WORKER__': pdfjsWorker
};
if (!/^[A-Za-z0-9+/]+=*$/.test(pdfjsLib) || !/^[A-Za-z0-9+/]+=*$/.test(pdfjsWorker)) throw new Error('pdf.js base64 is not pure base64');
// Guard what gets injected (after the embed escapes) so it cannot close or open markup.
for (const k of Object.keys(values)) {
  if (/<\/script|<!--/i.test(values[k])) throw new Error('embedded content for ' + k + ' contains "</script" or "<!--"');
}
// Single pass with a callback: injected content is never re-scanned for tokens.
html = html.replace(/__TAXONOMY__|__SAMPLE__|\/\*__ENGINE__\*\/|\/\*__PDFEXTRACT__\*\/|__PDFJS_LIB__|__PDFJS_WORKER__/g, (t) => values[t]);

fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('Built index.html (' + html.length + ' bytes)');
