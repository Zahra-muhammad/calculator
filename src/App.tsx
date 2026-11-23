import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accounts } from './components/Accounts';
import { ClientsPanel } from './components/Clients';
import { Computation } from './components/Computation';
import { Deadlines } from './components/Deadlines';
import { Flags } from './components/Flags';
import { GlSuggestions } from './components/GlSuggestions';
import { Header } from './components/Header';
import { Headline } from './components/Headline';
import { Profile, type Update } from './components/Profile';
import { SettingsView } from './components/SettingsView';
import { Upload } from './components/Upload';
import { Vat } from './components/Vat';
import { saveFile } from './download';
import { openQuestions } from './engine/classify';
import { extractFromDocument, extractFromGrids, parseFile, RefusedFileError, type Grid } from './engine/parse';
import type { FileKind, ParsedFile, Workspace } from './engine/types';
import { todayIso } from './engine/util';
import type { CurrencyChoice } from './engine/currency';
import { applyParsedFiles, emptyWorkspace, evaluate, glFromFiles } from './engine/workspace';
import { deleteClient, duplicateToNextYear, exportClients, importClients, loadClients, saveClients, upsertClient, type ClientRecord } from './store/clients';


const NAV: [string, string][] = [
  ['upload', 'Upload'],
  ['profile', 'Profile'],
  ['numbers', 'Numbers'],
  ['accounts', 'Accounts'],
  ['ledger', 'Ledger'],
  ['computation', 'Computation'],
  ['vat', 'VAT'],
  ['flags', 'Flags'],
  ['deadlines', 'Deadlines'],
  ['settings', 'Settings'],
];

/** "7 profile answers, 2 account lines and 4 flags" */
function listText(parts: [number, string, string][]): string {
  const items = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '');
}

