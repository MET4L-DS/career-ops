#!/usr/bin/env node

/**
 * generate-xelatex-pdf.mjs — XeLaTeX PDF compiler & diagnostic harness for career-ops resumes.
 *
 * Usage:
 *   node generate-xelatex-pdf.mjs <input.tex> [output.pdf] [--keep-aux] [--json]
 */

import { readFile, writeFile, rm, stat } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

/**
 * Locate xelatex executable on PATH or common installation paths.
 * @returns {string|null}
 */
export function findXelatexPath() {
  // Check system PATH first
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(cmd, ['xelatex'], { stdio: 'pipe', encoding: 'utf-8' });
    const firstLine = out.trim().split(/\r?\n/)[0];
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch { /* not on PATH */ }

  // Check standard MiKTeX paths on Windows
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX 2.9', 'miktex', 'bin', 'x64', 'xelatex.exe'),
      join(process.env.APPDATA || '', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'),
    ];
    for (const cand of candidates) {
      if (cand && existsSync(cand)) return cand;
    }
  }

  return null;
}

/**
 * Parse a LaTeX compilation .log file for diagnostics.
 * @param {string} logContent
 * @returns {object}
 */
export function parseLatexLog(logContent) {
  const errors = [];
  const warnings = [];
  const overflows = []; // Overfull hboxes
  const gaps = []; // Underfull vboxes / hboxes
  let pageCount = null;
  let fontWarnings = [];

  const lines = logContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for LaTeX errors (! Error)
    if (line.startsWith('! ')) {
      let errText = line.slice(2);
      let context = [];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (lines[j].startsWith('l.')) {
          context.push(lines[j]);
          break;
        }
        if (lines[j].trim() === '') break;
        context.push(lines[j]);
      }
      errors.push({ error: errText, context: context.join('\n') });
    }

    // Check for Overfull \hbox (Overflow)
    if (line.includes('Overfull \\hbox')) {
      const match = line.match(/Overfull \\hbox \(([^)]+)\) in paragraph at lines (\d+)--(\d+)/) ||
                    line.match(/Overfull \\hbox \(([^)]+)\) at line (\d+)/);
      if (match) {
        overflows.push({
          ptExcess: match[1],
          startLine: parseInt(match[2] || match[1], 10),
          endLine: parseInt(match[3] || match[2] || match[1], 10),
          raw: line,
        });
      } else {
        overflows.push({ raw: line });
      }
    }

    // Check for Underfull \vbox (Large vertical gaps)
    if (line.includes('Underfull \\vbox')) {
      const match = line.match(/Underfull \\vbox \(([^)]+)\) has occurred while \\output is active/);
      gaps.push({
        type: 'vbox',
        badness: match ? match[1] : 'unknown',
        raw: line,
      });
    }

    // Check for fontspec missing font warnings
    if (line.includes('fontspec error') || (line.includes('Font') && line.includes('not found'))) {
      fontWarnings.push(line);
    }

    // Check page count output ("Output written on file.pdf (1 page, ...)")
    const pageMatch = line.match(/Output written on .*?\b\((\d+)\s+pages?/);
    if (pageMatch) {
      pageCount = parseInt(pageMatch[1], 10);
    }
  }

  return {
    errors,
    warnings,
    overflows,
    gaps,
    fontWarnings,
    pageCount: pageCount !== null ? pageCount : 1,
  };
}

/**
 * Compile a .tex file using xelatex and generate diagnostic report.
 * @param {string} inputTexPath
 * @param {string|null} outputPdfPath
 * @param {object} opts
 */
