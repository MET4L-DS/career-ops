# Mode: latex-tex — Tailor a user-owned LaTeX CV in place

Opt-in mode for candidates who already maintain a hand-tuned `.tex` CV. **Does not change the global source of truth** — `cv.md` remains the default for evaluations, apply mode, and auto-pipeline. Invoke explicitly via `/career-ops latex-tex`.

## When to use

- User has `resume.tex` (or `config/profile.yml → latex.source`) in a supported layout
- User wants JD-tailored bullets/skills while keeping their preamble, macros, colors, and spacing

## Supported layouts (v2)

| Family | Detection | Editable prose |
|--------|-----------|----------------|
| `xelatex-custom-macros` | `\newcommand{\role}` + `\newcommand{\subline}` in preamble | `summary-0` (paragraph after `\section*{Professional Summary}`), `skill-N` (value of each `\textbf{Cat:} \ VALUE\par` line), `bullet-N` (`\item` text in all `itemize` blocks) |
| `resumeSubheading` | `\resumeSubheading` + `\resumeItem`/`\resumeItemWithoutTitle`/`\resumeSubItem` | `\resumeItem{...}` bullets; `\textbf{Category}{: items}` and `\resumeSubItem{Category}{items}` skill values |
| `tabularx-itemize` | `tabularx` + `itemize`, no resume macros | `\item` body text in the document body |

**`xelatex-custom-macros` is the user's primary family** — it covers their Obsidian XeLaTeX resumes (`resume-full-stack-2.tex`, `resume-backend.tex`) with Carlito font, navy headings, and custom `\role`/`\subline`/`\linkline` macros. Source paths are configured in `config/profile.yml → latex.source` / `latex.backend_source`.

Extraction only reads the document body (preamble macro definitions are skipped) and ignores commented-out macro calls — old bullets kept as `%` comments never become editable slots.

Any other layout → stop with the script error and suggest `/career-ops latex` (cv.md → career-ops template).

## Source file resolution

1. Check `config/profile.yml → latex:` block:
   - Backend Developer roles → `latex.backend_source`
   - All other roles (Full-Stack, AI, Forward Deployed) → `latex.source`
2. Else `resume.tex` in project root
3. Else `cv.tex` in project root

If none exist, stop and ask the user to add their `.tex` file or set `latex.source`.

```yaml
# config/profile.yml (user layer — already configured)
latex:
  source: "D:/Obsidian D/Interview/resumes/resume-full-stack-2.tex"
  backend_source: "D:/Obsidian D/Interview/resumes/resume-backend.tex"
  sync_dir: "D:/Obsidian D/Interview/resumes"
  compiler: xelatex
  pdf_in_overleaf: true
  output_dir: output/
```

## Pipeline

1. Resolve source `.tex` path per archetype (Backend → `latex.backend_source`; all others → `latex.source`)
2. Run: `node extract-latex-content.mjs <source.tex>`
3. If `supported: false` → show `error` + `hint`; do not proceed
4. If `family` is `xelatex-custom-macros`, tailorable slots are: `summary-0`, `skill-0..N`, `bullet-0..N`
5. Read JD (from context, report, or ask user)
6. Tailor **only** the `slots[].text` values for JD fit (same ethics as `modes/latex.md` / `pdf`):
   - Extract 15–20 JD keywords
   - Reorder bullets by relevance (patch id order determines output order)
   - Inject keywords into existing achievements — **NEVER invent skills or authorship**
   - Cross-check all claims against `cv.md` and source `.tex`; omit anything not backed by in-scope sources
7. Write patches file (include `slots` array from extract manifest):

```json
{
  "slots": [ "...copy full slots array from extract-latex-content.mjs output..." ],
  "patches": [
    { "id": "summary-0", "text": "Tailored summary paragraph — no LaTeX escaping needed, script handles it" },
    { "id": "skill-2", "text": "Reordered/reworded skill items for JD" },
    { "id": "bullet-0", "text": "Tailored bullet text" }
  ]
}
```

8. Run: `node patch-latex-content.mjs <source.tex> <patches.json> output/resume-{company-slug}-{YYYY-MM-DD}.tex`
9. Compile to PDF: `node generate-xelatex-pdf.mjs output/resume-{company-slug}-{YYYY-MM-DD}.tex output/resume-{company-slug}-{YYYY-MM-DD}.pdf`
10. If compile fails or page count > 1 or overflow detected, run:
    `node tex-doctor.mjs output/resume-{company-slug}-{YYYY-MM-DD}.tex`
    Follow the returned repair recipe (adjust `\linespread`, `\titlespacing`, or trim trailing words on overflowing bullets) and repeat until `pageCount: 1` and `overflowCount: 0`.
11. Report: family, slot count, patched count, `.tex` path, `.pdf` path (or compile error)

**Requires:** MiKTeX with XeLaTeX (`xelatex` on PATH or in `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64\`). `generate-xelatex-pdf.mjs` auto-discovers the binary. Fallback: compile `.tex` in Overleaf (XeLaTeX engine).

## Ethical rules (mandatory)

Same as `modes/latex.md` and `modes/pdf.md`:

- Keywords get **reformulated, never fabricated**
- Never add tools, skills, or metrics the candidate does not already have in the source `.tex` or `cv.md`
- Preserve inline LaTeX markup inside bullets when possible; when rewriting, output **plain text** in patch JSON (the patch script escapes special characters)
- Do **not** rewrite preamble, macro definitions, section titles, dates, company names, or job titles unless the user explicitly asks

## What this mode does NOT do

- Does not replace `cv.md` as the system source of truth
- Does not parse arbitrary LaTeX templates
- Does not auto-run during auto-pipeline or evaluation
- Does not submit applications

## Relationship to `latex` mode

| Mode | Input | Output |
|------|-------|--------|
| `latex` | `cv.md` | career-ops `templates/cv-template.tex` → `.tex` + PDF |
| `latex-tex` | user's Obsidian `.tex` (primary) | XeLaTeX-native tailored `.tex` + locally compiled PDF via `generate-xelatex-pdf.mjs` |

## Layout Debugging (AI Hand-Holding)

If any layout issue is detected (page > 1, margin overflow, font missing), an AI agent at any capability level MUST run `tex-doctor.mjs` before declaring failure:

```bash
node tex-doctor.mjs output/resume-{company-slug}-{date}.tex
```

The script returns structured JSON (`--json` flag) or human-readable repair recipes including:
- **`PAGE_SPILL`**: Reduce `\linespread`, `\titlespacing`, margins, or trim trailing words from long bullets
- **`MARGIN_OVERFLOW`**: Shorten unhyphenated tech strings or wrap URLs in `\href`
- **`FONT_MISSING`**: Replace `\setmainfont{Carlito}` with `\setmainfont{Arial}` as fallback
