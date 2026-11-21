#!/usr/bin/env node
'use strict';
// Builds index.html from index.template.html + engine.js + taxonomy.json + sample-contract.txt.
// Single source of truth: edit those four files, then run `node build.js`.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const taxonomy = JSON.parse(read('taxonomy.json')); // throws on invalid JSON
const sample = read('sample-contract.txt').replace(/\r\n?/g, '\n');
const engine = read('engine.js');

// Embed JSON safely inside a <script> element: escape "<" and JS line separators.
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const embed = (v) => JSON.stringify(v)
  .replace(/</g, '\\u003c')
  .split(LS).join('\\u2028')
  .split(PS).join('\\u2029');

let html = read('index.template.html');
for (const token of ['__TAXONOMY__', '__SAMPLE__', '/*__ENGINE__*/']) {
  if (html.split(token).length !== 2) throw new Error('template token missing or duplicated: ' + token);
}
const values = { '__TAXONOMY__': embed(taxonomy), '__SAMPLE__': embed(sample), '/*__ENGINE__*/': engine };
// Guard what gets injected (after the embed escapes) so it cannot close or open markup.
for (const k of Object.keys(values)) {
  if (/<\/script|<!--/i.test(values[k])) throw new Error('embedded content for ' + k + ' contains "</script" or "<!--"');
}
// Single pass with a callback: injected content is never re-scanned for tokens.
html = html.replace(/__TAXONOMY__|__SAMPLE__|\/\*__ENGINE__\*\//g, (t) => values[t]);

fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('Built index.html (' + html.length + ' bytes)');
