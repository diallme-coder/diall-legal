# Red Flag & Risk Detector: Design Spec v1 (light mode, desktop-first, client-side only)

Domain is legal/operational, so the palette is cool neutral, not editorial. Contract text is serif (document feel); UI is sans.

## 1. Design principles (in priority order; higher wins conflicts)

1. **Assist the reviewer, never replace them.** "For lawyer review, not legal advice" is visible on every screen, in print, and in every export. Always show the quoted source text before the conclusion. Suggested fixes are labeled "Suggested starting point". Wins over: persuasive, confident-sounding copy.
2. **Severity is never color alone.** Every severity is shape + text label + line style + rank position, then color. Wins over: palette aesthetics. Severity colors are used for nothing else (errors are neutral).
3. **Calm, not alarmist.** Rank and position carry urgency, not saturation. Largest red area is a 24px badge or a tint behind one sentence. No red banners, no "danger/critical/warning!" words, no animation that pulses. High means "review first".
4. **Worst first, evidence one step away.** The top-ranked finding is selected on arrival. Every finding links both ways to its clause. Wins over: showing all findings equally.

## 2. Primary user and top task

**User:** paralegal or in-house commercial reviewer triaging 20-40 vendor/customer contracts a month, ten minutes each, before escalating to an attorney. Knows the vocabulary; distrusts black boxes; works on a laptop with a second monitor, occasionally on a phone between meetings.

**Top task:** get a contract in (paste or file), see the worst clauses first, verify each against the source text, mark each reviewed or dismissed, hand off a report.
**Success:** results visible in under 3 s for 20,000 words; first High finding and its quote visible with zero clicks after analysis; any finding verified in one click.

## 3. Information architecture and layout

**Screens:** one page, three modes: Input (empty/error), Analyzing, Results. Header (app name, "Edit text", "New contract", Export menu) plus a permanent disclaimer bar (full-width, 36px, 0.8125rem, neutral-100 background).

**Desktop (>=1024px), two panes, 100vh app shell, no page scroll:**
- Left, fluid (min 480px): contract text, serif, measure max 68ch, 32px inset, own scroll. Inline highlights. Small footer: word count, "Converted from .docx" note if relevant.
- Right, fixed `clamp(400px, 36vw, 520px)`, three zones in a column:
  - Zone A (auto height): Summary card then filters. Summary: "12 findings . 3 High . 5 Medium . 4 Low", "2 of 12 reviewed", and "Start with #1: {title}" link.
  - Zone B (flex 1, min 160px, own scroll): ranked findings list. Row = rank, severity icon + label, category, clause title (1 line, ellipsis), score. Min height 56px.
  - Zone C (50% of panel height, 60% if viewport < 720px, own scroll, top border): selected clause detail with sticky action footer.
- Two nested scrollers on the right are intentional; Zone A never scrolls.

**Tablet 640-1023px and mobile <640px: stacked with tabs.**
- Order: header, disclaimer bar (wraps to 2 lines), persistent summary strip (three count chips), sticky tablist `Contract | Findings (n)`, tab panel.
- Contract tab: text with highlights. Tapping a highlight opens a 96px peek bar docked above the tab bar (badge, category, title, "Details" button). Details switches to the Findings tab with that finding open.
- Findings tab: "Filter" button (opens bottom sheet with severity + category), list, then tapping a row replaces the list with the detail view ("< All findings" back button at top, "Show in contract" button switches to Contract tab, scrolls, highlights).
- Tablet content max-width 720px centered.

## 4. States

| State | Left / main | Right panel | Notes |
|---|---|---|---|
| Empty | Input card: textarea (min 12 rows), drop zone/"Choose file", "Load sample contract" link, primary "Analyze" (disabled under 100 chars) | Hidden; input card centered full width (max 720px) | Privacy line under input: "Runs in your browser. Nothing is uploaded." |
| Analyzing | Text shown plain, dimmed to 60% opacity, `aria-busy` | Skeleton summary + 5 skeleton rows, indeterminate bar, step text | Show only if > 300 ms; once shown, keep >= 600 ms. Cancel button always present. |
| Results | Highlights on, #1 selected and scrolled to center | Full panel, #1 detail open | Focus moves to the "Results" heading (tabindex -1). |
| Zero findings | Text, no highlights | Summary card only (no list) | See microcopy. Never say "safe" or "no risk". |
| Zero after filter | Highlights of filtered-out findings removed | List replaced by message + "Clear filters" | "Showing 0 of 12" |
| Error (analysis) | Input card retains text | Hidden | Neutral panel, `role="alert"`, "Try again" and "Edit text". |
| File too large / unsupported / unreadable | Input card, drop zone shows inline error under it | n/a | `role="alert"`; previous text is not overwritten. |

