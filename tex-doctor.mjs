#!/usr/bin/env node

/**
 * tex-doctor.mjs — AI-friendly diagnostic & auto-repair advisor for XeLaTeX resumes.
 *
 * Usage:
 *   node tex-doctor.mjs <input.tex> [--json]
 *
 * Returns (--json):
 *   { file, xelatexInstalled, xelatexPath, issues[], recipes[], status?, message? }
 *
 * Issues types: MISSING_ENGINE | PAGE_SPILL | MARGIN_OVERFLOW | FONT_MISSING
 * Status: PERFECT_FIT when pageCount === 1 and overflowCount === 0
 */

import { readFile } from 'fs/promises';                           // ✅ promise-based
import { existsSync } from 'fs';                                   // ✅ sync-only ops
import { resolve, dirname, basename, join } from 'path';
import { pathToFileURL } from 'url';                               // ✅ static import, not dynamic
import { compileXelatex, parseLatexLog, findXelatexPath } from './generate-xelatex-pdf.mjs';

/**
 * Analyze a .tex file and generate actionable repair recipes for layout/compile issues.
 * @param {string} inputTexPath
 * @returns {Promise<object>}
 */
export async function analyzeAndAdvise(inputTexPath) {
  const absTex = resolve(inputTexPath);
  if (!existsSync(absTex)) {
    return { error: `File not found: ${absTex}` };
  }

  const xelatexBin = findXelatexPath();

  const report = {
    file: basename(absTex),
    xelatexInstalled: !!xelatexBin,
    xelatexPath: xelatexBin,
    issues: [],
    recipes: [],
  };

  if (!xelatexBin) {
    report.issues.push({
      type: 'MISSING_ENGINE',
      severity: 'HIGH',
      message: 'XeLaTeX executable is not installed or not on system PATH.',
    });
    report.recipes.push({
      title: 'Install MiKTeX on Windows',
      command: 'winget install MiKTeX.MiKTeX',
      fallback: 'Upload generated .tex file to Overleaf.com and compile with XeLaTeX engine.',
    });
    return report;
  }

  // Compile with keepAux to retain .log for analysis
  const compileResult = await compileXelatex(absTex, null, { keepAux: true });
  report.compileResult = compileResult;

  const texDir = dirname(absTex);
  const texBase = basename(absTex, '.tex');
  const logPath = join(texDir, `${texBase}.log`);

  let logData = { errors: [], warnings: [], overflows: [], gaps: [], fontWarnings: [], pageCount: 1 };
  if (existsSync(logPath)) {
    try {
      const logContent = await readFile(logPath, 'utf-8');         // ✅ clean async read
      logData = parseLatexLog(logContent);
    } catch { /* log unreadable — proceed with defaults */ }
  }

  // 1. Multi-page spill issue (Page count > 1)
  if (compileResult.pageCount > 1) {
    report.issues.push({
      type: 'PAGE_SPILL',
      severity: 'HIGH',
      pageCount: compileResult.pageCount,
      message: `Resume spilled onto page ${compileResult.pageCount}! Target is strictly 1 page.`,
    });

    report.recipes.push({
      title: 'Fix Page Spill (Reduce vertical height)',
      steps: [
        {
          action: 'Reduce line spacing in preamble',
          target: '\\linespread{0.94}',
          replacement: '\\linespread{0.90} % or 0.88',
          explanation: 'Reduces line height across entire document by 4-6%.',
        },
        {
          action: 'Tighten section spacing',
          target: '\\titlespacing{\\section}{0pt}{2pt}{2pt}',
          replacement: '\\titlespacing{\\section}{0pt}{1pt}{1pt}',
          explanation: 'Reduces vertical padding around navy section dividers.',
        },
        {
          action: 'Reduce top/bottom page margins',
          target: 'top=0.3in,bottom=0.3in',
          replacement: 'top=0.25in,bottom=0.25in',
          explanation: 'Gains ~0.1in (7pt) of vertical space at header and footer.',
        },
        {
          action: 'Shorten multi-line bullets',
          explanation: 'Identify bullets wrapping to a 2nd or 3rd line with 1-3 trailing words and trim them.',
        },
      ],
    });
  }

  // 2. Horizontal Margin Overflow (Overfull \hbox)
  if (logData.overflows.length > 0) {
    report.issues.push({
      type: 'MARGIN_OVERFLOW',
      severity: 'MEDIUM',
      count: logData.overflows.length,
      overflows: logData.overflows,
      message: `${logData.overflows.length} text block(s) exceed horizontal page margins.`,
    });

    report.recipes.push({
      title: 'Fix Horizontal Margin Overflow',
      steps: [
        {
          action: 'Wrap inline URLs in \\href or break long text',
          explanation: 'Long URLs or un-hyphenated technology strings exceeding line width should be split or shortened.',
        },
        {
          action: 'Check skill category lines',
          explanation: 'If \\textbf{Backend:} has too many items on one line, split into two lines or shorten item titles.',
        },
      ],
    });
  }

  // 3. Font Missing Error
  if (logData.fontWarnings.length > 0 || (compileResult.compileError?.includes('font'))) {
    let currentFont = 'Carlito';
    try {
      const fontMatch = (await readFile(absTex, 'utf-8')).match(/\\setmainfont\{([^}]+)\}/);
      if (fontMatch) currentFont = fontMatch[1];
    } catch { /* ignore */ }

    report.issues.push({
      type: 'FONT_MISSING',
      severity: 'HIGH',
      fontWarnings: logData.fontWarnings,
      message: `Fontspec failed to locate the main font (${currentFont}).`,
    });

    report.recipes.push({
      title: 'Fix Missing Font (Fallback to Arial or Liberation Sans)',
      steps: [
        {
          action: 'Replace main font setting in preamble',
          target: `\\setmainfont{${currentFont}}`,
          replacement: '\\setmainfont{Arial} % or \\setmainfont{Liberation Sans}',
          explanation: `${currentFont} was not found by XeLaTeX. Arial is universally present on all systems.`,
        },
      ],
    });
  }

  // 4. Perfect Fit Confirmation
  if (compileResult.success && compileResult.pageCount === 1 && logData.overflows.length === 0) {
    report.status = 'PERFECT_FIT';
    report.message = '🎉 Resume compiled to a perfect 1-page layout with zero errors or overflows!';
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const positional = args.filter(a => !a.startsWith('--'));

  const inputTex = positional[0];
  if (!inputTex) {
    console.error('Usage: node tex-doctor.mjs <input.tex> [--json]');
    process.exit(1);
  }

  const report = await analyzeAndAdvise(inputTex);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.status === 'PERFECT_FIT' ? 0 : 1);
  }

  console.log(`\n==================================================`);
  console.log(`🩺 XeLaTeX Resume Diagnostic Report: ${report.file}`);
  console.log(`==================================================\n`);

  if (report.status === 'PERFECT_FIT') {
    console.log(report.message);
    console.log(`PDF Path: ${report.compileResult.pdfPath}`);
    console.log(`PDF Size: ${report.compileResult.sizeKB} KB\n`);
    process.exit(0);
  }

  if (report.issues.length === 0) {
    console.log('✅ No layout or compilation issues detected.');
    process.exit(0);
  }

  console.log(`Found ${report.issues.length} issue(s):\n`);
  for (const [idx, iss] of report.issues.entries()) {
    console.log(`[${idx + 1}] Severity: ${iss.severity} | Type: ${iss.type}`);
    console.log(`    ${iss.message}\n`);
  }

  if (report.recipes.length > 0) {
    console.log(`\n🛠️  AUTOMATED REPAIR RECIPES (For AI / Developer Use):\n`);
    for (const [idx, rec] of report.recipes.entries()) {
      console.log(`--- Recipe ${idx + 1}: ${rec.title} ---`);
      if (rec.command) console.log(`Command: ${rec.command}`);
      if (rec.steps) {
        for (const st of rec.steps) {
          console.log(`  • ${st.action}`);
          if (st.target)      console.log(`    Replace: ${st.target}`);
          if (st.replacement) console.log(`    With:    ${st.replacement}`);
          console.log(`    Why:     ${st.explanation}`);
        }
      }
      console.log('');
    }
  }
  process.exit(report.status === 'PERFECT_FIT' ? 0 : 1);
}

// ✅ Correct ES module main-detection: static pathToFileURL import, no top-level await
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
