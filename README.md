# Finapt Calculator

Works out UAE Corporate Tax from a client's financial statements and trial balance in seconds. Every number shows where it came from, every add-back shows its rule, and anything that needs a person's judgement is asked as a question and flagged.

**Privacy:** everything runs in your browser. Files are read on your computer and never uploaded. There is no server, no analytics and no network call with client data. Saved clients stay in this browser until you delete them.

---

## 1. Set up (once)

You need **Node.js LTS** (version 20 or newer) and, for editing, **VS Code**.

### Windows
1. Install Node.js LTS from <https://nodejs.org> (take the "LTS" button and accept the defaults).
2. Install VS Code from <https://code.visualstudio.com>.
3. Open the `uae-ct-calculator` folder in VS Code (File → Open Folder).
4. Open a terminal (Terminal → New Terminal) and run:
   ```
   npm install
   npm run dev
   ```
5. Open the address it prints (usually <http://localhost:5173>).

### Mac
1. Install Node.js LTS from <https://nodejs.org> (the macOS installer), or `brew install node@22`.
2. Install VS Code from <https://code.visualstudio.com>.
3. In Terminal:
   ```
   cd path/to/uae-ct-calculator
   npm install
   npm run dev
   ```
4. Open the address it prints.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app locally with live reload |
| `npm test` | Runs all tests (should all pass) |
| `npm run typecheck` | Checks the TypeScript |
| `npm run build` | Builds the app into `dist/` |
| `npm run build:single` | Builds **one HTML file**, `single/finapt-calculator.html`, with everything inside. Double-click it to use the app offline, or email it. The Inter font is bundled inside (from `@fontsource-variable/inter`, Latin only), so nothing is loaded from the internet. |
| `npm run sample` | Rebuilds the demo files in `samples/` |
| `npm run check:single` | Opens the single file in Edge or Chrome, uploads the samples and checks: tax shown, no console errors, no sideways scroll at 400px, exports download |

The Excel library is the official SheetJS build from `cdn.sheetjs.com` (0.20.3). It installed without problems; if a network ever blocks it, use `npm install xlsx@0.18.5` instead (same API for what the app uses).

---

## 2. Using the app

Try it with the files in `samples/` (a made-up trading company). Before any questions are answered, the tax comes out at **AED 2,025**. Answer "No evidence" for *Professional fees* (no invoice) and it becomes **AED 4,275**.

1. **Header.** Shows the client, the tax due (large) and the buttons: *Clients*, *Save client*, *Export Excel*, *Export PDF* and the light/dark theme. While any HIGH flag is open, a red banner says the figure is not final.
2. **Upload files.** Drop one or many files. Each file's type is detected (financial statements, trial balance, general ledger, VAT returns, related parties, sales invoices, purchase invoices / receipts); change it from the list if it's wrong. In a workbook with several sheets, every sheet is read for what it holds (a trial balance, a ledger, a related-parties list and invoice registers in one file are all used), and the card lists each sheet's role. Choosing a type by hand uses only that type. Chips show what was found and where, e.g. "Found PBT AED 410,000 at P&L!C9". The calculator's own Excel export is refused ("This is a calculator export, not client accounts. Upload the original trial balance."), and nothing is read from a sheet named like "Expected Results" or "Answers". PBT is read only from a P&L sheet; otherwise it is worked out from the trial balance.
3. **Company profile.** Legal form, period, accounting standard, audited, group revenue, VAT-return revenue, elections, history, ownership change, QFZP conditions. Most answers are **filled from the files**: each shows an "auto" badge with where it came from ("from file: P&L!A1"), and a line at the top says how many were filled and how many need you. Change any answer and yours wins, also when you upload the files again. Small Business Relief is locked to "No" when total revenue for the SBR test is above AED 3M, and it is never applied while "All earlier periods ≤ AED 3M" or group revenue is unanswered (HIGH flag "Confirm before using SBR"). *Business type* (bank, insurance provider, natural person) switches off the 30% EBITDA interest limit. A QFZP failure is saved with the client and carried to the next 4 periods. "Suggested" answers (foreign income, ownership change) are best guesses to confirm. Blank answers are treated cautiously and flagged (RV-01).
4. **Headline numbers.** PBT, revenue, total income (for AB-04), shared overheads, other deductions, **total revenue for SBR / QFZP tests** (revenue, other income, gains and exempt income, with a choice per line and a reason; VAT is never included), the **foreign tax credit** (one row per country: foreign income and foreign tax paid, each capped at the UAE tax on that income), losses brought forward (by period) and interest carried forward (by year). Each shows its sheet and cell or "Entered by hand". Type over a number to change it, and use "Use file value" to undo.
5. **Accounts.** Every trial balance line, with its category, the reason, and the rule. Tabs: *P&L lines*, *Needs a person (n)*, *All*. Change a category from the list (saved for this client). Questions appear under the line (client share of entertainment, market value, private-use %, tax depreciation, participation tests, who imposed a penalty, whether supporting evidence exists, what a related-party loan was used for…). **Cautious mode** (on by default) uses the less favourable treatment until a question is answered.
6. **General ledger suggestions.** If you uploaded a ledger: groups of transactions in normal expense accounts that look like fines, gifts, donations, personal costs, entertainment or related-party payments. Accept one to add it back as a sub-line, with the transactions as evidence.
7. **Computation.** The tax "tape": Steps 1–6, each add-back with its rule chip, the TB row and how it was worked out.
8. **VAT.** From the sales and purchase registers at the 5% rate: output VAT, recoverable and blocked input VAT (Executive Regulation Art. 53), and VAT payable or refundable. Staff can change any purchase line between recoverable, blocked and not applicable, with a reason. Checks (rate, net + VAT = gross, duplicates, supplier TRN, VAT on sales against revenue) appear as flags. The Excel working paper gets a VAT sheet.
9. **Red flags.** HIGH → MEDIUM → DATA → INFO → PASS, with counts and filters. Mark a flag resolved with a note; the note is saved with the client and exported.
10. **Deadlines and penalties.** Registration, filing and payment dates, the late-registration waiver date, a penalty estimate and a timeline. Registration depends on who registers: a company (incorporation + 3 months, same day number), a natural person (turnover above AED 1M → 31 March of the next year), or a non-resident (PE: 6 months; nexus: 3 months). Late payment is 14% a year, charged for each month or part of a month.
11. **Settings.** Every rate, threshold and date, with its legal reference (read-only).

**Clients:** *Save client* stores the current work in this browser. *Clients* lets you search, open, **duplicate to next year** (moves the dates on 12 months; last year's categories and answers become suggestions; losses and interest carried forward become next year's brought-forward figures), delete (with a confirm), and **export/import all clients as JSON** for backup.

**Exports:** the Excel working paper (`CT-<client>-<period end>.xlsx`) has the sheets Computation, Add-backs detail, Red flags, Account mapping, Deadlines, Settings used and Sources. The PDF is a 1–2 page client report with sign-off lines. Inside a claude.ai artifact, downloads go through the viewer's save prompt.

---

## 3. Law table: rule → law → code

All numbers come from `src/engine/settings.ts`. Article numbers refer to Federal Decree-Law 47/2022 unless stated.

| Rule | What it does | Law | Where in the code |
|---|---|---|---|
| Step 1 | Profit before tax as reported | Art. 20 | `parse.ts` `extractFs`; `workspace.ts` `evaluate` |
| AB-01 | 50% of client entertainment added back | Art. 32 | `compute.ts` `compute` (entertainment cases) |
| AB-02 | Pension: add back the confirmed amount | Tax team judgement | `compute.ts` (pension) |
| AB-03 | Donations: 100% added back unless staff choose "Donation (approved charity)" | Art. 33 | `compute.ts` (donation_unlisted); `classify.ts` |
| AB-04 | Direct costs and an overhead slice for exempt income | Art. 28 | `compute.ts` (exempt_income_cost, overhead slice) |
| AB-05A | Dividends paid in the P&L | Art. 33 | `compute.ts` (dividend_paid) |
| AB-05B | Foreign dividends: participation exemption and clawback | Art. 23; MD 116/2023 | `compute.ts` `participationTest` |
| AB-06 | Government fines added back; contract damages allowed; any other penalty waits for a person | Art. 33 | `compute.ts` (fines, penalty_review); `classify.ts` |
| AB-07 | Recoverable VAT charged to expenses; hidden VAT | Art. 33 | `compute.ts` (vat_expensed); `classify.ts` `detectHiddenVat` |
| AB-08 | Related-party expense above market value | Art. 34 | `compute.ts` (related_party_expense) |
| AB-09 | Connected-person payments (market value, purpose) | Art. 36; MD 97/2023 | `compute.ts`; `flags.ts` `connectedPersonGroups` |
| AB-10 | Master File and Local File | Art. 55; MD 97/2023 | `flags.ts` `reviewFlags` |
| AB-11 | Personal costs; private share of mixed use | Art. 28 | `compute.ts` (personal, mixed_use) |
| AB-12 | Capital items expensed; tax depreciation deducted | Art. 28 | `compute.ts` (capital_expensed) |
| AB-13 | Net interest above max(AED 12m, 30% of adjusted EBITDA); not for banks, insurance providers, natural persons | Art. 30; MD 126/2023 | `compute.ts` `interestLimitation`, `interestLimitExempt` |
| AB-13 (Art. 31) | Interest on related-party loans used for dividends, buybacks or capital contributions | Art. 31 | `compute.ts` (interest_expense) |
| AB-14 | No invoice or support: flagged; added back only when staff answer "No evidence" | Art. 28; Tax Procedures Law | `compute.ts` (no_invoice) |
| REV | Total revenue for the SBR and QFZP de minimis tests | Art. 21; MD 73/2023; MD 265/2023 | `compute.ts` `ctRevenueBreakdown` |
| FTC | Foreign tax credit, capped at the UAE tax on that income | Art. 47 | `compute.ts` `foreignTaxCreditFor` |
| Step 3 | UAE dividends exempt; realisation basis | Art. 22; Art. 20 | `compute.ts` |
| Step 5 | Losses: 75% cap, from June 2023, ownership continuity | Art. 37, 39 | `compute.ts` (losses) |
| SBR | Small Business Relief eligibility | Art. 21; MD 73/2023; MD 131/2026 | `compute.ts` (SBR) |
| QFZP | De minimis and conditions; 0% / 9% | Art. 18; MD 265/2023 | `compute.ts` `qfzpDeMinimis` |
| Step 6 | 9% above the AED 375,000 band | Art. 3; CD 116/2023 | `compute.ts` `standardTax` |
| RV-01…RV-11, DATA | Review checks | see Settings references | `flags.ts` `reviewFlags` |
| Deadlines | Registration, return, payment, waiver, penalties | Art. 53; FTA Decision 3/2024; CD 10/2024, CD 75/2023 | `deadlines.ts` |

---

## 4. When the law changes: update a setting

1. Open `src/engine/settings.ts`.
2. Change the value in `SETTINGS` and update its comment (law or decision, and the date it applies from).
3. Update the matching entry in `SETTING_INFO` (label and reference) so the Settings screen and the Excel export show it.
4. Run `npm test`. If a spec test expects the old number, update that test **only** if the law really changed.
5. Run `npm run build:single` to make a new single file for the team.

A test fails if a tax number is written anywhere else in `src/`, or if `SETTINGS` and `SETTING_INFO` drift apart.

## 5. Adding a rule

1. **New category?** Add it to `Category` and `CATEGORIES` in `src/engine/types.ts` (label, rule ID, treatment, whether it asks a question).
2. **How lines get it:** add keyword rules to `NAME_RULES` or `COMMENT_RULES` in `src/engine/classify.ts`. Order matters: first match wins.
3. **What it does to tax:** add a `case` in `compute()` in `src/engine/compute.ts`. Use `addBack(...)` or `deduct(...)` and raise a flag with `flag(...)` when a person must check something. Any number goes in `settings.ts`.
4. **Questions:** add the question to `openQuestions()` in `classify.ts` and the input to `Questions` in `src/components/Accounts.tsx`.
5. **Review check?** Add it to `reviewFlags()` in `src/engine/flags.ts`.
6. Add a test in `tests/` with exact expected numbers.

## 6. What still needs a person

The app asks; it does not decide. A person should always:

- Confirm categories the app guessed (the *Needs a person* tab), and anything marked "No rule matched".
- Answer the questions: client share of entertainment, pension, VAT recoverability, market values and business purpose for related and connected parties, private-use shares, tax depreciation, participation tests, who imposed each unclear penalty, whether supporting evidence exists, and what related-party loans were used for (Art. 31).
- Check which income lines count towards total revenue for the SBR / QFZP tests, and give a reason for each change.
- Check every HIGH flag (connected persons, balances with owners, transfer pricing support, audit, SBR/QFZP conditions, ownership change), then mark it resolved with a note.
- Reconcile revenue to the VAT returns and explain any difference.
- Decide elections (SBR, realisation basis, foreign PE) with the client.
- Check the settings against tax.gov.ae and mof.gov.ae before each filing season.
- Review the open points in `QUESTIONS.md`.

The PDF footer says it: *Prepared with Finapt Calculator. Subject to professional review.*

## 7. Project layout

```
src/engine/   pure TypeScript (no React, no DOM): settings, types, parse, classify, compute,
              flags, deadlines, gl, export (Excel), pdf, workspace (ties it together), util
src/components/  one file per screen section
src/store/    saved clients (localStorage + JSON backup)
tests/        one test file per engine module, including the 17 spec tests
scripts/      build-single.mjs, check-single.mjs, make-sample.mjs
samples/      demo files
single/       the one-file build
```
