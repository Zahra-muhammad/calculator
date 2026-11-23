import { describe, expect, it } from 'vitest';
import { classifyLine, classifyLines, detectHiddenVat, openQuestions } from '../src/engine/classify';
import type { TBLine } from '../src/engine/types';

let row = 1;
function tb(account: string, balance: number, comment = '', extra: Partial<TBLine> = {}): TBLine {
  row++;
  return {
    key: account.toLowerCase(),
    row,
    sheet: 'TB',
    account,
    debit: balance > 0 ? balance : 0,
    credit: balance < 0 ? -balance : 0,
    balance,
    comment,
    ...extra,
  };
}

describe('classification by account name', () => {
  const cases: [string, number, string][] = [
    ['Cash at bank', 1000, 'balance_sheet'],
    ['Bank charges', 300, 'normal_expense'],
    ['Accumulated depreciation - vehicles', -500, 'balance_sheet'],
    ['Depreciation expense', 500, 'depreciation'],
    ['Accrued expenses', -800, 'balance_sheet'],
    ['VAT control account', -100, 'balance_sheet'],
    ['Non-recoverable VAT', 100, 'vat_expensed'],
    ['Corporate tax expense', 900, 'below_pbt'],
    ['Corporate tax payable', -900, 'balance_sheet'],
    ['Deferred tax asset', 50, 'balance_sheet'],
    ['Traffic fines', 400, 'fines'],
    ['Liquidated damages to customer', 400, 'contract_damages'],
    ['Donations', 100, 'donation_unlisted'],
    ['Staff party', 100, 'entertainment_staff'],
    ['Client entertainment', 100, 'entertainment_client'],
    ['Entertainment', 100, 'entertainment_unsplit'],
    ['Owner salary', 100, 'connected_person_payment'],
    ['Partners drawings', 100, 'balance_sheet'],
    ['Management fee - head office', 100, 'related_party_expense'],
    ['Personal expenses', 100, 'personal'],
    ['Motor vehicle running costs', 100, 'mixed_use'],
    ['Motor vehicles', 100, 'balance_sheet'],
    ['Interest income', -100, 'interest_income'],
    ['Interest on bank loan', 100, 'interest_expense'],
    ['Bank loan', -100, 'balance_sheet'],
    ['Dividend income', -100, 'dividend_received_uae'],
    ['Dividend income - foreign subsidiary', -100, 'dividend_received_foreign'],
    ['Dividends paid', 100, 'dividend_paid'],
    ['Unrealised gain on investments', -100, 'unrealised_gain_loss'],
    ['Revaluation reserve', -100, 'balance_sheet'],
    ['Sales', -100, 'revenue'],
    ['Cost of sales', 100, 'normal_expense'],
    ['Other income', -100, 'other_income'],
    ['Pension contributions', 100, 'pension'],
    ['Investment in subsidiary', 100, 'balance_sheet'],
    ['Investment advisory fees', 100, 'exempt_income_cost'],
    ['Due to director', -100, 'balance_sheet'],
    ['Director current account', 100, 'balance_sheet'],
    // Balance-sheet detection runs before every P&L rule.
    ['Loan to Related Party', 250_000, 'balance_sheet'],
    ['Loan from shareholder', -100, 'balance_sheet'],
    ['Loans to staff', 100, 'balance_sheet'],
    ['Advance to supplier', 100, 'balance_sheet'],
    ['Partner current a/c', 100, 'balance_sheet'],
    ['Accum-Depreciation. F&F', -100, 'balance_sheet'],
    ['Accum. Depreciation-IT Equipment', -100, 'balance_sheet'],
    ['Acc. Dep - Vehicles', -100, 'balance_sheet'],
    ['Accumulated dep. computers', -100, 'balance_sheet'],
    ['Prepaid License Fee', 100, 'balance_sheet'],
    ['Rent Prepaid Expenses', 100, 'balance_sheet'],
    ['Prepaid insurance', 100, 'balance_sheet'],
    ['Fees receivable', 100, 'balance_sheet'],
    ['Interest on bank loan', 100, 'interest_expense'],
    ['Motor vehicle repairs', 100, 'mixed_use'],
    ['Interest on fixed deposits', -100, 'interest_income'],
    ['Security deposit', 100, 'balance_sheet'],
    ['Drawings', 100, 'balance_sheet'],
    // Exempt-income costs before related-party fees; more related-party wording.
    ['Portfolio Management Fee', 5_000, 'exempt_income_cost'],
    ['Custody fees', 100, 'exempt_income_cost'],
    ['Brokerage on shares', 100, 'exempt_income_cost'],
    ['Management Services', 100, 'related_party_expense'],
    ['Management charges', 100, 'related_party_expense'],
    ['Service charges from group', 100, 'related_party_expense'],
    ['Consultancy from group', 100, 'related_party_expense'],
  ];
  it.each(cases)('%s → %s', (name, bal, expected) => {
    expect(classifyLine(tb(name, bal)).category).toBe(expected);
  });
});

