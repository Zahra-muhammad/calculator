# Questions and assumptions

Points where the spec was open or two rules pulled in different directions. Each one says what the app does now (the safest reading I could find) and what to confirm. Nothing here stopped the build.

## Rules that disagree with "cautious mode"

1. **Pension (AB-02).** The category table says "add back only the amount the tax team confirms". Rule 4 says unanswered questions use the less favourable treatment.
   *Now:* the table wins. Nothing is added back until the tax team enters an amount, and a MEDIUM flag stays open until then.
   *Confirm:* should cautious mode add back the full pension cost until it's confirmed?

2. **Related-party expense with no market value (AB-08).** The add-back is "paid − market value", which can't be worked out without a market value.
   *Now:* nothing is added back, and two flags are raised: AB-08 (MEDIUM) and RV-04 "TP support missing" (HIGH). Cautious mode doesn't add back 100%.
   *Confirm:* is a HIGH flag without an add-back the behaviour you want?

3. **Connected-person payment (AB-09). Decided in review.** Business purpose defaults to "yes". The whole payment is added back only when someone answers "no". With a market value entered, the excess over market value is added back. With no market value, nothing is added back and one HIGH flag (AB-09, "not benchmarked") shows the amount at risk. Cautious mode does not change this.

4. **Mixed use with no private share entered (AB-11). Decided in review.** Nothing is added back and a MEDIUM flag stays open until the share is entered. Cautious mode does not change this. Cautious mode now applies only to:
   - unsplit entertainment (treated as all client);
   - VAT of unknown recoverability (added back);
   - unanswered foreign-dividend tests (taxable);
   - unanswered QFZP conditions (fail);
   - losses after an ownership change (excluded).

   *Changed in the November 2026 review (point 37):* SBR is never applied while "All earlier periods ≤ AED 3M" or group revenue is unanswered, whatever cautious mode says. A HIGH flag "Confirm before using SBR" asks for both.

## Participation exemption, QFZP, SBR

5. **Unknown answers in the participation tests.** The spec only says "investee tax rate unknown = fail".
   *Now:* missing ownership/cost, holding period or non-qualifying-asset share also fail, because a test can't pass without data. The "bad fact" questions (investee deducts the dividend, deductible impairment, liquidation loss, restructuring within 2 years) count as "no" until answered. Spec test 12 needs that.

6. **QFZP taxable non-qualifying income.**
   *Now:* taxable income after adjustments, minus the qualifying income entered. Losses brought forward offset that amount, within the 75% cap. Tax is 9% with no 0% band. If QFZP fails, the normal computation applies, with the 0% band. Unanswered QFZP conditions fail in cautious mode.
   *Confirm:* the treatment of the de minimis non-qualifying revenue, and whether losses should be used against non-qualifying income.

7. **SBR "every earlier period ≤ AED 3m" and group revenue. Decided in the November 2026 review.**
   *Now:* if either is unanswered, SBR is not applied and a HIGH flag says "Confirm before using SBR". A blank group revenue no longer means "not in a group": tick "Not part of a group" for that.

## Losses and interest

8. **Loss periods.** The spec says "a table of year → amount".
   *Now:* each row takes the period **start date**. A period that started before 1 June 2023 is not a tax period, even if it ended after that date.

9. **Ownership change.** When losses are excluded (by choice, or by cautious mode if nobody has chosen), they are treated as forfeited and not carried forward.

10. **Adjusted EBITDA** adds back accounting depreciation/amortisation lines and the tax depreciation entered for capital items. Carried-forward interest is tagged with its period-end year and expires once it is more than 10 years old.

11. **One interest flag.** Section 7.5 asks for a HIGH flag when net interest is over the limit, and RV-06 asks for the same thing. The app raises one flag, RV-06.

## Deadlines and penalties

12. **Late payment. Decided in the November 2026 review.** 14% a year for each month or part of a month (Cabinet Decision 75/2023): tax × 14% ÷ 12 × months late. One day late counts as a month. The note about "earlier penalty rules before 14 April 2026" is gone, because CT was always 14%. Months are counted from the due date month end to month end (30 Sep → 31 Oct → 30 Nov).
    *Settings, approved in the restyle request:* the late-payment setting now names Cabinet Decision 75/2023 (14% a year, for each month or part thereof), and the 14 April 2026 start date (`penalties.latePaymentRateFrom`, Cabinet Decision 129/2025) is removed for CT.

