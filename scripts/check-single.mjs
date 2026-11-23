// Acceptance check: opens single/uae-ct-calculator.html in a real browser (Edge or Chrome
// already installed on the machine), uploads the sample files, and checks:
//  - the tax figure appears and matches the expected value
//  - there are no console errors
//  - the page does not scroll sideways at 400px width
//  - Excel and PDF exports download
// Run: npm run build:single && npm run check:single
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page1 = join(root, 'single', 'uae-ct-calculator.html');
const samples = join(root, 'samples');
const shots = process.env.SHOTS_DIR || join(root, 'test-results');
// Nothing answered: "Professional fees" (no invoice) is flagged, not added back. Answering "No evidence" adds it back.
const EXPECTED_TAX = 'AED 2,025';
const EXPECTED_TAX_NO_EVIDENCE = 'AED 4,275';

if (!existsSync(page1)) throw new Error('Run "npm run build:single" first.');
if (!existsSync(join(samples, 'sample-company.xlsx'))) throw new Error('Run "npm run sample" first.');
mkdirSync(shots, { recursive: true });

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try the next browser */
    }
  }
  return chromium.launch();
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const requests = [];
page.on('request', (r) => !r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && requests.push(r.url()));

await page.goto(pathToFileURL(page1).href);
await page.waitForSelector('[data-testid=tax-figure]');
check('App loads from a single file', true);

// Keyboard: the first Tab reaches the skip link.
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
check('Keyboard focus starts at the skip link', focused === 'Skip to content', focused);

await page.setInputFiles('[data-testid=file-input]', ['sample-company.xlsx', 'sample-general-ledger.xlsx', 'sample-vat-returns.csv', 'sample-related-parties.csv'].map((f) => join(samples, f)));
await page.waitForFunction((t) => document.querySelector('[data-testid=tax-figure]')?.textContent === t, EXPECTED_TAX, { timeout: 15000 }).catch(() => {});
const tax = await page.textContent('[data-testid=tax-figure]');
check('Tax figure appears after upload', tax === EXPECTED_TAX, `shows ${tax}`);

const lines = await page.locator('[data-testid=acc-line]').count();
check('Accounts section lists trial balance lines', lines > 10, `${lines} P&L lines shown`);

// Answer "No evidence" for the no-invoice line: it is added back.
await page.getByLabel('Supporting evidence?').selectOption('none');
await page.waitForFunction((t) => document.querySelector('[data-testid=tax-figure]')?.textContent === t, EXPECTED_TAX_NO_EVIDENCE, { timeout: 5000 }).catch(() => {});
const taxAnswered = await page.textContent('[data-testid=tax-figure]');
check('"No evidence" adds the unsupported expense back', taxAnswered === EXPECTED_TAX_NO_EVIDENCE, `shows ${taxAnswered}`);
const ctTotal = await page.textContent('[data-testid=ct-revenue-total]');
check('Total revenue for SBR / QFZP tests is shown', ctTotal === 'AED 4,260,000', `shows ${ctTotal}`);
const banner = await page.locator('[data-testid=not-final]').count();
check('Not-final banner shows while HIGH flags are open', banner === 1);
await page.screenshot({ path: join(shots, 'desktop.png'), fullPage: false });

// Downloads (outside claude.ai the app downloads normally).
for (const [label, ext] of [
  ['Export Excel', '.xlsx'],
  ['Export PDF', '.pdf'],
]) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: label }).click()]);
  check(`${label} downloads a file`, dl.suggestedFilename().endsWith(ext), dl.suggestedFilename());
  await dl.saveAs(join(shots, `export${ext}`));
}

