import { useState } from 'react';
import { SETTINGS_CHECK_NOTE, SETTING_INFO, formatSetting, settingValue, type SettingInfo } from '../engine/settings';
import { fmtDate } from '../engine/util';
import { Pill, Section } from './ui';

/** Dates read better as "31 Dec 2029" on screen. */
const show = (s: SettingInfo) => (s.format === 'date' ? fmtDate(String(settingValue(s.key))) : formatSetting(s));

/** The key settings shown before "Show all". The two SBR settings share one row. */
const KEY_ROWS: string[][] = [['rate'], ['zeroBand'], ['lossOffsetCap'], ['sbr.revenueLimit', 'sbr.lastPeriodEnd']];

export function SettingsView() {
  const [all, setAll] = useState(false);
  const info = (key: string) => SETTING_INFO.find((s) => s.key === key)!;
  const keyRows = KEY_ROWS.map((keys) => {
    const items = keys.map(info);
    const label = items.length > 1 ? `${items[0].label} · ${items[1].label.replace(/^Small Business Relief: /, '')}` : items[0].label;
    const refs = [...new Set(items.map((s) => s.reference))];
    return { key: keys.join('+'), label, value: items.map(show).join(' · '), reference: refs.join('; ') };
  });

  return (
    <Section
      id="settings"
      step="10"
      title="Settings"
      badge={<Pill kind="neutral">read-only</Pill>}
      intro={
        <>
          Every rate, threshold and date the calculator uses, with its legal reference. {SETTINGS_CHECK_NOTE} To change a value, edit <code>src/engine/settings.ts</code> (see the
          README).
        </>
      }
    >
      <div className="table-wrap plain">
        <table className="settings-table" id="settings-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Value</th>
              <th scope="col">Reference</th>
            </tr>
          </thead>
          <tbody>
            {all
              ? SETTING_INFO.map((s) => (
                  <tr key={s.key}>
                    <td>
                      {s.label}
                      <div className="faint small">
                        <code>{s.key}</code>
                      </div>
                    </td>
                    <td className="val">{show(s)}</td>
                    <td className="ref">
                      {s.reference}
                      {s.note && <div className="faint small">{s.note}</div>}
                    </td>
                  </tr>
                ))
              : keyRows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="val">{r.value}</td>
                    <td className="ref">{r.reference}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="link-btn strong" aria-expanded={all} aria-controls="settings-table" onClick={() => setAll((v) => !v)}>
        {all ? 'Show the key settings only' : `Show all ${SETTING_INFO.length} settings`} <span aria-hidden="true">{all ? '↑' : '→'}</span>
      </button>
    </Section>
  );
}