13. **Registration due date. Decided in the November 2026 review.**
    - Company: incorporation + 3 months, keeping the same day number (clamped to the month length), with no jump to month end: 28 Feb → 28 May, 30 Sep → 30 Dec. Return deadlines keep the month-end rule (31 Dec → 30 Sep).
    - Resident natural person: turnover above AED 1M in a calendar year → by 31 March of the next year. The year defaults to the period-end year.
    - Non-resident: with a permanent establishment, 6 months from the date it starts; with a nexus, 3 months from the date of the nexus. Both use the same-day rule.
    - *Not modelled:* non-resident natural persons, and companies incorporated before 1 March 2024 (fixed dates by licence month).

## Storage and other choices

14. **What a saved client holds.** Besides the fields listed in section 10, a saved client also holds the trial balance lines, the headline numbers and any accepted ledger sub-lines (with their transaction evidence), so a reopened client shows its full computation. Uploaded file bytes and the raw general ledger are never stored.

15. **Duplicate to next year** turns this year's loss carried forward into a single loss row dated with this period's start. Interest carried forward keeps its origin years.

16. **Rule IDs.** The spec writes "AB-08/10" for related-party expenses. The app uses AB-08 for related-party pricing add-backs and AB-10 for the Master File / Local File flag (as in the flags table).

17. **`vatRate` (5%)** is now used by the VAT section (point 58). RV-03 still compares revenue with total supplies on the VAT returns (standard + zero-rated + exempt), which exclude VAT.

## Company profile auto-fill

19. **The SBR lock beats an earlier answer.** If someone answered "SBR elected: Yes" and the revenue turns out above AED 3M, the field shows "No" and is locked, because SBR is not available by law. The lock lifts if revenue is corrected below the limit. Every other auto-filled answer gives way to a person's answer.

20. **Legal form ignores trial balance lines.** Free zone words are searched in titles and notes, not in account names or comments. Those name other parties (for example "Purchases from ABC FZE") and would wrongly make a mainland company look like a free zone company.

21. **"Realisation basis: Not relevant" is cautious.** It is only filled when no line or note mentions unrealised, fair value, revaluation or OCI items (statement titles such as "…and other comprehensive income" are ignored). Many full IFRS sets mention "fair value" in their accounting policies, so for those the question stays open.

22. **Foreign income "Yes (suggested)"** fires on any note mentioning a branch, so a UAE branch also triggers it. It is only a suggestion; change it to No if the branch is in the UAE.

23. **What the summary line counts:** every visible profile answer (14 for the Al Noor fixture: 8 filled, 6 need you). Hidden questions (certificates and Foreign PE when there is no foreign income, the QFZP block unless the form is QFZP) and the optional "explanation of any difference" are not counted. "Not part of a group" counts as an answer for group revenue.

