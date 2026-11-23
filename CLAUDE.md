# CLAUDE.md

UAE Corporate Tax calculator for a Dubai accounting and tax firm. React 18 + TypeScript (strict) + Vite, plain CSS, SheetJS, jsPDF, Vitest.

## Non-negotiable rules

1. **Privacy:** everything runs in the browser. No backend, no analytics, no network calls with client data. Files are read locally. Never store uploaded file bytes.
2. **One source of truth for law numbers:** every rate, threshold and date lives in `src/engine/settings.ts`, each with a comment naming the law or decision, and is listed in `SETTING_INFO`. No tax number may be hard-coded anywhere else. `tests/settings.test.ts` enforces this.
3. **The engine is pure:** `src/engine/` contains no React or DOM code, so it can be unit-tested and reused.
4. **Never guess silently:** if a rule needs human judgement or outside information, the UI asks a clear question. Until it's answered, the engine uses cautious mode (default ON = the less favourable tax treatment) and raises a flag.
5. **Audit trail:** every number read from a file shows its sheet and cell. Every add-back shows its rule ID and the source line.
6. **Every flag** has `id` (rule ID), `level` (HIGH | MEDIUM | INFO | DATA | PASS), `message`, `amount` (if any), `action`. Flags also carry a stable `key` used for "Resolved".
7. **Plain English** in the UI: short sentences, active voice, no jargon without explanation.
8. **Accessibility:** keyboard usable, visible focus, labels on every input, works at 400px width, light and dark mode.

## Folder map

```
src/
  engine/
    settings.ts        all law numbers + references (SETTINGS, SETTING_INFO)
    types.ts           all shared types, categories, flag levels
    parse.ts           Excel/CSV reading (FS, TB, GL, VAT returns, related-party list)
    autofill.ts        Company profile auto-fill: facts found in the files (with Sheet!Cell), user answers win
    classify.ts        account → tax category, keyword rules, saved mappings, hidden VAT, open questions
    compute.ts         6 steps, add-backs, exempt income, interest, losses, SBR, QFZP
    flags.ts           RV-01..RV-11, AB-10, SBR, DATA checks; merge and sort
    deadlines.ts       registration/filing/payment dates, penalties
    vat.ts             VAT from sales and purchase registers: output, recoverable/blocked input VAT, checks
    gl.ts              general-ledger scanning for hidden add-backs
    export.ts          Excel working paper
    pdf.ts             PDF client report
    workspace.ts       parsed files → workspace → evaluate() (classify + compute + flags + deadlines)
    util.ts            text, number and date helpers (no tax numbers)
  components/          one file per screen section (Header, Upload, Profile, Headline, Accounts,
                       GlSuggestions, Computation, Vat, Flags, Deadlines, SettingsView, Clients, ui)
  store/clients.ts     client save/load (localStorage + JSON export/import), duplicate to next year
  download.ts          saves files (claude.ai downloads capability, or a normal download)
  App.tsx, main.tsx, styles.css
tests/                 one test file per engine module (spec tests 1–17 with exact numbers)
scripts/build-single.mjs   one self-contained HTML → single/uae-ct-calculator.html
scripts/check-single.mjs   Playwright acceptance check (uses installed Edge/Chrome)
scripts/make-sample.mjs    demo files in samples/
README.md, QUESTIONS.md, CLAUDE.md
```

## Commands

- `npm run typecheck && npm test` after every change; both must pass.
- `npm run build` and `npm run build:single`; then `npm run check:single` for the browser check.

## Conventions

- Line keys are normalised account names (`norm()` in util.ts); answers and mappings are keyed by them.
- Profile answers change only through `setProfileByUser()` (marks them as the user's); files fill them through `applyAutoFill()`, which never overwrites a user's answer. `tests/fixtures/` holds client-style test workbooks.
- Balances are `debit − credit`: expenses positive, income negative.
- Use the Edit tool (not shell `sed`/Python heredocs) for code changes that contain backslashes such as `\b`.
- Open questions and assumptions go in `QUESTIONS.md`.
