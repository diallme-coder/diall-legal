#!/usr/bin/env node
'use strict';
// Regenerates the PDF test fixtures (text-only, small). Needs pdf-lib and qpdf (dev only; not used by the app).
// Usage: node fixtures/make-fixtures.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { PDFDocument, StandardFonts, rgb } = require(process.env.PDF_LIB || '/opt/npm-tools/node_modules/pdf-lib');
const dir = __dirname;
const out = (f) => path.join(dir, f);

async function textPdf(text, opts) {
  opts = opts || {};
  const size = 11, lead = 14, margin = 56, W = 612, H = 792;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxW = W - margin * 2;
  let page = doc.addPage([W, H]), y = H - margin, pageNo = 1;
  const newPage = () => { page = doc.addPage([W, H]); y = H - margin; pageNo++; };
  const paras = text.replace(/\r\n?/g, '\n').split('\n');
  for (const raw of paras) {
    if (raw === '\f') { newPage(); continue; }
    if (!raw.trim()) { y -= lead; continue; }               // blank line = one extra line of vertical space
    const isHead = /^\d+\.\s+[A-Z]|^[A-Z][A-Z &,-]{6,}$/.test(raw) && raw.length < 60;
    const f = isHead ? bold : font;
    const words = raw.split(/\s+/);
    let line = '';
    const flush = () => {
      if (y < margin) newPage();
      page.drawText(line, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
      y -= lead; line = '';
    };
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(t, size) > maxW && line) { flush(); line = w; } else line = t;
    }
    if (line) flush();
  }
  return doc.save();
}

function png(w, h) {            // tiny deterministic gray-noise PNG (an "image of a page")
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = 200 + ((x * 7 + y * 13) % 40);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const AGREEMENT = `SIMPLE SERVICES AGREEMENT

This Services Agreement is made between Northwind Consulting LLC ("Provider") and Fabrikam Retail Inc. ("Customer"). It is a short fictional agreement used only to test PDF import.

1. Services

1.1 Provider will deliver the consulting services described in the attached statement of work during the Term, and will correct any defects reported by Customer within thirty days of delivery.

1.2 Customer will give Provider timely access to the information and people Provider reasonably needs.

2. Term and Renewal

2.1 This Agreement has an initial term of twelve months. The Agreement automatically renews for successive twelve-month periods unless Customer gives written notice of non-renewal at least sixty days before the end of the then-current period.


3. Fees

3.1 Customer will pay the fees stated in the statement of work within thirty days of each invoice date. Provider may increase the fees at any time by notifying Customer.

3.2 Late amounts accrue interest at one and one-half percent per month until paid in full.

4. Liability

4.1 Customer shall indemnify, defend and hold harmless Provider from any and all claims, losses and expenses arising out of the Agreement.


5. General

5.1 This Agreement is governed by the laws of the State of Delaware. Any dispute shall be resolved by binding arbitration and each party waives the right to a jury trial.

5.2 During the Term and for two years afterward, Customer shall not, directly or indirectly, compete with Provider or solicit its employees.

6. Signatures

Signed by the parties' authorized representatives on the dates written below. Each party has read and understood this Agreement and has had the chance to ask a lawyer to review it before signing.
`;

(async () => {
  const sample = fs.readFileSync(path.join(dir, '..', 'sample-contract.txt'), 'utf8');
  fs.writeFileSync(out('sample-contract.pdf'), await textPdf(sample));
  fs.writeFileSync(out('simple-agreement.pdf'), await textPdf(AGREEMENT));

  // scanned-style: two pages that contain only an image, no text operators
  const sc = await PDFDocument.create();
  const img = await sc.embedPng(png(64, 64));
  for (let i = 0; i < 2; i++) { const p = sc.addPage([612, 792]); p.drawImage(img, { x: 40, y: 40, width: 532, height: 712 }); }
  fs.writeFileSync(out('scanned.pdf'), await sc.save());

  // password-protected (user password required to open)
  execFileSync('qpdf', ['--encrypt', 'user', 'owner', '256', '--', out('simple-agreement.pdf'), out('password.pdf')]);

  // a plain text file with a .pdf name
  fs.writeFileSync(out('not-really.pdf'), 'This is just a text file renamed to .pdf. It is not a PDF document at all, it only pretends to be one.\n');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'))) console.log(f, fs.statSync(out(f)).size + ' bytes');
})().catch((e) => { console.error(e); process.exit(1); });