// Save the client, find it in the Clients panel, resolve a flag.
await page.getByLabel('Client name').fill('Al Noor Trading LLC');
await page.getByRole('button', { name: 'Save client' }).click();
await page.getByRole('button', { name: 'Clients', exact: true }).click();
const listed = await page.locator('.client-item').count();
check('Saved client appears in the Clients panel', listed === 1, `${listed} client(s)`);
await page.getByRole('button', { name: 'Close clients' }).click();
const highBefore = await page.locator('li.flag[data-level=HIGH]:not(.resolved)').count();
const firstHigh = page.locator('li.flag[data-level=HIGH]:not(.resolved)').first();
await firstHigh.getByRole('button', { name: 'Mark resolved' }).click();
await page.locator('li.flag textarea').first().fill('Checked with the client; agreement on file.');
await page.locator('li.flag').getByRole('button', { name: 'Save', exact: true }).click();
const highAfter = await page.locator('li.flag[data-level=HIGH]:not(.resolved)').count();
check('A flag can be resolved with a note', highAfter === highBefore - 1, `open HIGH ${highBefore} → ${highAfter}`);

// Narrow screen.
await page.setViewportSize({ width: 400, height: 860 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
check('No sideways scroll at 400px', overflow.sw <= overflow.w, `scrollWidth ${overflow.sw}, width ${overflow.w}`);
await page.screenshot({ path: join(shots, 'mobile-400.png'), fullPage: false });
await page.locator('#accounts').scrollIntoViewIfNeeded();
await page.screenshot({ path: join(shots, 'mobile-400-accounts.png'), fullPage: false });

// Dark mode.
await page.emulateMedia({ colorScheme: 'dark' });
await page.setViewportSize({ width: 1280, height: 900 });
await page.locator('#computation').scrollIntoViewIfNeeded();
await page.screenshot({ path: join(shots, 'desktop-dark.png'), fullPage: false });

// Phone (400px) straight after an upload: header buttons, file-type dropdowns, toast position.
const phone = await ctx.newPage();
phone.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
phone.on('pageerror', (e) => errors.push(e.message));
await phone.setViewportSize({ width: 400, height: 860 });
await phone.goto(pathToFileURL(page1).href);
await phone.waitForSelector('[data-testid=tax-figure]');
await phone.screenshot({ path: join(shots, 'phone-400-top.png'), fullPage: false });
await phone.setInputFiles('[data-testid=file-input]', ['sample-company.xlsx', 'sample-general-ledger.xlsx', 'sample-vat-returns.csv', 'sample-related-parties.csv'].map((f) => join(samples, f)));
await phone.waitForSelector('.toast');
await phone.waitForTimeout(900); // let the page bring the new file cards into view
const layout = await phone.evaluate(() => {
  const box = (el) => el.getBoundingClientRect();
  const save = box(document.querySelector('.actions button.primary'));
  const selects = [...document.querySelectorAll('.file-row')].map((row) => {
    const cs = getComputedStyle(row);
    const inner = box(row).width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    return Math.abs(box(row.querySelector('select')).width - inner);
  });
  const toast = box(document.querySelector('.toast'));
  const covered = [...document.querySelectorAll('.file-row .chips .chip')].filter((c) => {
    const r = box(c);
    return r.bottom > 0 && r.top < window.innerHeight && r.bottom > toast.top && r.top < toast.bottom;
  }).length;
  return { save: [Math.round(save.width), Math.round(save.height)], themeBtn: !!document.querySelector('.theme-btn'), dark: document.documentElement.dataset.theme, selectGap: Math.max(...selects), toastBottom: Math.round(toast.bottom), toastTop: Math.round(toast.top), vh: window.innerHeight, covered, sw: document.documentElement.scrollWidth };
});
check('Phone: Save client is a 44px-tall tap target', layout.save[0] >= 44 && layout.save[1] >= 44, `${layout.save.join('×')}`);
check('Light theme only: no theme button', !layout.themeBtn && layout.dark === 'light', `theme button ${layout.themeBtn}, data-theme ${layout.dark}`);
check('Phone: file-type dropdowns fill their cards', layout.selectGap <= 2, `largest gap ${layout.selectGap.toFixed(1)}px`);
check('Phone: toast is docked at the bottom of the screen', layout.toastBottom === layout.vh, `toast ${layout.toastTop}–${layout.toastBottom}, screen ${layout.vh}`);
check('Phone: toast covers none of the file chips', layout.covered === 0, `${layout.covered} chip(s) under the toast`);
check('Phone: no sideways scroll after upload', layout.sw <= 400, `scrollWidth ${layout.sw}`);
await phone.screenshot({ path: join(shots, 'phone-400.png'), fullPage: false });
await phone.screenshot({ path: join(shots, 'phone-400-full.png'), fullPage: true });
await phone.close();

// The test pack: one workbook with a trial balance, ledger, related parties, sales and purchase registers
// and an answer key. Every sheet is read for what it holds; the answer key is never read.
const pack = join(root, 'tests', 'fixtures', 'UAE_Corporate_Tax_Test_Pack_2025.xlsx');
const vatPack = join(root, 'tests', 'fixtures', 'VAT_Test_Pack_Q3_2026.xlsx');
if (existsSync(pack)) {
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(pathToFileURL(page1).href);
  await p.setInputFiles('[data-testid=file-input]', [pack]);
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 17,550', null, { timeout: 15000 }).catch(() => {});
  const packTax = await p.textContent('[data-testid=tax-figure]');
  const kind = await p.evaluate(() => {
    const s = document.querySelector('.file-row select');
    return s ? s.options[s.selectedIndex].text : '';
  });
  check('Test pack: detected as Corporate tax', kind === 'Corporate tax (detected)', kind);
  const nameBefore = await p.inputValue('#profile input[placeholder="Type the client name"]').catch(() => '?');
  check('Client name is not filled in by itself', nameBefore === '', `"${nameBefore}"`);
  await p.getByRole('button', { name: /Use “Desert Star Office Supplies LLC” from the file/ }).click();
  const nameAfter = await p.inputValue('#profile input[placeholder="Type the client name"]').catch(() => '?');
  check('"Use … from the file" fills the suggested name', nameAfter === 'Desert Star Office Supplies LLC', `"${nameAfter}"`);
  const options = await p.evaluate(() => Array.from(document.querySelector('.file-row select')?.options ?? []).map((o) => o.text));
  check('File type list has only Corporate tax and VAT', options.length === 2 && /^Corporate tax/.test(options[0]) && /^VAT/.test(options[1]), options.join(' / '));
  check('Test pack: tax AED 17,550 (PBT worked out from the trial balance)', packTax === 'AED 17,550', `shows ${packTax}`);
  const payable = await p.textContent('#vat .stat.main .stat-value');
  check('Test pack: VAT payable AED 44,500', payable === 'AED 44,500.00', `shows ${payable}`);
  await p.locator('#vat').scrollIntoViewIfNeeded();
  await p.locator('#vat').screenshot({ path: join(shots, 'vat.png') });

  // Picking "VAT" reads only the VAT sheets: the header shows VAT payable, and the way back is offered.
  await p.locator('.file-row select').selectOption('vat');
  await p.waitForSelector('.chosen-type', { timeout: 5000 }).catch(() => {});
  const vatHeader = (await p.textContent('.tax-figure')) ?? '';
  check('Picking "VAT" shows VAT payable AED 44,500 in the header', /VAT payable/i.test(vatHeader) && /44,500\.00/.test(vatHeader), vatHeader.replace(/\s+/g, ' ').slice(0, 80));
  await p.getByRole('button', { name: 'Use the detected type' }).click();
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 17,550', null, { timeout: 5000 }).catch(() => {});
  check('"Use the detected type" brings corporate tax back', (await p.textContent('[data-testid=tax-figure]')) === 'AED 17,550', `shows ${await p.textContent('[data-testid=tax-figure]')}`);

  // A VAT-only workbook is detected as VAT and gives the VAT return.
  await p.locator('.file-row').getByRole('button', { name: /Remove/ }).click();
  await p.setInputFiles('[data-testid=file-input]', [vatPack]);
  await p.waitForFunction(() => /6,500\.00/.test(document.querySelector('[data-testid=tax-figure]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const vatKind = await p.evaluate(() => {
    const s = document.querySelector('.file-row select');
    return s ? s.options[s.selectedIndex].text : '';
  });
  check('VAT pack: detected as VAT', vatKind === 'VAT (detected)', vatKind);
  check('VAT pack: VAT payable AED 6,500 (answer key)', /6,500\.00/.test((await p.textContent('[data-testid=tax-figure]')) ?? ''), (await p.textContent('.tax-figure'))?.replace(/\s+/g, ' ').slice(0, 80));
  const box10 = (await p.textContent('#vat tr[data-box="10"]')) ?? '';
  check('VAT pack: imports read (Box 10 = 17,000)', /17,000\.00/.test(box10), box10.replace(/\s+/g, ' '));
  await p.close();
}

// Yellow boxes: every answer staff still need to give is a yellow box.
{
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(page1).href);
  await p.setInputFiles('[data-testid=file-input]', [pack]);
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 17,550', null, { timeout: 15000 }).catch(() => {});
  const yellow = await p.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.field.need, .cfield.need'));
    const bgs = new Set(all.map((el) => getComputedStyle(el).backgroundColor));
    return { n: all.length, bg: [...bgs].join(' ') };
  });
  check('Questions still to answer are yellow boxes', yellow.n > 0 && yellow.bg.split(' rgb').length === 1 && !/rgba\(0, 0, 0, 0\)/.test(yellow.bg), `${yellow.n} yellow box(es), ${yellow.bg}`);
  const cur = await p.inputValue('[data-testid=currency-bar] select').catch(() => '?');
  check('AED file: currency shows AED', cur === 'AED', cur);
  await p.close();
}