export async function compileXelatex(inputTexPath, outputPdfPath = null, opts = {}) {
  const absTex = resolve(inputTexPath);
  if (!existsSync(absTex)) {
    return { success: false, error: `Input file not found: ${absTex}` };
  }

  const xelatexBin = findXelatexPath();
  if (!xelatexBin) {
    return {
      success: false,
      error: 'XeLaTeX executable not found. Please install MiKTeX (winget install MiKTeX.MiKTeX) or add xelatex to system PATH.',
      hint: 'You can still use Overleaf to compile the generated .tex resume.',
    };
  }

  const texDir = dirname(absTex);
  const texBase = basename(absTex, '.tex');
  const targetPdf = outputPdfPath ? resolve(outputPdfPath) : join(texDir, `${texBase}.pdf`);

  // Run xelatex twice to resolve references and layout properly
  const args = [
    '-interaction=nonstopmode',
    '-halt-on-error',
    `-output-directory=${texDir}`,
    absTex,
  ];

  let compileError = null;
  try {
    execFileSync(xelatexBin, args, { cwd: texDir, stdio: 'pipe', timeout: 120000 });
    // Second pass for layout stability
    execFileSync(xelatexBin, args, { cwd: texDir, stdio: 'pipe', timeout: 120000 });
  } catch (err) {
    compileError = err.message;
  }

  const logPath = join(texDir, `${texBase}.log`);
  let logDiagnostics = { errors: [], warnings: [], overflows: [], gaps: [], fontWarnings: [], pageCount: 1 };

  if (existsSync(logPath)) {
    try {
      const logContent = await readFile(logPath, 'utf-8');
      logDiagnostics = parseLatexLog(logContent);
    } catch { /* log unreadable */ }
  }

  const defaultPdfPath = join(texDir, `${texBase}.pdf`);
  const pdfExists = existsSync(defaultPdfPath);

  if (pdfExists && defaultPdfPath !== targetPdf) {
    const targetDir = dirname(targetPdf);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    await writeFile(targetPdf, await readFile(defaultPdfPath));
  }

  let pdfSizeKB = 0;
  if (existsSync(targetPdf)) {
    const pdfStat = await stat(targetPdf);
    pdfSizeKB = parseFloat((pdfStat.size / 1024).toFixed(1));
  }

  // Cleanup auxiliary files unless --keep-aux is set
  if (!opts.keepAux) {
    const auxExts = ['.aux', '.log', '.out', '.fls', '.fdb_latexmk', '.synctex.gz'];
    for (const ext of auxExts) {
      const auxFile = join(texDir, `${texBase}${ext}`);
      if (existsSync(auxFile)) await rm(auxFile).catch(() => {});
    }
  }

  const success = pdfExists && logDiagnostics.errors.length === 0;

  return {
    success,
    pdfPath: success ? targetPdf : null,
    sizeKB: pdfSizeKB,
    pageCount: logDiagnostics.pageCount,
    isOnePage: logDiagnostics.pageCount === 1,
    overflowCount: logDiagnostics.overflows.length,
    gapCount: logDiagnostics.gaps.length,
    diagnostics: logDiagnostics,
    compileError,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const keepAux = args.includes('--keep-aux');
  const positional = args.filter(a => !a.startsWith('--'));

  const inputTex = positional[0];
  const outputPdf = positional[1];

  if (!inputTex) {
    console.error('Usage: node generate-xelatex-pdf.mjs <input.tex> [output.pdf] [--keep-aux] [--json]');
    process.exit(1);
  }

  const result = await compileXelatex(inputTex, outputPdf, { keepAux });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }

  if (result.success) {
    console.log(`✅ PDF generated successfully: ${result.pdfPath}`);
    console.log(`📄 Pages: ${result.pageCount} ${result.isOnePage ? '(Perfect 1-page fit!)' : '⚠️ WARNING: Exceeds 1 page target!'}`);
    console.log(`📦 Size: ${result.sizeKB} KB`);
    if (result.overflowCount > 0) {
      console.log(`⚠️ Overflows detected: ${result.overflowCount} lines exceed margin. Run 'node tex-doctor.mjs ${inputTex}' for fixes.`);
    }
    if (result.gapCount > 0) {
      console.log(`ℹ️ Gaps detected: ${result.gapCount} underfull blocks.`);
    }
  } else {
    console.error(`❌ PDF compilation failed: ${result.error || result.compileError}`);
    if (result.diagnostics.errors.length > 0) {
      console.error('LaTeX Errors:');
      result.diagnostics.errors.forEach(e => console.error(`  ! ${e.error}\n${e.context}`));
    }
    console.error(`Run 'node tex-doctor.mjs ${inputTex}' for automated repair recommendations.`);
  }

  process.exit(result.success ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
