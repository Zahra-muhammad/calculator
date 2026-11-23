/**
 * Text of a PDF (auditor's report, director's confirmation, notes), read on this computer with pdf.js.
 * Returns paragraphs per page: lines that wrap are joined; a blank gap or a short "Label: answer"
 * line starts a new paragraph. Scanned PDFs have no text, so they return no paragraphs.
 */

export interface PdfPage {
  page: number;
  paragraphs: string[];
}

type TextItem = { str: string; hasEOL?: boolean; transform: number[]; height?: number };

let loading: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;

/** pdf.js, with its worker code run on the page itself (the app is one offline file, so there is no worker file). */
async function pdfjs() {
  loading ??= (async () => {
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return loading;
}

export async function readPdfText(data: ArrayBuffer | Uint8Array): Promise<PdfPage[]> {
  const lib = await pdfjs();
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data.slice(0));
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0, disableFontFace: true }).promise;
  const pages: PdfPage[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 50); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ page: n, paragraphs: paragraphsOf(content.items as TextItem[]) });
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/** Lines → paragraphs. Exported for tests. */
export function paragraphsOf(items: TextItem[]): string[] {
  // 1. Lines: items share a baseline (y); hasEOL ends a line.
  const lines: { text: string; y: number; h: number }[] = [];
  let cur = '';
  let y: number | undefined;
  let h = 10;
  const flush = () => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t) lines.push({ text: t, y: y ?? 0, h });
    cur = '';
    y = undefined;
  };
  for (const it of items) {
    const iy = it.transform?.[5] ?? 0;
    if (y !== undefined && Math.abs(iy - y) > 2 && it.str.trim()) flush();
    if (it.str) {
      if (y === undefined) y = iy;
      h = Math.max(4, Math.abs(it.height ?? it.transform?.[3] ?? h));
      cur += it.str;
    }
    if (it.hasEOL) flush();
  }
  flush();
  // 2. Paragraphs. A line that wraps reaches (nearly) the right margin and the next line follows at the
  // usual line gap. A short line, a bigger gap, or a "Label: answer" line ends the paragraph.
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0.5);
  const lineGap = gaps.length ? Math.min(...gaps) : 12;
  const longest = Math.max(1, ...lines.map((l) => l.text.length));
  const out: string[] = [];
  let para: string[] = [];
  const end = () => {
    if (para.length) out.push(para.join(' ').replace(/\s+/g, ' ').trim());
    para = [];
  };
  const LABEL_LINE = /^[^:.]{2,60}:\s*\S/;
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = prev ? prev.y - l.y : 0;
    if (prev && (gap > lineGap * 1.3 || gap < -0.5)) end();
    if (LABEL_LINE.test(l.text)) {
      end();
      out.push(l.text);
      return;
    }
    para.push(l.text);
    if (l.text.length < (longest * 3) / 4) end();
  });
  end();
  return out;
}