// Small Business Relief on the test pack: ON with every condition answered → AED 0; OFF → AED 17,550.
{
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(page1).href);
  await p.setInputFiles('[data-testid=file-input]', [pack]);
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 17,550', null, { timeout: 15000 }).catch(() => {});
  const pick = async (label, value) => p.getByLabel(label, { exact: false }).first().selectOption(value);
  await pick('Small Business Relief elected?', 'yes');
  const onlyElected = await p.textContent('[data-testid=tax-figure]');
  check('SBR elected but earlier periods / group not answered: still AED 17,550', onlyElected === 'AED 17,550', `shows ${onlyElected}`);
  await pick('All earlier periods had revenue', 'yes');
  await p.getByLabel('Not part of a group').check();
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 0', null, { timeout: 5000 }).catch(() => {});
  check('SBR ON with every condition met: AED 0', (await p.textContent('[data-testid=tax-figure]')) === 'AED 0', `shows ${await p.textContent('[data-testid=tax-figure]')}`);
  await pick('Small Business Relief elected?', 'no');
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 17,550', null, { timeout: 5000 }).catch(() => {});
  check('SBR OFF again: AED 17,550', (await p.textContent('[data-testid=tax-figure]')) === 'AED 17,550', `shows ${await p.textContent('[data-testid=tax-figure]')}`);
  await p.close();
}