describe('final review: account names A1–A8', () => {
  const cases: [string, number, string, string?][] = [
    // A1 interest, finance cost, "profit on", charges: never balance sheet, even with "loan".
    ['Interest on loan from director', 60_000, 'interest_expense'],
    ['Finance cost - shareholder loan', 10_000, 'interest_expense'],
    ['Interest on loan to shareholder', -5_000, 'interest_income'],
    ['Loan processing charges', 2_000, 'normal_expense'],
    ['Interest receivable', 3_000, 'balance_sheet'],
    ['Accrued interest', -3_000, 'balance_sheet'],
    // A2 drawings are equity.
    ['Drawings', 40_000, 'balance_sheet'],
    ['Owner drawings', 40_000, 'balance_sheet'],
    ["Owner's drawings", 40_000, 'balance_sheet'],
    ['Partner drawings', 40_000, 'balance_sheet'],
    ['Withdrawals by owner', 40_000, 'balance_sheet'],
    // A3 personal costs before connected-person pay.
    ["School fees - director's children", 30_000, 'personal'],
    ['Tuition fees', 30_000, 'personal'],
    ['Family medical insurance', 9_000, 'personal'],
    ['Family travel', 9_000, 'personal'],
    ['Owner holiday', 9_000, 'personal'],
    ['Director home rent', 90_000, 'personal'],
    ['Household expenses', 5_000, 'personal'],
    ['Director personal expenses', 5_000, 'personal'],
    ['Director salary', 300_000, 'connected_person_payment'],
    ['Owner remuneration', 300_000, 'connected_person_payment'],
    ['Directors fees', 50_000, 'connected_person_payment'],
    ['Director bonus', 50_000, 'connected_person_payment'],
    ['Partner allowances', 50_000, 'connected_person_payment'],
    ['Director holiday allowance', 20_000, 'connected_person_payment'],
    // A4 penalties: commercial = contract damages, government = fines.
    ['Penalty to customer for late delivery', 8_000, 'contract_damages'],
    ['Client penalty', 8_000, 'contract_damages'],
    ['Contractual penalty', 8_000, 'contract_damages'],
    ['Penalty - liquidated', 8_000, 'contract_damages'],
    ['Traffic fines', 1_000, 'fines'],
    ['RTA fines', 1_000, 'fines'],
    ['Police fine', 1_000, 'fines'],
    ['Municipality penalty', 1_000, 'fines'],
    ['Ministry of Economy penalty', 1_000, 'fines'],
    ['FTA penalty', 1_000, 'fines'],
    ['VAT penalty', 1_000, 'fines'],
    ['Customs penalty', 1_000, 'fines'],
    ['Labour penalty', 1_000, 'fines'],
    ['MOHRE fine', 1_000, 'fines'],
    ['Immigration fines', 1_000, 'fines'],
    ['DED penalty', 1_000, 'fines'],
    ['Court penalty', 1_000, 'fines'],
    // A5 entertainment in any order.
    ['Entertainment - staff', 4_000, 'entertainment_staff'],
    ['Entertainment (employees)', 4_000, 'entertainment_staff'],
    ['Team entertainment', 4_000, 'entertainment_staff'],
    ['Staff party', 4_000, 'entertainment_staff'],
    ['Entertainment - clients', 4_000, 'entertainment_client'],
    ['Entertainment (customer)', 4_000, 'entertainment_client'],
    ['Customer entertainment', 4_000, 'entertainment_client'],
    // A6 donations are never approved automatically, even when the name or comment says so: staff choose it.
    ['Donations (approved)', 5_000, 'donation_unlisted'],
    ['Donation - QPBE', 5_000, 'donation_unlisted'],
    ['Donations to qualifying public benefit entity', 5_000, 'donation_unlisted'],
    ['Donations', 5_000, 'donation_unlisted', 'Paid to an approved charity'],
    ['Donations', 5_000, 'donation_unlisted', 'Paid to a local community fund'],
    ['Donation - not approved', 5_000, 'donation_unlisted'],
    ['Charitable contributions', 5_000, 'donation_unlisted'],
    // A7 gifts with no client or staff word.
    ['Gifts', 3_000, 'entertainment_unsplit'],
    ['Corporate gifts', 3_000, 'entertainment_unsplit'],
    ['Gifts to clients', 3_000, 'entertainment_client'],
    ['Staff gifts', 3_000, 'entertainment_staff'],
    // A8 credit lines naming a connected person or sister company.
    ['Rent income from director', -24_000, 'other_income'],
    ['Management fee income - sister company', -60_000, 'other_income'],
    ['Consultancy received - shareholder', -15_000, 'other_income'],
    // Penalties that do not clearly name a government body need a person to decide.
    ['Penalties', 2_000, 'penalty_review'],
    ['Late payment penalty', 2_000, 'penalty_review'],
    ['Penalty charges', 2_000, 'penalty_review'],
    ['Other expenses', 2_000, 'penalty_review', 'Penalty paid'],
    // …government bodies are fines, and a "fine" or "violation" is imposed by an authority…
    ['Tax penalty', 2_000, 'fines'],
    ['Federal Tax Authority penalty', 2_000, 'fines'],
    ['Parking fines', 2_000, 'fines'],
    ['Fines', 2_000, 'fines'],
    ['Fines and penalties', 2_000, 'fines'],
    // …and contract words make it contract damages (allowed).
    ['Delay penalty', 2_000, 'contract_damages'],
    ['Delay penalties - project X', 2_000, 'contract_damages'],
    ['Supplier penalty', 2_000, 'contract_damages'],
    ['Late delivery charges', 2_000, 'contract_damages'],
    ['Late delivery penalty', 2_000, 'contract_damages'],
    ['Customer compensation', 2_000, 'contract_damages'],
    ['Compensation paid to clients', 2_000, 'contract_damages'],
    ['Other expenses', 2_000, 'contract_damages', 'Delay penalty under the supply contract'],
  ];
  it.each(cases)('%s → %s', (name, bal, expected, comment) => {
    expect(classifyLine(tb(name, bal, comment ?? '')).category).toBe(expected);
  });

  it('tags interest to the director and credit lines to the connected person', () => {
    expect(classifyLine(tb('Interest on loan from director', 60_000))).toMatchObject({ category: 'interest_expense', relatedParty: 'Director', relatedPartyType: 'person' });
    expect(classifyLine(tb('Management fee income - sister company', -60_000))).toMatchObject({ relatedParty: 'Sister company', evidence: 'related_party' });
    const listed = classifyLine(tb('Recharge to Al Noor Holdings LLC', -80_000), {
      relatedParties: [{ name: 'Al Noor Holdings LLC', type: 'company', relationship: 'Shareholder' }],
    });
    expect(listed).toMatchObject({ category: 'other_income', relatedParty: 'Al Noor Holdings LLC' });
    // A specific income category is kept: dividends from a sister company stay exempt.
    expect(classifyLine(tb('Dividend from sister company', -50_000)).category).toBe('dividend_received_uae');
    // Interest to a related company is tagged too (for the Art. 31 question), as a company.
    expect(classifyLine(tb('Interest on loan from sister company', 45_000))).toMatchObject({ category: 'interest_expense', relatedParty: 'Sister company', relatedPartyType: 'company' });
    expect(classifyLine(tb('Interest on bank loan', 45_000)).relatedParty).toBeUndefined();
  });
});