/** Yellow banner while any question or HIGH/MEDIUM flag is open. */
function NotFinal({ profileNeed, linesNeed, flagsOpen }: { profileNeed: number; linesNeed: number; flagsOpen: number }) {
  const what = listText([
    [profileNeed, 'profile answer', 'profile answers'],
    [linesNeed, 'account line', 'account lines'],
    [flagsOpen, 'flag', 'flags'],
  ]);
  const single = profileNeed + linesNeed + flagsOpen === 1;
  const target = profileNeed ? '#profile' : linesNeed ? '#accounts' : '#flags';
  return (
    <div className="banner">
      <div className="banner-inner" role="status" data-testid="not-final">
        <span>
          <strong>Not final yet.</strong> {what} {single ? 'needs' : 'need'} a person before this figure can be filed.
        </span>
        <a href={target}>
          Review <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}

/** A PDF: its text is read on this computer (pdf.js, loaded only when a PDF is added). */
async function parsePdf(buf: ArrayBuffer, name: string) {
  const { readPdfText } = await import('./engine/pdftext');
  const r = extractFromDocument(await readPdfText(buf), name);
  r.parsed.size = buf.byteLength;
  return r;
}

export default function App() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const grids = useRef(new Map<string, Grid[]>());
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState<ClientRecord[]>(() => loadClients());
  const [showClients, setShowClients] = useState(false);
  const [saved, setSaved] = useState(() => JSON.stringify(emptyWorkspace()));
  const [toast, setToast] = useState<string | null>(null);
  const pendingNew = useRef(0);

  const update: Update = useCallback((fn) => setWs((w) => fn(w)), []);
  const gl = useMemo(() => glFromFiles(files, ws.currency), [files, ws.currency]);
  const ev = useMemo(() => evaluate(ws, gl), [ws, gl]);
  const dirty = useMemo(() => JSON.stringify(ws) !== saved, [ws, saved]);
  const openHighMedium = ev.flags.filter((f) => (f.level === 'HIGH' || f.level === 'MEDIUM') && !ws.resolved[f.key]).length;
  // The profile questions are about corporate tax: they only count once there is a trial balance or profit figure.
  const ctData = ws.tbLines.length > 0 || ws.headline.pbt.value !== undefined;
  const profileNeed = ctData ? ev.fieldSummary.need : 0;
  const linesNeed = useMemo(() => {
    const open = (category: Parameters<typeof openQuestions>[0], key: string, evidence?: string, rp?: string) => openQuestions(category, ws.answers[key], evidence, rp).length > 0;
    return ev.classified.filter((l) => open(l.category, l.key, l.evidence, l.relatedParty) || ev.subLines.some((s) => s.parentKey === l.key && open(s.category, s.key))).length;
  }, [ev.classified, ev.subLines, ws.answers]);
  const hasData = ctData || ev.vat.hasData;
  const notFinal = hasData && (profileNeed > 0 || linesNeed > 0 || openHighMedium > 0);

  // Active tab: the section nearest the top of the screen (a click pins it while the page scrolls there).
  const [active, setActive] = useState('upload');
  const headerRef = useRef<HTMLElement>(null);
  const pinnedUntil = useRef(0);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (Date.now() < pinnedUntil.current) return;
        const header = headerRef.current;
        const line = (header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0) + 24;
        let best: { id: string; top: number } | undefined;
        for (const [id] of NAV) {
          const top = document.getElementById(id)?.getBoundingClientRect().top;
          if (top === undefined || top > line) continue;
          if (!best || top > best.top + 1) best = { id, top };
        }
        setActive(best?.id ?? NAV[0][0]);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Light theme only. Clear any dark choice remembered by an older version.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      localStorage.removeItem('uae-ct-calculator:theme');
    } catch {
      /* storage blocked */
    }
  }, []);

  // Toasts disappear after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Warn before closing with unsaved work.
  useEffect(() => {
    const hasWork = dirty && (ws.tbLines.length > 0 || !!ws.clientName || (ws.salesInvoices?.length ?? 0) > 0 || (ws.purchaseInvoices?.length ?? 0) > 0 || (ws.importInvoices?.length ?? 0) > 0);
    if (!hasWork) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty, ws.tbLines.length, ws.clientName, ws.salesInvoices, ws.purchaseInvoices, ws.importInvoices]);

  // ───────── Files ─────────

  const addFiles = async (list: File[]) => {
    setBusy(true);
    const added: ParsedFile[] = [];
    const failed: string[] = [];
    const refused: string[] = [];
    for (const f of list) {
      try {
        const buf = await f.arrayBuffer();
        const { parsed, grids: g } = /\.pdf$/i.test(f.name) ? await parsePdf(buf, f.name) : parseFile(buf, f.name);
        grids.current.set(parsed.id, g);
        added.push(parsed);
      } catch (e) {
        if (e instanceof RefusedFileError) refused.push(`${f.name}: ${e.message}`);
        else failed.push(f.name);
      }
    }
    const all = [...files, ...added];
    setFiles(all);
    setWs((w) => applyParsedFiles(w, all, 'merge'));
    setBusy(false);
    const messages = [
      ...refused,
      ...(failed.length ? [`Could not read: ${failed.join(', ')}. Is it an Excel or CSV file?`] : []),
      ...(added.length || (!refused.length && !failed.length) ? [`Read ${added.length} file${added.length === 1 ? '' : 's'}.`] : []),
    ];
    setToast(messages.join(' '));
  };

  const changeKind = (id: string, kind: FileKind) => {
    const old = files.find((f) => f.id === id);
    const g = grids.current.get(id);
    if (!old || !g) return;
    let next: ParsedFile;
    // "VAT" uses the VAT parts already read from the file; nothing needs to be read again.
    if (kind === 'ignore' || (kind === 'vatdata' && old.detected !== 'unknown')) next = { ...old, kind };
    else {
      const fresh = extractFromGrids(g, old.name, kind === old.detected ? undefined : kind);
      // Keep the sheet roles from detection: they say what the file holds, whatever type is chosen.
      next = { ...fresh, id: old.id, size: old.size, detected: old.detected, sheets: old.sheets ?? fresh.sheets, kind };
    }
    const all = files.map((f) => (f.id === id ? next : f));
    setFiles(all);
    setWs((w) => applyParsedFiles(w, all, 'replace'));
  };

  /** Currency of the amounts, and AED per 1 unit: everything is converted again from the original files. */
  const changeCurrency = (c: CurrencyChoice) => setWs((w) => applyParsedFiles({ ...w, currency: { ...c, byUser: true } }, files, 'replace'));

  const removeFile = (id: string) => {
    const all = files.filter((f) => f.id !== id);
    grids.current.delete(id);
    setFiles(all);
    setWs((w) => applyParsedFiles(w, all, 'replace'));
  };

  // ───────── Clients ─────────

  const persist = (list: ClientRecord[], okMessage: string) => {
    if (saveClients(list)) {
      setClients(list);
      setToast(okMessage);
      return true;
    }
    setToast('Could not save in this browser (storage is blocked or full). Use Clients → Export all for a backup.');
    return false;
  };

  const saveClient = () => {
    if (!ws.clientName.trim()) {
      setToast('Enter a client name in the Company profile first.');
      document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const { list, record } = upsertClient(clients, ws);
    const next = { ...ws, clientId: record.id };
    if (persist(list, `Saved ${record.name}.`)) {
      setWs(next);
      setSaved(JSON.stringify(next));
    }
  };

  const openClient = (c: ClientRecord) => {
    setWs(c.workspace);
    setSaved(JSON.stringify(c.workspace));
    setFiles([]);
    grids.current.clear();
    setShowClients(false);
    setToast(`Opened ${c.name}. Uploaded files are not stored: upload the ledger again if you need the GL scan.`);
  };

  const duplicate = (c: ClientRecord) => {
    const next = duplicateToNextYear(c);
    setWs(next);
    setSaved('');
    setFiles([]);
    grids.current.clear();
    setShowClients(false);
    setToast(`Started next year for ${c.name}. Last year's categories and answers are shown as suggestions.`);
  };

  const newClient = () => {
    if (dirty && Date.now() - pendingNew.current > 6000) {
      pendingNew.current = Date.now();
      setToast('You have unsaved changes. Click "New client" again to discard them.');
      return;
    }
    pendingNew.current = 0;
    const fresh = emptyWorkspace();
    setWs(fresh);
    setSaved(JSON.stringify(fresh));
    setFiles([]);
    grids.current.clear();
    setShowClients(false);
  };

  const removeClient = (id: string) => {
    const name = clients.find((c) => c.id === id)?.name ?? 'Client';
    if (persist(deleteClient(clients, id), `Deleted ${name}.`) && ws.clientId === id) {
      setWs((w) => ({ ...w, clientId: undefined }));
    }
  };

  const exportAll = async () => setToast(await saveFile(`ct-clients-backup-${todayIso()}.json`, exportClients(clients), 'application/json'));

  const importAll = async (file: File) => {
    try {
      const res = importClients(clients, await file.text());
      persist(res.list, `Imported: ${res.added} new, ${res.updated} updated.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not read that backup file.');
    }
  };

  // ───────── Exports ─────────

  /** Exports need something to export: a trial balance, a profit figure or VAT registers. */
  const nothingToExport = () => {
    if (ws.tbLines.length || ws.headline.pbt.value !== undefined || ev.vat.hasData) return false;
    setToast('Nothing to export yet. Upload a trial balance, financial statements or VAT registers first.');
    return true;
  };

  const exportExcel = async () => {
    if (nothingToExport()) return;
    try {
      const { workingPaper, exportFileName } = await import('./engine/export');
      setToast(await saveFile(exportFileName(ws, 'xlsx'), workingPaper(ws, ev), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    } catch {
      setToast('Could not create the Excel file.');
    }
  };

  const exportPdf = async () => {
    if (nothingToExport()) return;
    try {
      const [{ clientReport }, { exportFileName }] = await Promise.all([import('./engine/pdf'), import('./engine/export')]);
      setToast(await saveFile(exportFileName(ws, 'pdf'), clientReport(ws, ev), 'application/pdf'));
    } catch {
      setToast('Could not create the PDF.');
    }
  };

  const resolveFlag = (key: string, note: string | null) =>
    update((w) => {
      const resolved = { ...w.resolved };
      if (note === null) delete resolved[key];
      else resolved[key] = { note, at: new Date().toISOString() };
      return { ...w, resolved };
    });

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header" ref={headerRef}>
        <Header
          ws={ws}
          ev={ev}
          dirty={dirty}
          onSave={saveClient}
          onClients={() => setShowClients(true)}
          onExcel={exportExcel}
          onPdf={exportPdf}
        />
        <nav className="nav" aria-label="Sections">
          <div className="nav-inner">
            {NAV.map(([id, label]) => {
              const count = id === 'profile' ? profileNeed : id === 'flags' ? openHighMedium : 0;
              const what = id === 'profile' ? 'unanswered' : 'open HIGH and MEDIUM flags';
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  className={active === id ? 'active' : undefined}
                  aria-current={active === id ? 'location' : undefined}
                  onClick={() => {
                    pinnedUntil.current = Date.now() + 900;
                    setActive(id);
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span className="tab-badge">
                      {count}
                      <span className="visually-hidden"> {what}</span>
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </nav>
      </header>
      {notFinal && <NotFinal profileNeed={profileNeed} linesNeed={linesNeed} flagsOpen={openHighMedium} />}
      <main id="main" tabIndex={-1}>
        <Upload files={files} busy={busy} onAdd={addFiles} onKind={changeKind} onRemove={removeFile} currency={ws.currency} onCurrency={changeCurrency} />
        <Profile ws={ws} ev={ev} update={update} />
        <Headline ws={ws} ev={ev} update={update} onReset={(k) => setWs((w) => applyParsedFiles({ ...w, headline: { ...w.headline, [k]: {} } }, files, 'merge'))} />
        <Accounts ws={ws} ev={ev} update={update} />
        <div className="pair">
          <GlSuggestions ws={ws} suggestions={ev.glSuggestions} hasGl={gl.length > 0} glCount={gl.length} update={update} />
          <Deadlines ws={ws} ev={ev} update={update} />
        </div>
        <Computation ev={ev} />
        <Vat ws={ws} ev={ev} update={update} />
        <Flags flags={ev.flags} resolved={ws.resolved} onResolve={resolveFlag} />
        <SettingsView />
        <p className="footer-note">
          Privacy: everything runs in this browser. Files are read on this computer and never sent anywhere. Saved clients stay in this browser until you delete them.
        </p>
      </main>
      {showClients && (
        <ClientsPanel
          clients={clients}
          currentId={ws.clientId}
          onClose={() => setShowClients(false)}
          onOpen={openClient}
          onDuplicate={duplicate}
          onDelete={removeClient}
          onNew={newClient}
          onExport={exportAll}
          onImport={importAll}
        />
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}
