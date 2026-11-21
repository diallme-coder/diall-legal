/*! Red Flag & Risk Detector: PDF text extraction. No DOM, no dependencies, no network.
 *  Browser: window.PdfText   Node: require('./vendor/pdf-extract.js')
 *  extract(pdfDoc, opts) takes a pdf.js PDFDocumentProxy and rebuilds reading-order text from
 *  page.getTextContent(): lines grouped by y, left-to-right within a line, blank line between
 *  paragraphs (large vertical gap) and between pages, words hyphenated across a line break merged
 *  when the next line starts lowercase.
 *  Written for this app (not part of pdf.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_PAGES = 300;      // pages read; later pages are ignored and reported as truncated
  var SCAN_AVG = 25;        // under this many non-space characters per page on average = scanned / image-only
  var Y_TOL = 2.5;          // text-space units: items within this baseline distance share a line
  var PARA_FACTOR = 1.5;    // baseline gap above this multiple of the normal line gap starts a new paragraph
  var SPACE_FACTOR = 0.2;   // horizontal gap above this multiple of the font height counts as a space

  var LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

  function clean(s) {
    return String(s).replace(/[ﬀ-ﬆ]/g, function (c) { return LIGATURES[c]; })
      .replace(/[  -   　]/g, ' ')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‍﻿]/g, '');
  }

  // True when the first 1024 bytes contain "%PDF-" (the PDF spec allows leading junk before the header).
  function hasPdfHeader(bytes) {
    var n = Math.min(bytes.length, 1024 + 5);
    for (var i = 0; i + 4 < n; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2D) return true;
    }
    return false;
  }

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // items: pdf.js TextItem objects { str, transform:[a,b,c,d,e,f], width, height }. Returns the page text.
  function pageText(items) {
    var its = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string' || !it.transform) continue;
      var str = clean(it.str);
      if (!str) continue;
      var h = Math.abs(it.height) || Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      its.push({ s: str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: h });
    }
    if (!its.length) return '';
    // Top to bottom (pdf y grows upward), then group by baseline tolerance.
    its.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    its.forEach(function (it) {
      var ln = lines.length ? lines[lines.length - 1] : null;
      if (ln && Math.abs(ln.y - it.y) <= Y_TOL) {
        ln.items.push(it);
        if (it.h > ln.h) ln.h = it.h;
      } else {
        lines.push({ y: it.y, h: it.h, items: [it] });
      }
    });
    lines.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var out = '', prev = null;
      ln.items.forEach(function (it) {
        if (prev) {
          var gap = it.x - (prev.x + prev.w);
          var joined = /\s$/.test(out) || /^\s/.test(it.s);
          if (!joined && gap > SPACE_FACTOR * Math.min(prev.h, it.h)) out += ' ';
        }
        out += it.s;
        prev = it;
      });
      ln.text = out.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
    });
    lines = lines.filter(function (ln) { return ln.text; });
    // Normal line pitch = lower quartile of baseline gaps (ignoring tiny offsets such as sub/superscripts).
    // The median is not used: pages of short paragraphs would make paragraph gaps look normal.
    var gaps = [], heights = [];
    for (var k = 0; k < lines.length; k++) heights.push(lines[k].h);
    var hMed = median(heights);
    for (k = 1; k < lines.length; k++) { var g = lines[k - 1].y - lines[k].y; if (g >= 0.8 * hMed) gaps.push(g); }
    gaps.sort(function (a, b) { return a - b; });
    var normal = gaps.length >= 3 ? gaps[Math.floor((gaps.length - 1) * 0.25)] : 0;
    var parts = [];
    for (var j = 0; j < lines.length; j++) {
      var cur = lines[j];
      if (!parts.length) { parts.push(cur.text); continue; }
      var prevLine = lines[j - 1];
      var gapY = prevLine.y - cur.y;
      var lh = normal || Math.max(prevLine.h, cur.h) * 1.2;
      var para = gapY > PARA_FACTOR * lh;
      var last = parts[parts.length - 1];
      if (!para && /\p{L}-$/u.test(last) && /^\p{Ll}/u.test(cur.text)) {
        parts[parts.length - 1] = last.slice(0, -1) + cur.text;   // de-hyphenate across the line break
      } else if (para) {
        parts.push('', cur.text);
      } else {
        parts.push(cur.text);
      }
    }
    return parts.join('\n');
  }

  /* extract(doc, opts)
   *   opts.maxPages     default 300
   *   opts.isCancelled  () => boolean, checked between pages
   *   opts.onPage       (pageNumber, pagesToRead) progress callback
   * Resolves { text, numPages, pagesRead, truncated, scanned, avgChars, failedPages, cancelled }.
   * Rejects when every page failed to read (the last page error). */
  async function extract(doc, opts) {
    opts = opts || {};
    var cap = opts.maxPages || MAX_PAGES;
    var numPages = doc.numPages;
    var toRead = Math.min(numPages, cap);
    var pages = [], nonSpace = 0, failed = 0, lastErr = null;
    for (var p = 1; p <= toRead; p++) {
      if (opts.isCancelled && opts.isCancelled()) return { cancelled: true, text: '', numPages: numPages, pagesRead: p - 1, truncated: false, scanned: false, avgChars: 0, failedPages: failed };
      if (opts.onPage) opts.onPage(p, toRead);
      var page = null;
      try {
        page = await doc.getPage(p);
        var tc = await page.getTextContent();
        var t = pageText(tc.items);
        nonSpace += t.replace(/\s/g, '').length;
        pages.push(t);
      } catch (e) {
        if (e && e.name === 'PasswordException') throw e;
        failed++; lastErr = e; pages.push('');
      } finally {
        if (page && page.cleanup) { try { page.cleanup(); } catch (e2) { /* ignore */ } }
      }
    }
    if (opts.isCancelled && opts.isCancelled()) return { cancelled: true, text: '', numPages: numPages, pagesRead: toRead, truncated: false, scanned: false, avgChars: 0, failedPages: failed };
    if (toRead > 0 && failed === toRead) throw lastErr || new Error('unreadable');
    var avg = toRead ? nonSpace / toRead : 0;
    var text = pages.filter(function (t) { return t; }).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      text: text, numPages: numPages, pagesRead: toRead, truncated: numPages > cap,
      scanned: avg < SCAN_AVG, avgChars: avg, failedPages: failed, cancelled: false
    };
  }

  return {
    extract: extract,
    pageText: pageText,
    hasPdfHeader: hasPdfHeader,
    MAX_PAGES: MAX_PAGES,
    SCAN_AVG: SCAN_AVG
  };
});