24. **The Al Noor fixture's ANSWERS sheet vs. the review fixes.** After the review fixes (points 3 and 4), the director's pay and the car add nothing until answered, as the sheet expects. One conflict remains:
   - Review item 9 sorts "Portfolio Management Fee" as AB-04 automatically, so its AED 5,000 is added back before any question is answered.
   - The sheet's part A was written when that fee was still an AB-08 related-party fee (its note C says so).

   So, with nothing answered:

   | | Add-backs | Taxable | Tax | Tax with the 150,000 loss |
   |---|---|---|---|---|
   | Sheet (fee in AB-08) | 74,000 | 884,000 | 45,810 | 32,310 |
   | App now (fee in AB-04) | 79,000 | 889,000 | 46,260 | 32,760 |

   Both rows are regression tests; the sheet's row puts the fee in AB-08 by hand. Part B (AED 54,810) matches with no change, and business purpose is no longer needed.
   *Since the November 2026 review:* "Consultancy Fees" (no invoice) is no longer added back until staff answer "No evidence" (point 41). The figures above now need that one answer. With truly nothing answered, the app shows 54,000 / 864,000 / AED 44,010, with a MEDIUM "Supporting evidence missing" flag for AED 25,000. **Confirm:** that the fee belongs in AB-04 from the start (the review's intent), so the sheet's part A figures should be updated to 79,000 / 889,000 / 46,260 / 32,760.
   The loss from "Tax Loss for the Year" is still offered as a suggestion to confirm (spec section 5), not used automatically.

## Review fixes

26. **Position rule only in balance-sheet-first trial balances.** Every line above the first revenue line becomes balance sheet unless its name clearly says P&L. This now overrides keyword, comment and related-party matches (never a saved mapping). It only applies when at least half of the recognised lines above revenue are balance-sheet accounts. A trial balance that lists P&L lines first is left alone. The "clearly P&L" words are: expense, charges, cost, income, salary, wages, fee, depreciation, interest expense, finance cost, purchases, rent, repairs, maintenance, utilities, advertising, entertainment, fines, penalties, donations, commission.

27. **Generic balance-sheet words now run first,** with a wider list of P&L words that cancel them. That is how "Interest on bank loan", "Motor vehicle repairs" and "Office equipment purchased" stay P&L lines. All drawings, including "Owner/partner drawings", are now equity (see point 30).

## Final review fixes

29. **"Never balance sheet" has a narrow exception.** Lines naming interest, finance cost, "profit on" or charges are never balance sheet, unless the name also says receivable, payable, accrued, accrual, prepaid, prepayment or deferred. So "Interest receivable" and "Accrued interest" stay balance-sheet accounts, while "Interest on loan from director" is interest expense.

30. **Drawings** ("Drawings", "Owner('s) drawings", "Partner drawings", "Withdrawals by owner") are equity: balance sheet with an RV-05 HIGH flag, never a connected-person payment, and never counted towards the AED 500,000 disclosure. This replaces the original spec's "owner + drawings → connected-person payment".

31. **Grouping for the AED 500,000 disclosure.** Interest paid to a director, owner, shareholder or partner now counts towards that person's total. When an account gives no name (and the related-parties list doesn't match), lines are grouped by role. "Director's remuneration" and "Interest on loan from director" therefore both count for "Director". Two different unnamed directors would be added together, which errs towards disclosing.

32. **Income from connected persons.** A credit line naming a shareholder, director, owner, partner, sister company or a listed related party gets a MEDIUM RV-04 flag. It becomes other income, except that revenue, interest income, dividends and unrealised items keep their own category, because those carry their own tax treatment. A dividend from a sister company stays exempt, and interest income from a director still counts in the interest limit. **Confirm:** that you want these kept, rather than all such lines moved to other income.

33. **Personal costs before connected-person pay** (school fees, tuition, family medical or travel, holiday, home rent, household, personal) do not apply when the name also says allowance, salary, wages, bonus or remuneration. So "Director holiday allowance" stays a connected-person payment, and "holiday pay" stays salary.

34. **Single-column trial balances** are recognised from a header row with an account column (Account, Account name, Particulars, Description, Ledger, Name…) and exactly one Balance / Closing Balance / Net / Amount / Net Balance column. To avoid reading statements as a TB, a sheet that contains "Profit before tax" or "Total assets" is never treated as a single-column TB.

35. **Revenue is never negative.** Revenue shown in brackets in the statements, a negative revenue typed by hand, or debit-balance revenue lines are all turned into a positive amount, with an INFO note saying so.

36. **Losses need a period start date.** A loss row without one is left out, and RV-10 (MEDIUM) asks for it. The "Yes, add it" button for a loss found in the statements fills the date only when the profile has a period start. Otherwise the row is added undated and flagged.

28. **The status bar no longer covers the file chips.** It is now docked at the bottom of the screen. After an upload, the page also scrolls the new file cards into view with a gap above the bar, because a bar at the bottom always covers whatever sits in that strip.

25. **Law values.** Every value in `settings.ts` was copied from the spec, including Ministerial Decision 131/2026 (SBR extended to 2029) and Ministerial Decision 84/2025 (audit threshold). I could not check them against tax.gov.ae from here. Please verify before the filing season.

