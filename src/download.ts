/**
 * Save a generated file. Inside a claude.ai artifact this uses the `downloads`
 * capability (the viewer confirms each save). Anywhere else it downloads normally.
 * Returns a short message for the status bar.
 */

interface DownloadsNs {
  save(req: { filename: string; data: Blob | ArrayBuffer | ArrayBufferView | string }): Promise<{ status: 'saved' | 'delivered' }>;
}
interface ClaudeWindow {
  claude?: { use?: (name: string) => Promise<unknown> };
}

const MESSAGES: Record<string, string> = {
  declined: 'Download cancelled.',
  rate_limited: 'A download prompt is already open. Wait a moment, then try again.',
  too_large: 'The file is too large to save here.',
  rejected_extension: 'This file type cannot be saved here.',
  extension_not_enabled: 'This file type cannot be saved here.',
};

export async function saveFile(filename: string, data: Uint8Array | string, mime: string): Promise<string> {
  const blob = new Blob([data as BlobPart], { type: mime });
  const w = window as unknown as ClaudeWindow;
  if (w.claude && typeof w.claude.use === 'function') {
    let downloads: DownloadsNs | null = null;
    try {
      downloads = (await w.claude.use('downloads')) as DownloadsNs | null;
    } catch {
      downloads = null;
    }
    if (!downloads) return 'Downloads are not available in this view.';
    try {
      await downloads.save({ filename, data: blob });
      return `Saved ${filename}.`;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? 'unavailable';
      return MESSAGES[code] ?? 'Downloads are not available in this view.';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return `Downloaded ${filename}.`;
}

/** File name safe for Windows and Mac. */
export function safeName(s: string): string {
  return (s || 'client').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'client';
}