Reviewed finding: stays in rank position, check icon, muted title, highlight keeps underline but loses tint. Dismissed: leaves the list into a collapsed "Dismissed (n)" disclosure at list end with "Restore"; highlight removed; excluded from summary counts and exports. Summary counts show open findings only.

## 5. Flows

**Input rules.** Supported: pasted text; `.txt`; `.md`/`.markdown` (read as plain text, syntax shown literally); `.docx` converted in the browser to plain text (body paragraphs and table cells as lines; accepted-changes text; comments, headers/footers, images, tracked-change history dropped). Not supported: PDF, `.doc`, `.rtf`, `.odt`, images/scans. One file at a time. Limits: file <= 2 MB, text <= 200,000 characters, minimum 100 characters. UTF-8 only. Nothing is sent to any server. Selecting a file replaces the textarea only after it parses successfully.

1. **Paste:** paste into textarea, "Analyze" (or Ctrl/Cmd+Enter) starts analysis. No auto-analyze on paste.
2. **Upload:** drag onto the drop zone or "Choose file". Parse, fill textarea (user can still edit), show filename chip + "Converted from .docx..." note when relevant. User then presses Analyze.
3. **Sample:** "Load sample contract" fills a fictional ~1,200-word SaaS services agreement (labeled "Sample, fictional") and analyzes immediately. It must yield 8+ findings spanning every severity and 5+ categories, with 2+ findings having mitigating factors.
4. **Finding to clause:** click/Enter on a row selects it, updates Zone C, scrolls the clause to vertical center (`scroll-margin-block: 96px`), and puts a 2px #0B57D0 outline (offset 2px) on the highlight. Focus stays on the row.
5. **Clause to finding:** click/Enter on a highlight selects the finding, scrolls its row into view in Zone B, updates Zone C. Focus stays on the highlight. Overlapping highlights: the higher-severity finding owns the overlap; the other is reachable from the list.
6. **Filter by severity:** toggle buttons (multi-select, `aria-pressed`): High, Medium, Low, each with shape + count. None pressed = all.
7. **Filter by category:** wrapping chip toggles with counts, multi-select. Fixed set: Liability & Indemnity, Termination, Payment & Fees, Term & Auto-renewal, IP & Confidentiality, Data & Privacy, Warranties & Disclaimers, Disputes & Governing Law, Other. Only categories present are shown.
   Severity AND category filters combine. Zone A shows "Showing 4 of 12" and "Clear filters". Filtering never changes rank numbers. If the selected finding is filtered out, select the first visible one.
8. **Export:** header menu button "Export" with two items. **Print / Save as PDF** calls `window.print()`; print stylesheet is one column: disclaimer on top, summary, all non-dismissed findings in rank order with full detail, then the contract with highlights drawn using underline style + marker (works in black and white; set `print-color-adjust: exact`). **Copy as Markdown** copies: title, date, disclaimer, summary counts, numbered findings (`### 1. [HIGH] Category: title` plus quote, why, fix, jurisdiction, mitigating, status). Filters are ignored in exports. Success announces "Report copied as Markdown." If clipboard fails, open a dialog with the Markdown preselected in a textarea.
9. **New contract:** if any finding is reviewed/dismissed, confirm dialog ("Start over? Your review marks will be lost."). Review marks live in memory only; `beforeunload` prompt only when marks exist.

## 6. Severity visual system (light mode)

Page bg `#F6F7F9`, surface `#FFFFFF`, ink `#1B2430` (15.65:1 on white), muted text `#4A5565` (7.56:1), decorative border `#C9CFD8`, control border `#8A94A3` (3.07:1), interactive/focus `#0B57D0` (6.39:1). Score and rank use tabular numerals.