## November 2026 review

Points 12 and 13 (late payment, registration dates) are above.

37. **SBR waits for two answers.** See points 4 and 7. The check does not depend on cautious mode.

38. **Total revenue for SBR / QFZP tests.** A new field in Headline numbers with its breakdown: revenue, other income (including interest), gains, exempt income, lines left out, and "VAT: excluded" (output VAT is a liability, never revenue). It is used for the SBR revenue limit, the SBR lock in the profile, and the QFZP de minimis test. Revenue alone is still used for the audit threshold, the Master File / Local File test and the VAT reconciliation.
    - *Default for now:* every income line counts (revenue, other income, interest, realised and unrealised gains, UAE and exempt foreign dividends). Staff can leave a line out, or put it back, with a reason. A change with no reason raises a MEDIUM "REV" flag.
    - "Gains" are other-income lines whose name says gain, disposal or "profit on sale", plus unrealised gains.
    - A revenue line that is left out comes off the statements' revenue figure.
    - **Decided (November 2026): every income line counts by default**, for both tests. The law defines revenue as "the gross amount of income derived during a Tax Period" (Art. 1), so this is the law's own figure, not a cautious guess. It also needs no action from staff. Staff leave a line out only when the law excludes it (for example a QFZP de minimis exclusion) and give the reason. The defaults sit in `CT_REVENUE_DEFAULTS` in `compute.ts`.

39. **Penalties: government fine or contract penalty.**
    - A line naming a government body is a fine (AB-06, added back). The words: traffic, RTA, police, municipality, ministry, FTA, federal tax authority, tax, VAT, customs, labour, MOHRE, immigration, GDRFA, ICA, DED, court, government, authority, regulator, parking, Salik.
    - A penalty with customer, client, supplier, vendor, subcontractor, contract, late delivery, delay or liquidated in it is contract damages (allowed). So are "customer compensation", "compensation paid to clients", "late delivery charges" and "delay charges".
    - Any other "penalty" becomes a new category, **Penalty (needs review)**. Nothing is added back, in cautious mode too, until staff choose "Fine or penalty, not under a contract" (added back) or "Compensation under a contract" (allowed). A MEDIUM AB-06 flag stays open until then.
    - **Decided (November 2026): a line that says "fine" or "violation" with no other clue is added back.** Art. 33 makes every fine and penalty non-deductible except amounts awarded as compensation for damages or breach of contract, and a "fine" is not contract compensation. "Fines and penalties" is therefore a fine. The review choices use the same test as the law: contract compensation or not.

40. **Penalties in the ledger scan** follow the same rules: government ones are suggested as fines, unclear ones as "Penalty (needs review)", and contract penalties are not suggested.

41. **No invoice (AB-14).** Not added back automatically, in cautious mode too. A MEDIUM flag "Supporting evidence missing" stays open until staff answer. "No evidence" adds the line back. "Evidence found" allows it, with no flag.

42. **QFZP failure.**
    - **Decided (November 2026):** only a real failure counts: a condition answered "not met", or the de minimis test failed on an entered figure. Art. 18 removes QFZP status when a condition is not met, and an unanswered question is not a known failure. So a condition left unanswered (which fails in cautious mode for this period) is not saved, and an open question never locks a client out for 5 years. The RV-11 flag tells staff to answer every condition before duplicating the client to next year.
    - The failure is saved on the client record when the client is saved, and shown in the Clients list.
    - On "Duplicate to next year", the profile gets "QFZP status lost in an earlier period: period end". The standard rate then applies to that period and the next 4, with a HIGH RV-11 flag. Staff can type or clear that date.
    - The 5 periods are counted as 12-month periods from the failed period's end (failed 31 Dec 2025 → standard rate until the period ending 31 Dec 2029).

43. **Business type and the interest limit.** Banks, insurance providers and natural persons are outside the 30% EBITDA limit, so nothing is added back under AB-13 for them. Not answered = ordinary business, so the limit applies (the cautious reading); the RV-06 flag says how to change it. A natural person also gets the natural-person registration rule by default.
    **Confirm:** while the limit doesn't apply, interest carried forward from earlier years is kept as it is: not used, not expired.