// Customer onboarding: the company records workbook and three PDFs (auditor, director, VAT note).
{
  const dir = join(root, 'tests', 'fixtures', 'desert-star');
  const names = ['Desert_Star_Company_Records_FY2025.xlsx', 'Independent_Auditors_Report.pdf', 'Director_Confirmation.pdf', 'VAT_Reconciliation_Note.pdf'];
  if (names.every((n) => existsSync(join(dir, n)))) {
    const p = await ctx.newPage();
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(pathToFileURL(page1).href);
    await p.setInputFiles('[data-testid=file-input]', names.map((n) => join(dir, n)));
    await p.waitForFunction(() => document.querySelectorAll('.file-row').length === 4 && document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 0', null, { timeout: 20000 }).catch(() => {});
    const docs = await p.locator('.doc-kind').count();
    check('Onboarding: the three PDFs are read as supporting documents', docs === 3, `${docs} document(s)`);
    const val = (label) => p.getByLabel(label, { exact: true }).first().inputValue().catch(() => '?');
    const got = {
      start: await val('Period start'),
      end: await val('Period end'),
      legal: await val('Legal form'),
      foreign: await val('Foreign income or a foreign branch?'),
      own: await val('Did ownership change this period?'),
      audited: await val('Financial statements audited?'),
      sbr: await val('Small Business Relief elected?'),
    };
    check('Onboarding: period 2025-01-01 to 2025-12-31', got.start === '2025-01-01' && got.end === '2025-12-31', `${got.start} to ${got.end}`);
    check('Onboarding: legal form Mainland (not Tax group member)', got.legal === 'mainland', got.legal);
    check('Onboarding: foreign income No, ownership change No, audited Yes', got.foreign === 'no' && got.own === 'no' && got.audited === 'yes', JSON.stringify({ foreign: got.foreign, own: got.own, audited: got.audited }));
    const tax = await p.textContent('[data-testid=tax-figure]');
    check('Onboarding: SBR elected and applied, corporate tax AED 0', got.sbr === 'yes' && tax === 'AED 0', `SBR ${got.sbr}, tax ${tax}`);
    const confirmed = await p.locator('.cfield-note .confirmed').count();
    check('Onboarding: answers show "Same answer in N files"', confirmed >= 3, `${confirmed} answer(s)`);
    const docFlags = await p.locator('li.flag', { hasText: 'documents disagree' }).count();
    check('Onboarding: no conflict flags for the matching pack', docFlags === 0, `${docFlags}`);
    await p.locator('#profile').screenshot({ path: join(shots, 'onboarding-profile.png') });
    await p.close();
  }
}

// A trial balance in US dollars is converted to AED; "Change to AED" uses the amounts as they are.
{
  const XLSX = await import('xlsx');
  const rows = [['Trial balance FY2025 – amounts in USD'], [], ['Account', 'Debit', 'Credit'], ['Sales revenue', 0, 1000000], ['Cost of sales', 400000, 0], ['Salaries', 100000, 0], ['Cash at bank', 500000, 0], ['Total', 1000000, 1000000]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Trial Balance');
  const usdFile = join(shots, 'tb-usd.xlsx');
  mkdirSync(shots, { recursive: true });
  writeFileSync(usdFile, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(pathToFileURL(page1).href);
  await p.setInputFiles('[data-testid=file-input]', [usdFile]);
  await p.waitForSelector('[data-testid=currency-bar]', { timeout: 15000 }).catch(() => {});
  const code = await p.inputValue('[data-testid=currency-bar] select').catch(() => '?');
  const rate = await p.inputValue('[data-testid=currency-bar] input').catch(() => '?');
  check('USD file: currency detected as USD at 3.6725', code === 'USD' && rate === '3.6725', `${code} @ ${rate}`);
  const usdTax = await p.textContent('[data-testid=tax-figure]');
  check('USD file: tax worked out in AED (PBT 500,000 USD = AED 1,836,250 → tax AED 131,513)', usdTax === 'AED 131,513', `shows ${usdTax}`);
  await p.locator('[data-testid=currency-bar] input').fill('');
  await p.waitForTimeout(200);
  const missing = await p.evaluate(() => !!document.querySelector('[data-testid=currency-bar] .field.need'));
  check('No rate: the rate box turns yellow', missing);
  await p.getByRole('button', { name: 'Change to AED (Dhs)' }).click();
  await p.waitForFunction(() => document.querySelector('[data-testid=tax-figure]')?.textContent === 'AED 11,250', null, { timeout: 5000 }).catch(() => {});
  check('"Change to AED" uses the amounts as they are (tax AED 11,250)', (await p.textContent('[data-testid=tax-figure]')) === 'AED 11,250', `shows ${await p.textContent('[data-testid=tax-figure]')}`);
  await p.locator('#upload').screenshot({ path: join(shots, 'currency.png') });
  await p.close();
}

check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
check('No network requests', requests.length === 0, requests.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${shots}`);
process.exit(failed.length ? 1 : 0);