| Level | Label | Icon (16px, in 20px box) | Text/icon `fg` | Tint `bg` | Line `ln` | Underline in text |
|---|---|---|---|---|---|---|
| High | "High" | Filled triangle with white "!" | `#A3202F` | `#FBE6E8` | `#C23A48` | 2px solid |
| Medium | "Medium" | Filled diamond | `#7A4300` | `#FCEFD6` | `#B86E00` | 2px dashed |
| Low | "Low" | Filled circle | `#1D5A85` | `#E4F0F8` | `#3E7FAE` | 2px dotted |

Contrast (computed): 
| Level | fg on white | fg on bg | ink on bg | ln on white | ln on bg |
|---|---|---|---|---|---|
| High | 7.49 | 6.27 | 13.11 | 5.26 | 4.40 |
| Medium | 7.98 | 7.02 | 13.76 | 3.99 | 3.50 |
| Low | 7.36 | 6.35 | 13.50 | 4.33 | 3.73 |

All text pairs exceed 4.5:1 (AA); all line/outline pairs exceed 3:1 (non-text AA). Tokens: `--sev-{high|med|low}-{fg|bg|ln}`.

**Badge:** 24px high, 8px horizontal padding, bg tint, 1px `ln` border, radius 4px, icon + label in `fg`, 0.8125rem/600. Icon is `aria-hidden`; the text label is always present (never icon-only, including list rows and mobile).
**Highlight in contract:** a `<mark>`-styled `button` on the matched sentence only: tint background, ink text unchanged, underline per table (`text-decoration-thickness: 2px; text-underline-offset: 3px; box-decoration-break: clone`), followed by an inline marker `{icon}{rank}` (0.75rem/700, `fg` on bg). Hover: underline thickness 3px. Selected: 2px `#0B57D0` outline, 2px offset, plus marker gets a 1px `#0B57D0` ring. Reviewed: no tint, underline kept, check replaces the icon. Focus-visible: same as selected but 3px.
**Non-severity feedback (errors, notices):** neutral surface `#FFFFFF`, 1px `#8A94A3` border, ink text, circled "!" icon in ink. Never severity colors.

**Scoring (for display):** 0-100. High 70-100, Medium 40-69, Low 1-39. Rank = score descending, ties by document order. Shown as "78/100"; secondary line "Base 86, mitigations -8" when mitigations exist.

## 7. Clause detail panel (Zone C / mobile detail view)

Order, top to bottom:
1. Header row: "#2 of 12", severity badge, category chip, score "78/100".
2. Title (clause heading or generated name), `h3`.
3. **Matched text:** blockquote in the serif face, tint background, left 3px `ln` border, with "Jump to clause" text button (and "Section 9.2" locator if found).
4. **Why it matters:** 2-4 sentences, plain language, no legalese.
5. **Suggested fix:** labeled "Suggested starting point", 1-3 bullets or a short sample sentence.
6. **Jurisdiction note:** prefixed "General information, verify locally." Includes detected governing law ("Contract states: Delaware") or "No governing-law clause found."
7. **Mitigating factors found:** list of short quotes each with "Jump" link, or "None found in this contract."
8. Sticky footer: `Mark reviewed` (toggle, `aria-pressed`) and `Dismiss` (opens no dialog; shows 6 s "Dismissed. Undo" toast and Dismissed list entry). Reviewed/dismissed status is also text, not just icon.
9. Empty (nothing selected): "Select a finding to see why it matters."

## 8. Type, spacing, grid

Fonts (self-hosted, `font-display: swap`): UI **IBM Plex Sans** 400/500/600; contract text and quotes **Source Serif 4** 400; scores/markdown preview **IBM Plex Mono**. Fallbacks: `system-ui`, `Georgia`, `ui-monospace`. Base 16px.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| caption | 0.75rem (12) / 1rem | 500 | markers, counts, footer notes |
| label | 0.8125rem (13) / 1.125rem | 600 | badges, chips, disclaimer bar |
| small | 0.875rem (14) / 1.25rem | 400/500 | list rows, buttons, metadata |
| body | 1rem (16) / 1.5rem | 400 | detail text, inputs |
| contract | 1.0625rem (17) / 1.7rem | 400 serif | contract text, quotes |
| h3 | 1.125rem (18) / 1.5rem | 600 | detail title |
| h2 | 1.375rem (22) / 1.75rem | 600 | panel headings, empty/error titles |
| h1 | 1.75rem (28) / 2.25rem | 600 | input-screen title only |