describe('donations', () => {
  it('a donation that says "approved" stays not approved, and the reason tells staff what to choose', () => {
    const c = classifyLine(tb('Donations (approved)', 5_000));
    expect(c.category).toBe('donation_unlisted');
    expect(c.reason).toContain('choose "Donation (approved charity)"');
    // Staff choosing it is a saved mapping, which always wins.
    const l = tb('Donations', 5_000);
    expect(classifyLine(l, { mappings: { [l.key]: 'donation_listed' } }).category).toBe('donation_listed');
  });
});

describe('order of evidence', () => {
  it('a saved mapping always wins', () => {
    const l = tb('Traffic fines', 400);
    const c = classifyLine(l, { mappings: { [l.key]: 'contract_damages' } });
    expect(c.category).toBe('contract_damages');
    expect(c.evidence).toBe('saved');
  });

  it('a related-party match beats the comment and the name', () => {
    const c = classifyLine(tb('Consultancy - Fatima Ahmed', 200_000, 'no invoice'), {
      relatedParties: [{ name: 'Fatima Ahmed', type: 'person', relationship: 'Wife of director', connectedTo: 'Ahmed Ali' }],
    });
    expect(c.category).toBe('connected_person_payment');
    expect(c.relatedParty).toBe('Fatima Ahmed');
  });

  it('a related party balance-sheet line stays balance sheet', () => {
    const c = classifyLine(tb('Due from Ali Holdings LLC', 50_000), {
      relatedParties: [{ name: 'Ali Holdings LLC', type: 'company', relationship: 'Shareholder' }],
    });
    expect(c.category).toBe('balance_sheet');
  });

  it('a comment beats the account name, but not for balance-sheet accounts', () => {
    expect(classifyLine(tb('Office expenses', 5_000, 'Includes police fine')).category).toBe('fines');
    expect(classifyLine(tb('Office expenses', 5_000, "Brother's salary")).category).toBe('connected_person_payment');
    expect(classifyLine(tb('Cash at bank', 5_000, 'no invoice')).category).toBe('balance_sheet');
    // Shared use wins over "owner": the car is mixed use, not a payment to the owner.
    expect(classifyLine(tb('Motor Vehicle Expenses', 40_000, 'Car also used by owner at weekends')).category).toBe('mixed_use');
    expect(classifyLine(tb('Personal & Family Expenses', 18_000, "Owner's family school fees")).category).toBe('personal');
  });

  it('position overrides keyword matches above the first revenue line, but never below it', () => {
    const out = classifyLines([
      tb('Cash at bank', 10_000),
      tb('Trade receivables', 8_000),
      tb('Share capital', -20_000),
      tb('Ahmed personal account', 5_000), // "personal" keyword, but above Sales
      tb('Staff welfare fund', -2_000), // no rule, above Sales
      tb('Office rent expense', 1_000), // clearly P&L: keeps its category
      tb('Sales', -50_000),
      tb('Family holiday', 3_000), // below Sales: stays personal
    ]);
    expect(out.map((l) => l.category)).toEqual(['balance_sheet', 'balance_sheet', 'balance_sheet', 'balance_sheet', 'balance_sheet', 'normal_expense', 'revenue', 'personal']);
    expect(out[3].evidence).toBe('position');

    // A P&L-first layout (mostly P&L lines above revenue) is left alone.
    const plFirst = classifyLines([tb('Salaries', 9_000), tb('Office rent', 2_000), tb('Owner salary', 3_000), tb('Revenue', -20_000), tb('Cash at bank', 6_000)]);
    expect(plFirst.map((l) => l.category)).toEqual(['normal_expense', 'normal_expense', 'connected_person_payment', 'revenue', 'balance_sheet']);
  });

  it('lines above the first revenue line are balance sheet; the rest default by side', () => {
    const out = classifyLines([tb('Zakaria account', 5_000), tb('Sales', -10_000), tb('Widgets', 1_000), tb('Xyzzy', -50)]);
    expect(out.map((l) => [l.category, l.evidence])).toEqual([
      ['balance_sheet', 'position'],
      ['revenue', 'keyword'],
      ['normal_expense', 'default'],
      ['other_income', 'default'],
    ]);
  });
});