44. **Art. 31 (related-party loans).** Interest paid to a related party gets a question: "Was the loan used for a dividend, a share buyback or a capital contribution?" Until answered, a MEDIUM AB-13 flag stays open and nothing is added back. "Yes" adds all of that interest back and leaves it out of the net interest for the 30% limit. The hint tells staff to answer "Yes" only when there is no good commercial reason for the loan; that main-purpose judgement stays with a person.
    It applies to lines matched to the related-parties list, or naming a director, owner, shareholder, partner, sister company or group company. Interest to a related company is now tagged too, but it never counts towards a person's AED 500,000 disclosure.

45. **Foreign tax credit (Art. 47). Decided (November 2026).** One row per country or source of foreign income: the foreign income included in taxable income (after its costs) and the foreign tax paid on it. Most clients need one row.
    - *Each row is capped on its own:* the credit is the lower of the foreign tax paid and the UAE tax on the same income (Art. 47). A high foreign tax in one country cannot use room left by a low tax in another.
    - *How the cap is worked out:* tax × that income ÷ taxable income after losses. This shares the 0% band and loss relief across all income. It gives the smaller credit, so it can never claim more than the law allows. The caps never add up to more than the tax, and there is no credit when no UAE tax is due. (The other common reading, 9% × the foreign income, can claim more when the 0% band applies. I found no FTA text that supports it.)
    - *Unused credit is lost:* not carried forward, carried back or refunded. The refund rule added by Federal Decree-Law 28/2025 (Art. 49 bis) covers credits from Cabinet-specified incentives and reliefs, not foreign tax credit. An INFO flag shows the unused amount.
    - For a QFZP, the credit is worked out against the 9% non-qualifying part.
    - If the FTA's foreign-source income guide (CTGFSI1) shows a different cap method, change `foreignTaxCreditFor` in `compute.ts`.

46. **Cash basis of accounting: left for later.** The app assumes accrual-basis statements. **For the tax team:**
    - Should the app support clients allowed to use the cash basis (revenue at or below the limit, or exceptional circumstances approved by the FTA)?
    - If so, which adjustments are needed when a client moves between cash and accrual basis?
    - Which threshold and decision should go into settings.ts?

47. **New entries in settings.ts.** No existing value or reference was changed. Added, each with its reference:
    - `naturalPersonTurnover`: AED 1,000,000 (Cabinet Decision 49/2023);
    - `deadlines.naturalPersonRegistrationBy`: 31 March (FTA Decision 3/2024);
    - `deadlines.peRegistrationMonths`: 6 (FTA Decision 3/2024);
    - `deadlines.nexusRegistrationMonths`: 3 (FTA Decision 3/2024).

    Please check these with the rest before the filing season (point 25).

48. **Foreign tax charged in the P&L (open).** Lines named "withholding tax" or "foreign tax" are sorted as normal expenses, and RV-08 raises a MEDIUM flag saying taxes are not deductible, but nothing is added back. If Art. 33 makes tax on income imposed outside the UAE non-deductible, these should be added back. That matters more now that a foreign tax credit can be claimed: the same tax could otherwise be both deducted and credited. **Confirm:** should these lines be added back automatically?

## Restyle round (November 2026)

49. **Donations are never approved automatically.** Every donation, zakat, charity or sponsorship line is "Donation (not approved)", with 100% added back (AB-03), also when its name or comment says "approved", "QPBE" or "qualifying public benefit". Such a line says in its reason that staff should choose "Donation (approved charity)" if the recipient is on the approved list. Only that choice (a saved mapping) allows the donation.

50. **The calculator's own export is refused.** A workbook with two or more of the export's sheet names ("Computation", "Add-backs detail", "Settings used") is not read, and the screen says: "This is a calculator export, not client accounts. Upload the original trial balance." Two of three, so a client workbook that happens to have a "Computation" sheet is still read.

