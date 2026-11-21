#!/usr/bin/env node
'use strict';
// Headless Chrome check for PDF import. Needs playwright-core and google-chrome (dev only).
// Usage: node fixtures/chrome-check.js   (builds nothing; run `node build.js` first)
const path = require('path');
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright-core');
const url = 'file://' + path.join(root, 'index.html');
const fx = (f) => path.join(__dirname, f);

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const results = {};
  let failed = 0;
  const check = (name, ok, detail) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

  async function session(file, fn) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const reqs = [], cons = [], errs = [];
    page.on('request', (r) => reqs.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cons.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(url);
    await page.setInputFiles('#file', file);
    const out = await fn(page);
    await ctx.close();
    return Object.assign(out || {}, { reqs: reqs.filter((u) => !u.startsWith(url)), cons, errs });
  }
  const outcome = (page) => page.waitForFunction(() => {
    const e = document.getElementById('fileErr').textContent.trim();
    return e || document.getElementById('src').value.length > 0;
  }, null, { timeout: 60000 });

  // 1. sample PDF -> Analyze
  const a = await session(fx('sample-contract.pdf'), async (page) => {
    await outcome(page);
    const loaded = await page.inputValue('#src');
    const chip = await page.textContent('#chipHost');
    const t0 = Date.now();
    await page.click('#btnAnalyze');
    await page.waitForSelector('#sumCounts:not(:empty)', { timeout: 30000 });
    await page.waitForFunction(() => /finding/.test(document.getElementById('sumCounts').textContent), null, { timeout: 30000 });
    return {
      loadedChars: loaded.length, chip: chip.trim(), err: (await page.textContent('#fileErr')).trim(),
      counts: (await page.textContent('#sumCounts')).trim(), strip: (await page.textContent('#strip')).trim(),
      tabs: (await page.textContent('#tab-findings')).trim(), ms: Date.now() - t0
    };
  });
  console.log('sample-contract.pdf ->', JSON.stringify({ loadedChars: a.loadedChars, chip: a.chip, counts: a.counts, strip: a.strip, tab: a.tabs }));
  check('sample PDF loads text', a.loadedChars > 3000 && !a.err, 'err=' + JSON.stringify(a.err));
  check('sample PDF finding counts match txt sample (5 High, 5 Medium, 2 Low)', /12 findings · 5 High · 5 Medium · 2 Low/.test(a.counts), a.counts);
  check('no network requests besides blob:/file page', a.reqs.every((u) => u.startsWith('blob:')), JSON.stringify(a.reqs));
  check('blob requests seen (lib/worker loaded locally)', a.reqs.length >= 1, a.reqs.length + ' blob requests');
  check('no console errors/warnings', a.cons.length === 0 && a.errs.length === 0, JSON.stringify(a.cons.concat(a.errs)));

  // 2. scanned, password, fake, simple
  const expect = {
    'scanned.pdf': /looks scanned \(images, no text\)\. OCR isn't built in; paste the text or use a text version\./,
    'password.pdf': /This PDF is password-protected\. Remove the password and try again\./,
    'not-really.pdf': /has a \.pdf name but isn't a PDF/
  };
  for (const f of Object.keys(expect)) {
    const r = await session(fx(f), async (page) => { await outcome(page); return { err: (await page.textContent('#fileErr')).trim(), val: await page.inputValue('#src'), busy: (await page.textContent('#fileBusy')).trim() }; });
    console.log(f + ' ->', JSON.stringify(r.err));
    check(f + ' shows friendly message and leaves the textarea untouched', expect[f].test(r.err) && r.val === '' && r.busy === '');
    check(f + ': no network (non-blob) requests', r.reqs.every((u) => u.startsWith('blob:')), JSON.stringify(r.reqs));
    check(f + ': no console errors/page errors', r.cons.length === 0 && r.errs.length === 0, JSON.stringify(r.cons.concat(r.errs)));
  }
  const s = await session(fx('simple-agreement.pdf'), async (page) => { await outcome(page); await page.click('#btnAnalyze'); await page.waitForFunction(() => /finding/.test(document.getElementById('sumCounts').textContent), null, { timeout: 30000 }); return { counts: (await page.textContent('#sumCounts')).trim() }; });
  console.log('simple-agreement.pdf ->', s.counts);
  check('simple 3-page agreement analyzes', /findings/.test(s.counts) && s.reqs.every((u) => u.startsWith('blob:')) && s.cons.length === 0 && s.errs.length === 0, s.counts + ' ' + JSON.stringify(s.cons));

  // 3. CSP-blocked blob import degrades gracefully (simulate by stripping blob: from script-src)
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.route(url, async (route) => {
      const fs = require('fs'); let body = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      body = body.replace("script-src 'unsafe-inline' blob:;", "script-src 'unsafe-inline';");
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto(url);
    await page.setInputFiles('#file', fx('sample-contract.pdf'));
    await outcome(page);
    const err = (await page.textContent('#fileErr')).trim();
    console.log('blocked-import ->', JSON.stringify(err));
    check('blocked blob import shows friendly error, no uncaught page error', /isn't available in this browser/.test(err) && errs.length === 0, JSON.stringify(errs));
    await ctx.close();
  }

  // 4. page cap: a 310-page PDF reads 300 pages and says so
  {
    const os = require('os'), fs = require('fs');
    const { PDFDocument, StandardFonts } = require(process.env.PDF_LIB || '/opt/npm-tools/node_modules/pdf-lib');
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 310; i++) d.addPage([612, 792]).drawText('Page ' + i + ' of a long fictional agreement. The Agreement automatically renews for successive one-year terms.', { x: 40, y: 700, size: 10, font: f });
    const big = path.join(os.tmpdir(), 'rfd-310-pages.pdf'); fs.writeFileSync(big, await d.save());
    const r = await session(big, async (page) => { await outcome(page); return { chip: (await page.textContent('#chipHost')).trim(), err: (await page.textContent('#fileErr')).trim(), chars: (await page.inputValue('#src')).length, hasLast: (await page.inputValue('#src')).includes('Page 301 of') }; });
    console.log('310-page.pdf ->', JSON.stringify({ chip: r.chip, chars: r.chars }));
    check('310-page PDF: first 300 pages only, notice shown', /Only the first 300 pages were read\./.test(r.chip) && !r.hasLast && r.chars > 20000 && !r.err);
    fs.unlinkSync(big);
  }

  // 5. cancel while reading: Cancel button clears the busy state and leaves text unchanged
  {
    const os = require('os'), fs = require('fs');
    const { PDFDocument, StandardFonts } = require(process.env.PDF_LIB || '/opt/npm-tools/node_modules/pdf-lib');
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 300; i++) { const p = d.addPage([612, 792]); for (let l = 0; l < 50; l++) p.drawText('Line ' + l + ' of page ' + i + ' lorem ipsum dolor sit amet consectetur adipiscing elit sed do.', { x: 40, y: 750 - l * 14, size: 10, font: f }); }
    const big = path.join(os.tmpdir(), 'rfd-cancel.pdf'); fs.writeFileSync(big, await d.save());
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(url);
    await page.fill('#src', 'existing text '.repeat(20));
    await page.setInputFiles('#file', big);
    await page.waitForSelector('#fileBusy button', { timeout: 10000 });
    const busyText = (await page.textContent('#fileBusy')).trim();
    await page.click('#fileBusy button');
    await page.waitForTimeout(1500);
    const after = { busy: (await page.textContent('#fileBusy')).trim(), val: await page.inputValue('#src'), err: (await page.textContent('#fileErr')).trim(), live: (await page.textContent('#live')).trim() };
    console.log('cancel ->', JSON.stringify({ busyText, live: after.live }));
    check('cancel: busy state shown, then cleared; text untouched; no error', /Reading PDF/.test(busyText) && after.busy === '' && after.val.startsWith('existing text') && !after.err && /cancelled/.test(after.live) && errs.length === 0);
    await ctx.close(); fs.unlinkSync(big);
  }
  await browser.close();
  console.log(failed ? failed + ' check(s) FAILED' : 'All Chrome checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
