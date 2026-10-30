# Runtime findings (M0)

**Status: not run yet.** The probe is built and tested locally. The claude.ai and API runs are still to do.

The probe is a throwaway skill in [`spikes/runtime-probe/`](../spikes/runtime-probe/). Its script, `scripts/probe.cjs`, runs from inside the skill folder, so it resolves `require('docx')` the same way the real scripts will. It reports:
- Node and ICU;
- the `docx` version and whether `docx/watermarks` exists;
- installed fonts (`fc-list`);
- `soffice` and `pdftoppm`;
- writable output folders;
- a test write of a `.txt` file and a real `.docx`.

It makes no network calls.

## How to run it

```sh
npm run probe:zip      # → dist/runtime-probe/runtime-probe.zip (+ -no-metadata variant)
```

**claude.ai** (Pro/Max, code execution on):
1. Go to Customize → Skills, upload `dist/runtime-probe/runtime-probe.zip`, and turn the skill on.
   - If the upload rejects the frontmatter, upload `runtime-probe-no-metadata.zip` instead and record that **`metadata.version` is not accepted**.
2. In a new chat, send: "Run the runtime probe and reply exactly as its instructions say."
3. Paste the JSON into `docs/runtime/claude-ai.json`, and check whether `runtime-probe.docx` shows up as a downloadable file.
4. Delete the skill afterwards.

**API** (needs `ANTHROPIC_API_KEY` for the workspace evals will use):

```sh
npm run probe:api -- --cleanup     # saves spikes/out/api-probe.json and any returned files
```

Copy `spikes/out/api-probe.json` to `docs/runtime/api.json`.

## Findings

| Question | claude.ai | API container | Decides |
|---|---|---|---|
| Node version | | | `target: ES2022` is safe |
| Full ICU (`Intl` currency and date output correct) | | | Money and date formatting |
| `docx` resolves from the skill folder | | | R1: whether bundling is needed |
| `docx` version | | | The exact devDependency pin (currently 9.15.0, provisional) |
| `docx/watermarks` available (9.8.0+) | | | X11: the `TextWatermark` |
| Fonts: Arial / Times New Roman / Calibri / Cambria / Courier New, or metric-compatible substitutes (Liberation, Carlito, Caladea) | | | The font allowlist (NFR-8) |
| Gelasio present (stands in for Georgia) | | | Georgia stays or goes |
| `soffice`, `pdftoppm` | | | `render.cjs` after v1 |
| Writable outputs folder | | | The delivery path in `SKILL.md` |
| A `.docx` written there comes back as a file | | | Delivery, and harness downloads |
| `metadata.version` frontmatter accepted | | n/a | Where packaging stamps the version |

## Local baseline (2026-10-30, macOS)

To check that the probe itself works, from the repo checkout:
- Node v22.22.3, full ICU (78.2).
- `docx` 9.15.0 resolved from the skill folder, and `docx/watermarks` is present.
- A `.docx` was written successfully.
- **Visual checks:** LibreOffice 26.8.2.2 and poppler's pdftoppm (version 26.10.0) were installed on 2026-10-30, with Homebrew. They are the same tools the claude.ai sandbox uses. `npm run preview` builds the example proposals and renders every page to `dist/preview/`.
- **First `soffice` run:** the very first `soffice --headless` run only initializes its profile and converts nothing, so `render.cjs` should allow for that.
- **Fonts:** confirmed with `pdffonts` on the rendered PDFs. This machine's LibreOffice substitutes Carlito for Calibri, Caladea for Cambria and Liberation Sans for Arial: the metric-compatible replacements the font allowlist relies on.
