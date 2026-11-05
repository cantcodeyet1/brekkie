// Word to PDF, so the agenda keeps the template's exact layout.
// Uses LibreOffice when it is installed (the usual choice on a server), otherwise Microsoft Word on Windows.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
let queue = Promise.resolve();              // converters are not safe to run in parallel
let cached;                                  // which converter works here

const LIBRE = [process.env.SOFFICE_PATH, 'soffice', 'libreoffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].filter(Boolean);

async function findLibre() {
  for (const bin of LIBRE) { try { await run(bin, ['--version'], { timeout: 15000 }); return bin; } catch { /* try the next */ } }
  return null;
}
async function hasWord() {
  if (process.platform !== 'win32') return false;
  try { await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', "$w = New-Object -ComObject Word.Application; $w.Quit()"], { timeout: 30000 }); return true; } catch { return false; }
}
async function pick() {
  if (cached !== undefined) return cached;
  const libre = await findLibre();
  cached = libre ? { kind: 'libre', bin: libre } : (await hasWord()) ? { kind: 'word' } : null;
  return cached;
}

export const pdfAvailable = async () => !!(await pick());

async function convert(docx) {
  const how = await pick();
  if (!how) throw Object.assign(new Error('PDF export needs LibreOffice or Microsoft Word installed on the server. The Word download still works.'), { status: 501 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brekkie-'));
  const inp = path.join(dir, 'agenda.docx'), out = path.join(dir, 'agenda.pdf');
  try {
    await fs.writeFile(inp, docx);
    if (how.kind === 'libre') {
      await run(how.bin, ['--headless', '--norestore', `-env:UserInstallation=file:///${dir.replace(/\\/g, '/')}/profile`, '--convert-to', 'pdf', '--outdir', dir, inp], { timeout: 90000 });
    } else {
      const ps = '$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0; try { $d = $w.Documents.Open($env:BK_IN, $false, $true); $d.ExportAsFixedFormat($env:BK_OUT, 17); $d.Close(0) } finally { $w.Quit() }';
      await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 90000, env: { ...process.env, BK_IN: inp, BK_OUT: out } });
    }
    return await fs.readFile(out);
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export function docxToPdf(docx) {
  const job = queue.then(() => convert(docx));
  queue = job.catch(() => {});
  return job;
}