describe('hidden VAT and open questions', () => {
  it('tags VAT moved from the VAT control account into an expense', () => {
    const lines = classifyLines([
      tb('VAT control account', -2_500, '', { adjDebit: 0, adjCredit: 500 }),
      tb('Repairs', 10_500, '', { adjDebit: 500, adjCredit: 0 }),
      tb('Sales', -8_000, '', { adjDebit: 0, adjCredit: 0 }),
    ]);
    const subs = detectHiddenVat(lines);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ parentKey: 'repairs', category: 'vat_expensed', amount: 500, source: 'hidden_vat' });
  });

  it('lists questions until they are answered', () => {
    expect(openQuestions('mixed_use', undefined)).toHaveLength(1);
    expect(openQuestions('mixed_use', { privateUse: 0.3 })).toHaveLength(0);
    expect(openQuestions('connected_person_payment', {})).toHaveLength(1);
    expect(openQuestions('connected_person_payment', { marketValue: 1 })).toHaveLength(0);
    expect(openQuestions('normal_expense', undefined, 'default')).toHaveLength(1);
  });

  it('asks about penalties, missing evidence and related-party loan interest', () => {
    expect(openQuestions('penalty_review', undefined)).toEqual(['Was this penalty imposed by a government body (a fine) or under a contract?']);
    expect(openQuestions('penalty_review', { penaltyType: 'unknown' })).toHaveLength(1);
    expect(openQuestions('penalty_review', { penaltyType: 'contract' })).toHaveLength(0);
    expect(openQuestions('no_invoice', undefined)).toEqual(['Is there an invoice or other supporting evidence for this expense?']);
    expect(openQuestions('no_invoice', { supportEvidence: 'found' })).toHaveLength(0);
    expect(openQuestions('no_invoice', { supportEvidence: 'none' })).toHaveLength(0);
    // Only interest paid to a related party gets the Art. 31 question.
    expect(openQuestions('interest_expense', undefined)).toHaveLength(0);
    expect(openQuestions('interest_expense', undefined, 'keyword', 'Sister company')).toHaveLength(1);
    expect(openQuestions('interest_expense', { art31Use: 'no' }, 'keyword', 'Sister company')).toHaveLength(0);
  });
});