Spacing (4px base): `space-1 4, 2 8, 3 12, 4 16, 5 24, 6 32, 7 48, 8 64`. Control height 36px desktop, 44px (<1024px or `pointer: coarse`). Radii 4px controls, 8px cards. No shadows except the mobile bottom sheet (`0 -4px 16px rgb(27 36 48 / .12)`).

Grid: mobile 4 columns, 16px margins and gutters; tablet 8 columns, 32px margins, 24px gutters; desktop two-pane flex with 24px padding inside each pane and a 1px `#C9CFD8` divider (no 12-column grid needed). Breakpoints 640px and 1024px.
Motion: 120ms and 200ms, `cubic-bezier(.2,0,0,1)`. Used for: outline/selection, panel content swap (opacity only), toast. Smooth scroll only when motion is allowed.

## 9. Microcopy

- **Disclaimer bar (always):** "For lawyer review, not legal advice. This tool flags text patterns; it does not interpret your contract or replace an attorney."
- **Export/Markdown footer:** "Generated by Red Flag & Risk Detector on {date}. For lawyer review, not legal advice."
- **Empty title:** "Paste a contract to see what to read first." Body: "We rank risky clauses High, Medium or Low. Runs in your browser. Nothing is uploaded." Link: "Load sample contract". Drop zone: "Drop a .txt, .md or .docx file here, or choose a file."
- **Too short:** "Add at least 100 characters so there is something to review."
- **Analyzing:** title "Analyzing your contract"; steps "Reading clauses", "Matching risk patterns", "Ranking findings"; helper "This stays in your browser."
- **Results announce:** "Analysis complete. 12 findings: 3 High, 5 Medium, 4 Low."
- **Zero findings:** title "No clauses matched our risk patterns." Body: "We scanned {n} clauses across {k} categories. That does not mean the contract is risk-free; a lawyer should still review it." Button: "Edit text".
- **Zero after filter:** "No findings match these filters." Button: "Clear filters".
- **Error (analysis):** "We couldn't finish the analysis. Your text is still here and nothing was uploaded." Buttons: "Try again", "Edit text".
- **Too large:** "This file is {size}. The limit is 2 MB or 200,000 characters. Try pasting the sections you need."
- **Unsupported:** "PDFs aren't supported yet. Copy the text and paste it here, or save the file as .docx or .txt." (use ".doc/.rtf/images" in place of "PDFs" as needed; generic: "{ext} files aren't supported. Use .txt, .md or .docx, or paste the text.")
- **Unreadable:** "We couldn't read this file as text. Try saving it again as .txt or .docx."
- **docx note:** "Converted from .docx. Formatting, comments and tracked changes aren't shown."
- **Actions:** "Mark reviewed" / "Reviewed" ; "Dismiss" ; toast "Dismissed. Undo" ; "Report copied as Markdown." ; "Print / Save as PDF" ; "Copy as Markdown".
- **Mitigating none:** "None found in this contract."

## 10. Accessibility checklist

