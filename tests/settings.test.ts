import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_INFO, SETTINGS, formatSetting, settingKeys, settingValue } from '../src/engine/settings';

describe('settings', () => {
  it('lists every setting on the Settings screen, and nothing extra', () => {
    const keys = settingKeys().sort();
    const listed = SETTING_INFO.map((s) => s.key).sort();
    expect(listed).toEqual(keys);
  });

  it('gives every setting a reference', () => {
    for (const s of SETTING_INFO) {
      expect(s.reference.length, s.key).toBeGreaterThan(5);
      expect(settingValue(s.key), s.key).not.toBeUndefined();
    }
  });

  it('holds the law values from the spec', () => {
    expect(SETTINGS.rate).toBe(0.09);
    expect(SETTINGS.zeroBand).toBe(375_000);
    expect(SETTINGS.sbr.lastPeriodEnd).toBe('2029-12-31');
    expect(SETTINGS.penalties.latePaymentAnnualRate).toBe(0.14);
    expect(formatSetting(SETTING_INFO[0])).toBe('9%');
  });

  it('holds the registration rules for natural persons and non-residents, and shows 14% without a long decimal', () => {
    const show = (key: string) => formatSetting(SETTING_INFO.find((s) => s.key === key)!);
    expect(SETTINGS.naturalPersonTurnover).toBe(1_000_000);
    expect(show('deadlines.naturalPersonRegistrationBy')).toBe('31 March');
    expect(show('deadlines.peRegistrationMonths')).toBe('6 months');
    expect(show('deadlines.nexusRegistrationMonths')).toBe('3 months');
    expect(show('penalties.latePaymentAnnualRate')).toBe('14%');
  });

  it('late payment of CT: Cabinet Decision 75/2023, 14% a year for each month or part thereof, with no 14 Apr 2026 start date', () => {
    const info = SETTING_INFO.find((s) => s.key === 'penalties.latePaymentAnnualRate')!;
    expect(info.reference).toBe('Cabinet Decision 75/2023');
    expect(SETTINGS.penalties.latePaymentAnnualRate).toBe(0.14);
    expect(settingKeys()).not.toContain('penalties.latePaymentRateFrom');
    expect(SETTING_INFO.some((s) => /129\/2025/.test(s.reference) || settingValue(s.key) === '2026-04-14')).toBe(false);
    const source = readFileSync(join(__dirname, '..', 'src', 'engine', 'settings.ts'), 'utf-8');
    expect(source).not.toMatch(/2026-04-14|129\/2025/);
  });

  it('has no tax numbers hard-coded outside settings.ts', () => {
    const root = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !p.endsWith('settings.ts')) files.push(p);
      }
    };
    walk(root);
    const law =
      /(?<![\w.])(0\.09|0\.75|0\.14|375[_,]?000|12[_,]?000[_,]?000|3[_,]?000[_,]?000|3[_,]?150[_,]?000[_,]?000|40[_,]?000[_,]?000|200[_,]?000[_,]?000|50[_,]?000[_,]?000|2029-12-31|2023-06-01|2026-04-14)(?![\w.])/;
    const offenders = files.filter((f) => law.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