51. **Answers and expected-results sheets are skipped.** Nothing is read from a sheet whose name contains "expected", "answer" or "answers" ("Expected Results", "ANSWERS", "Answer key"): no numbers, no profile facts, no formula errors. The file card says which sheets were skipped.

52. **PBT only from a P&L.** Profit before tax is read only from a sheet named like a P&L (profit, loss, P&L, income, comprehensive, performance) or with a P&L heading in it ("Statement of profit or loss…", "Income statement", "Profit and loss…"). Otherwise it is worked out from the trial balance, with an INFO note. **Confirm:** a combined "Financial statements" sheet without such a heading no longer gives PBT; tell me if those are common in client files.

53. **"Eligible for SBR" flag.** When SBR is available but not elected and tax is due, a MEDIUM SBR flag says: "Eligible for SBR: electing would make the tax AED 0. Confirm with the client." The profile shows the same in green under "Small Business Relief elected?".

## File detection and VAT (November 2026)

54. **Every sheet of a workbook is used for what it holds.** A workbook is still shown with one detected type (a trial balance makes it at least "Trial balance"), but its general ledger, related-parties list, VAT returns and invoice registers are used too. Before, only the detected type was used, so a test pack's ledger, related parties and invoices were read but ignored. The file card lists each sheet's role. When staff pick a type by hand, only that type is used, as before.
    One side effect: in the test pack, "Dividend income – UAE subsidiary" now matches the related-parties list, so a MEDIUM RV-04 flag asks to confirm it is at market value. The tax is unchanged.

55. **PBT from the trial balance is a DATA flag.** When no P&L sheet gives profit before tax, PBT is the total of the trial balance P&L lines, with a DATA flag that starts "PBT taken from the trial balance". (It was an INFO note.)

56. **Cause of "File type not recognised" / "VAT returns", PBT 0, tax 0: found.** It is what happens after "VAT returns" is picked by hand in the file-type list. A type picked by hand reads only that type, and a workbook without a VAT-returns sheet then gives nothing, so the tax fell to 0, under a misleading "not recognised" message. Now:
    - types the file does not hold are marked "(not found in this file)";
    - a hand-picked type shows a note saying what it means, with a "Use the detected type" button;
    - the message says nothing of the chosen type was found, never "not recognised";
    - the VAT tab says VAT needs sales or purchase registers (filed VAT returns only check revenue).

57. **Sales and purchase registers.** A sheet is a register when it has an invoice/receipt/bill number column, net and VAT columns, and a gross or rate column. A customer column (or a sales-like sheet name) makes it sales; a supplier column, an "Input VAT status" column or a purchase-like name makes it purchases. Registers are kept with the saved client, like the trial balance lines; file bytes are never stored.

58. **VAT section: choices made.**
    - Input VAT is recoverable by default. It is blocked automatically when the status says "blocked" or the description or category is client entertainment, and it is not applicable when the status says so or the line has no VAT. Motor vehicles for personal use and goods or services for employees' personal use are blocked by staff (the hint names them); the registers rarely say so in words. **Confirm** you are happy with "recoverable unless shown otherwise", or whether lines with no status should need a person.
    - Staff changes need a reason; without one a MEDIUM flag stays open.
    - Checks: VAT more than AED 1 away from 5% of net, or a rate other than 0% or 5% (MEDIUM); net + VAT more than AED 1 away from gross (MEDIUM); duplicate invoice numbers, for purchases the same supplier and number (HIGH, because VAT could be counted twice); supplier TRN missing on a recoverable line (MEDIUM), or an INFO note when the register has no TRN column; VAT on sales differing from 5% of trial balance revenue by more than AED 1 or 0.1% (MEDIUM).
    - The VAT section does not change the corporate tax computation.
    - Exports: the Excel working paper gets a "VAT" sheet when registers are uploaded. The PDF client report is unchanged; the request was cut off at "Export the VAT", so **confirm** whether the PDF should show VAT too.

59. **Found while testing, not changed:** auto-fill reads the test pack's READ ME!B8 ("Not an MNE group; not a tax group; …") as Legal form "Tax group member", and takes the whole READ ME!B5 sentence as the client name. Neither changes the tax. Say if you want these fixed.