- [ ] Landmarks: `header`, `main` containing `section aria-label="Contract text"` and `aside aria-label="Findings"`; skip links "Skip to contract text" and "Skip to findings" are first in tab order.
- [ ] Tab order: skip links, header actions, input controls, (contract highlights in document order), filters, findings list, detail actions. Findings list is a single tab stop with roving tabindex (Up/Down/Home/End move, Enter/Space selects).
- [ ] Highlights are real `button`s with accessible name "{Severity}, {category}, finding {n}: {first 60 chars of quote}". Marker text is part of the name, not duplicated.
- [ ] `aria-live="polite"` status region (visually hidden) announces: analysis complete summary, filter result counts ("Showing 4 of 12"), copy success, dismiss/restore. Errors use `role="alert"`. One message per action, no repeated announcements.
- [ ] Focus: after analysis, focus goes to the Results `h2` (tabindex -1). Selecting from list or highlight does not move focus. After Dismiss, focus goes to the next row (or the previous if last). After closing dialogs/sheets focus returns to the opener. Mobile detail view: focus goes to its heading; Back returns focus to the originating row.
- [ ] Tabs (mobile): `role=tablist/tab/tabpanel`, arrow-key navigation, `aria-selected`.
- [ ] Meaning never by color alone: every severity has label, shape, underline style, and rank. Reviewed/dismissed have text status. Filter state is `aria-pressed`, not color only.
- [ ] Contrast: all text >= 4.5:1, UI components and focus rings >= 3:1 (values in section 6). Focus ring 2px `#0B57D0` with 2px offset, never removed.
- [ ] `prefers-reduced-motion: reduce`: no smooth scroll, no transitions, indeterminate bar replaced by static step text.
- [ ] Targets >= 36px desktop, >= 44px touch. Text resizes to 200% and reflows at 320px width with no horizontal scroll. Honors browser zoom and `rem` units.
- [ ] Drop zone has a keyboard-operable "Choose file" button; drag and drop is never the only path. No keyboard traps; Esc closes menus, sheets, dialogs.
- [ ] `lang="en"`, one `h1`, logical heading levels, buttons vs links used correctly ("Jump to clause" is a button).

## 11. QA checklist (builder must satisfy all)

- [ ] Disclaimer bar visible in Empty, Analyzing, Results, Zero, Error, mobile, print, and Markdown export.
- [ ] Sample contract yields 8+ findings, every severity, 5+ categories, 2+ with mitigating factors; #1 is High and auto-selected with its clause centered in the left pane.
- [ ] Ranking: score descending, ties by document order; rank numbers stable under filtering, review, dismissal.
- [ ] Click row scrolls clause and outlines it; click highlight scrolls row and updates detail; works with keyboard (Enter/Space) and touch.
- [ ] Severity filter, category filter, and combination behave per section 5; "Showing x of y" and "Clear filters" correct; selected finding falls back to first visible.
- [ ] Reviewed and dismissed behave per section 4 and are excluded or marked correctly in summary, print, and Markdown; Undo restores position.
- [ ] Input limits: 99 chars blocked; 100 chars OK; file just over 2 MB rejected; text over 200,000 chars rejected; PDF, .doc, image rejected with the right message; valid .txt, .md, .docx parse; corrupt .docx shows "unreadable"; failed file never overwrites existing text.
- [ ] No network requests carry contract text (verify in the network panel during analyze, upload, and export).
- [ ] Analyzing state appears only after 300 ms and stays at least 600 ms; Cancel returns to input with text intact.
- [ ] Zero-findings and zero-after-filter copy never implies the contract is safe.
- [ ] Print preview: single column, disclaimer on first page, readable in grayscale (underline styles and markers distinguish severity), no clipped or split badges, dismissed absent.
- [ ] Markdown output matches section 5.8 and renders correctly pasted into a Markdown viewer; clipboard-failure fallback dialog works.
- [ ] Layouts verified at 320, 375, 768, 1024, 1280, 1920 px; no horizontal scroll; two-pane has no page scroll; zones A/B/C meet minimum heights at 1024x600.
- [ ] Mobile: peek bar, Details, Show in contract, filter sheet, and back navigation all keep focus per section 10.
- [ ] Contrast measured in browser for every severity badge, highlight, marker, muted text, and focus ring; none below the values in section 6.
- [ ] axe (or equivalent) shows zero serious/critical issues in Empty, Results, Zero, Error; manual screen reader pass (NVDA or VoiceOver) completes the top task end to end.
- [ ] Keyboard-only run: complete paste, analyze, review three findings, filter, export, with visible focus at all times.
- [ ] `prefers-reduced-motion` verified; 200% zoom verified; Windows forced-colors mode keeps underline styles, markers, and outlines visible.
- [ ] 20,000-word contract analyzes and renders in under 3 s on a mid-range laptop; scrolling the left pane stays at 60 fps with 40 highlights.
