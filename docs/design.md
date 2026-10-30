# Design: `sales-proposal-builder`

Written 2026-10-30. This design implements [`requirements.md`](requirements.md). It assumes the recommended answers to the open questions in requirements section 10:
- **Ship bar:** every code-checked behavior passes on Sonnet and Opus, and the skill beats the baseline on every scenario.
- **Repo:** public.
- **Eval budget:** required on every run.
- **Out-of-catalog items:** listed in both the chat note and the document.

**Facts checked for this design (2026-10-30):**
- Skills API: [Skills guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide).
  - Uploads must be under 30 MB uncompressed.
  - A request names a skill with `type: "custom"` and a version ID.
  - A container is reused across turns by its `id`.
  - Created files come back as `file_id` values inside `bash_code_execution_tool_result`.
- `docx` on npm: the latest is 9.15.0. The `docx/watermarks` export (`TextWatermark`) **exists from 9.8.0 on**, and 9.7.x and older don't have it.
- Local Node is 22.22.3, which strips TypeScript types without a flag.

## Contents

1. Architecture overview
2. Key design decisions
3. Repo layout and build
4. Company pack schemas
5. Pricing engine
6. Proposal schema
7. Script interfaces
8. Validation rules
9. Document rendering
10. Skill content
11. Packaging
12. Tests
13. Eval harness
14. CI
15. M0 runtime probe
16. Traceability
17. To verify during implementation

---

## 1. Architecture overview

### Build and distribution

```mermaid
flowchart LR
  subgraph repo[Repo]
    SRC["src/skill/*.cts"] -->|tsc| SCR["skill/sales-proposal-builder/scripts/*.cjs<br/>(committed)"]
    CORE["skill/sales-proposal-builder/<br/>SKILL.md · references/ · company/ (neutral)"]
    PACKS["packs/lumen-ridge-it<br/>packs/ironbark-msp"]
    PKG["tools/package.ts"]
    SCR --> PKG
    CORE --> PKG
    PACKS --> PKG
  end
  PKG --> Z1["dist/lumen-ridge-it/sales-proposal-builder.zip"]
  PKG --> Z2["dist/ironbark-msp/sales-proposal-builder.zip"]
  PKG --> Z3["dist/neutral/sales-proposal-builder.zip"]
  Z1 & Z2 & Z3 -->|personal upload| CAI["claude.ai"]
  Z1 & Z2 & Z3 -->|POST /v1/skills| API["Claude API container"]
  H["evals/harness"] --> API
  H --> R["evals/RESULTS.md"]
```

### Data flow inside one conversation

```mermaid
flowchart LR
  B["Client brief / RFP<br/>(untrusted data)"] --> C((Claude))
  C -->|writes| Q["quote.json<br/>SKUs, quantities, term, extra discount"]
  Q --> P["price.cjs"] --> PR["pricing.json<br/>every number + the quote it came from"]
  C -->|writes prose + pricingRef| PJ["proposal.json<br/>no numbers"]
  PJ & PR --> V["validate.cjs"] -->|errors with hints| C
  PJ & PR --> BD["build-docx.cjs<br/>(re-runs validation)"] --> D["proposal.docx"]
  K[("company pack")] --> P & V & BD
```

### Conversation sequence

```mermaid
sequenceDiagram
  actor S as Salesperson
  participant C as Claude
  participant K as Skill scripts
  S->>C: "Proposal for Acme Logistics, 80 staff, …"
  C->>C: read SKILL.md and company/brand.json
  alt configured is false (neutral zip)
    C->>S: ask company name, primary color, logo, currency
    C->>K: init-pack.cjs ./work/pack --name … --primary …
  end
  C->>S: ask only for missing inputs (never invent)
  C->>K: price.cjs quote.json --out pricing.json
  K-->>C: totals, approval.needed, approver
  C->>K: validate.cjs proposal.json pricing.json
  K-->>C: errors → fix → re-run until ok
  C->>K: build-docx.cjs proposal.json pricing.json out.docx
  C->>S: .docx + assumptions, approval flags, not included
```

## 2. Key design decisions

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| X1 | **`proposal.json` contains no money.** It references the pricing file by hash (`pricingRef`). Prose that needs a figure uses tokens such as `{{pricing.monthlyRecurring}}`, and the build fills them in from `pricing.json` | Enforces D6 in code, not just by instruction. The handover's "pricing is a byte-for-byte copy" check is no longer needed, because there's no copy that could drift | Copying pricing into the proposal and diffing it |
| X2 | **`pricing.json` embeds the quote it was computed from.** Validate and build recompute `price(quote, pack)` and reject any mismatch | Catches a hand-edited pricing file | Trusting the file |
| X3 | **The build re-runs every validation check** and refuses invalid input | Claude can't skip `validate.cjs` and still get a document. `validate.cjs` is just the fast feedback loop | A build that trusts its input |
| X4 | **DRAFT comes from `pricing.approval.needed`.** It's not a field in the proposal | Claude can't forget it or turn it off | A `draft` flag in `proposal.json` |
| X5 | **Approved text is rendered verbatim from the pack:** case studies, terms, catalog `includes`, signatory. Claude writes only the introductions and client-specific notes | Approved wording stays approved (FR-7, FR-8) | Claude paraphrasing pack content |
| X6 | **The approval limit applies only to the discretionary extra discount.** Volume and term discounts are policy, approved in advance by being in `pricing.json` | Matches how CPQ approval rules usually work, and is one simple rule to test (D8) | A limit on the total discount against list price (see open item O1) |
| X7 | **Discounts compound in a fixed order: volume → term → extra.** Each step rounds half-up to the minor unit, using BigInt arithmetic | Exact, has one documented rule, can't overflow | Adding the discounts together, or using floats |
| X8 | **Scripts never read the clock or the network.** Dates come in as inputs | Same input, same output (NFR-2). Also works in the API container (D9) | `new Date()` for the proposal date |
| X9 | **Compiled `.cjs` files are committed to git.** CI fails if they're out of date | Reviewers on GitHub see exactly what Claude runs | Building only at package time |
| X10 | **Tests call the shipped `.cjs` scripts through their command line** | Tests the contract Claude actually uses, and what ships (NFR-6) | Importing the TypeScript source |
| X11 | **DRAFT is a banner in the header on every page plus a callout on the cover.** A `TextWatermark` is added too, but only if M0 finds `docx` 9.8.0 or later in the sandbox | The banner works with every 9.x version, and tests can check it as text | Relying on the watermark only |
| X12 | **A brand given in chat goes through `init-pack.cjs`,** which refuses any output path inside the skill folder | Claude never hand-writes brand JSON, and FR-1 holds structurally | Claude editing `brand.json` itself |
| X13 | **The eval baseline is the same model with code execution, Anthropic's `docx` skill and the pack files attached** | Measures what the skill adds beyond the company data and the ability to make a `.docx` | A bare model with no data. Too easy to beat |
| X14 | **The eval harness sends no refusal `fallbacks`** | A fallback would swap the model under test. Refusals are recorded as their own outcome | The default fallback setting |
| X15 | **Every script prints one JSON result to stdout,** with errors as `{code, path, message, hint}`. Exit codes: 0 ok, 1 fixable input, 2 usage, 3 internal | Claude parses one format and gets fixable messages (FR-16) | Free-text stderr |

**Open item O1, for the user:** under X6, a deal with volume 10% + term 10% + extra 14% passes without approval, even though the effective discount is about 30%. If that's wrong for the demo, add an optional `maxEffectiveDiscountBps` that also triggers approval. That's one more rule and two more tests.

## 3. Repo layout and build

```
sales-proposal-builder/
├── package.json                  "type": "module"; scripts below; devDependencies only
├── tsconfig.json                 test/, tools/, evals/: strict, noEmit, run by Node type stripping
├── tsconfig.skill.json           src/skill/**/*.cts → skill/sales-proposal-builder/scripts/*.cjs
├── src/skill/
│   ├── price.cts  validate.cts  build-docx.cts  init-pack.cts  check-pack.cts
│   └── lib/
│       ├── types.cts             every shared type (imported type-only by tests and the harness)
│       ├── cli.cts               argv parsing, JSON envelope, exit codes, ScriptError
│       ├── pack.cts              load and validate a pack; font allowlist; logo checks
│       ├── money.cts             BigInt basis-point math, half-up rounding, Intl formatting
│       ├── pricing.cts           price(quote, pack), a pure function
│       ├── proposal.cts          proposal schema checks
│       ├── rules.cts             placeholder, raw-amount, percentage and markdown scans
│       ├── markdown.cts          supported markdown subset → blocks (used by validate and build)
│       ├── case-studies.cts      parse case-studies.md
│       ├── image.cts             PNG/JPEG detection and pixel size from header bytes
│       ├── closest.cts           Levenshtein "did you mean"
│       └── docx/                 theme.cts cover.cts sections.cts pricing-table.cts header-footer.cts
├── skill/sales-proposal-builder/
│   ├── SKILL.md
│   ├── references/  proposal-structure.md  writing-guide.md  proposal-schema.md  quoting.md
│   ├── company/     the neutral pack (configured: false)
│   └── scripts/     compiled from src/skill (committed, never edited by hand)
├── packs/lumen-ridge-it/  packs/ironbark-msp/
├── tools/package.ts  tools/lib/zip.ts
├── test/  *.test.ts  fixtures/
├── evals/ scenarios/  briefs/  fixtures/  harness/  runs/  RESULTS.md  MANUAL.md
├── docs/  requirements.md  design.md  runtime.md
├── .github/workflows/ci.yml
└── README.md  CHANGELOG.md  HANDOVER.md
```

### Compiling

`tsconfig.skill.json` settings:
- `module` and `moduleResolution`: `nodenext`;
- `target`: `ES2022`;
- `rootDir`: `src/skill`;
- `outDir`: `skill/sales-proposal-builder/scripts`;
- `strict`;
- `removeComments: false`, `declaration: false`, `sourceMap: false`.

What the output looks like:
- **CommonJS output:** `.cts` files compile to `.cjs`, and `import` becomes `require`. Internal imports are written `./lib/money.cjs`.
- **Readable output:** the output keeps the source's layout and comments, and isn't minified (NFR-5).
- **A header pointing back to the source:** every source file starts with `// Compiled from src/skill/<name>.cts. Edit the source, then run npm run build.` and tsc carries that line into the `.cjs`.

### Tests, tools and the harness

These are `.ts` files that Node 22 runs directly, with `erasableSyntaxOnly` and `allowImportingTsExtensions`. They import types from `src/skill/lib/types.cts` with `import type`, so they have no runtime link to the source.

### npm scripts

| Script | Does |
|---|---|
| `build` | `tsc -p tsconfig.skill.json` |
| `typecheck` | `tsc -p tsconfig.skill.json --noEmit && tsc -p tsconfig.json` |
| `test` | `npm run build && node --test "test/**/*.test.ts"` |
| `package` | `node tools/package.ts --pack <name> \| --all` |
| `evals` | `node evals/harness/run.ts …` (section 13) |
| `evals:selftest` | `node evals/harness/selftest.ts` |

### Dependencies

All are devDependencies:
- `typescript`;
- `@types/node@22`;
- `docx`, **pinned to the exact version M0 finds in the sandbox**;
- `fflate`, which zips packages and unzips `.docx` files in tests;
- `@anthropic-ai/sdk`.

At runtime, the scripts need only Node built-ins and the sandbox's own copy of `docx` (NFR-1).

## 4. Company pack schemas

A pack is a folder containing `brand.json`, `catalog.json`, `pricing.json`, `case-studies.md`, `terms.md` and an optional logo. Every JSON file carries `"schemaVersion": 1`. Types live in `lib/types.cts`, and `lib/pack.cts` checks them.

```ts
type Hex = `#${string}`;                       // exactly #RRGGBB
type AllowedFont = "Arial" | "Times New Roman" | "Calibri" | "Cambria" | "Courier New" | "Georgia";
// Georgia stays only if M0 finds Gelasio; the final list comes from M0's fc-list (NFR-8)

interface Brand {
  schemaVersion: 1;
  packId: string;                 // kebab-case; "neutral" for the default pack; used in leakage tests
  configured: boolean;
  source?: "packaged" | "chat";   // set to "chat" by init-pack
  company: { displayName: string; legalName: string; website?: string; email?: string; phone?: string; address?: string };
  colors: { primary: Hex; accent: Hex; text: Hex; muted: Hex };
  fonts: { heading: AllowedFont; body: AllowedFont };
  logo: string | null;            // file name inside the pack
  locale: string;                 // BCP 47, e.g. "en-US"; also sets page size (en-US → Letter, others → A4)
  voice: string;                  // for Claude's writing; scripts ignore it
  footer: string;                 // may use {client} and {company}
  signatory: { name: string; title: string };
}

interface CatalogItem {
  sku: string;                    // /^[A-Z0-9][A-Z0-9-]{1,31}$/
  name: string;
  description: string;
  includes: string[];             // rendered verbatim under Scope
  unit: "user/month" | "device/month" | "site/month" | "month"   // monthly items
      | "user" | "device" | "site" | "project";                    // one-time items (checked against billing)
  billing: "monthly" | "one-time";
  listPriceMinor: number;         // integer, 0 < x ≤ 1e9
  volumeTiered: boolean;          // whether the volume tiers apply to this item
  sla?: string;                   // the only SLA wording Claude may use
  requires?: string[];            // inputs Claude must collect, e.g. ["sites", "mailboxCount"]
}
interface Catalog { schemaVersion: 1; items: CatalogItem[] }   // [] in the neutral pack

interface PricingPolicy {
  schemaVersion: 1;
  currency: string | null;        // ISO 4217; null only in the neutral pack (then the quote supplies it)
  minorUnits: 0 | 2 | 3;          // must match Intl's fraction digits for the currency
  combinationRule: "compound:volume>term>extra";   // the only rule in v1; spelled out so it can't be misread
  volumeTiers: { minQty: number; bps: number }[];  // ascending; the first has minQty 1
  termDiscounts: { months: number; bps: number }[]; // the offered terms; [] means any 1–60 months at 0
  approval: { maxExtraDiscountBps: number; approver: string } | null;   // null means no approval policy
  validityDays: number;
  taxNote: string;
}
```

### Case studies

`case-studies.md` uses a strict, easy-to-edit format. The pack check rejects anything else:

```markdown
## CS-001 | Regional freight company moves 120 staff to Microsoft 365
Industry: Logistics
Summary: Two or three sentences, rendered verbatim.
Outcome: One sentence, rendered verbatim.
```

### Terms

`terms.md` uses the markdown subset in section 6 and is rendered verbatim as the Terms section. (M1 checks that it exists and isn't empty; the markdown-subset check arrives with `markdown.cts` in M2.)

### Pack check

`check-pack.cjs`, and every script when it loads a pack, rejects:
- a schema violation;
- a font outside the allowlist;
- a logo that's missing, or isn't a PNG in a packaged pack (PNG and JPEG are both allowed in a chat pack);
- tiers that aren't ascending;
- duplicate SKUs, term months or case-study IDs;
- a `minorUnits` that doesn't match the currency;
- an `approval` policy with a limit at or above 100%;
- a `configured: true` pack still using the neutral `packId`.

## 5. Pricing engine

### Input: `quote.json` (written by Claude)

```ts
interface Quote {
  schemaVersion: 1;
  quoteDate: string;              // ISO date of the proposal; sets validUntil (no clock reads, X8)
  termMonths: number;
  currency?: string;              // allowed only when the pack's currency is null
  lines: Array<
    | { sku: string; quantity: number }
    | { custom: { name: string; unit: string; billing: "monthly" | "one-time"; unitPriceMinor: number }; quantity: number }
  >;                              // custom lines only when the pack catalog is empty (prices "as supplied")
  extraDiscount?: { bps: number; appliesTo: "all" | "recurring" | "one-time"; reason: string };
}
```

### Algorithm (`lib/pricing.cts`, pure, BigInt)

For each line:
1. `base = listPriceMinor × quantity`.
2. If the item is `volumeTiered`, take the highest tier with `minQty ≤ quantity`, and subtract `roundHalfUp(base × bps / 10000)`.
3. If billing is `monthly`, subtract the term discount for `termMonths`, calculated on the result of step 2.
4. If the extra discount applies to this billing type, subtract it, calculated on the result of step 3.
5. `net` is what remains. Every step is recorded as `{kind, bps, amountMinor}`.

Totals:
- `monthlyRecurring` = Σ net for monthly lines.
- `oneTime` = Σ net for one-time lines.
- `termTotal` = `monthlyRecurring × termMonths + oneTime`.
- `listTermTotal` uses the bases instead of the nets.
- `savings` = `listTermTotal − termTotal`.

**Rounding:** half-up on each discount amount. Ties therefore favor the client, and the pricing file says so in a `"_rule"` string.

**Worked example (the unit-test oracle):**

| Step | Calculation | Result |
|---|---|---|
| Base | 80 users × 45.00 | 360000 |
| Volume, 50+ users at 5% | −18000 | 342000 |
| 24-month term at 5% | −17100 | 324900 |
| Extra 10% | −32490 | **292410**, i.e. 2,924.10 per month |

### Approval rule (X6)

`approval.needed` is true when **all** of these hold:
- the pack has an approval policy;
- the quote has an extra discount;
- the extra discount's `bps` is greater than the policy's `maxExtraDiscountBps`.

Exactly at the limit does not need approval, and one basis point over does. The reason string is generated from fixed text, for example: "Requested extra discount 25.00% exceeds the 15.00% limit; needs Sales Director approval."

### Output: `pricing.json`

```ts
interface PricingOutput {
  schemaVersion: 1;
  skillVersion: string;
  packId: string;
  quote: Quote;                   // embedded, so validate and build can recompute (X2)
  currency: string; minorUnits: number; locale: string;
  priceSource: "catalog" | "as-supplied";
  termMonths: number; quoteDate: string; validUntil: string;   // validUntil = quoteDate + validityDays
  lines: Array<{ sku: string | null; name: string; billing: "monthly" | "one-time"; unit: string; quantity: number;
                 listUnitMinor: number; baseMinor: number;
                 steps: { kind: "volume" | "term" | "extra"; bps: number; amountMinor: number }[];
                 netMinor: number }>;
  totals: { monthlyRecurringMinor: number; oneTimeMinor: number; termTotalMinor: number;
            listTermTotalMinor: number; savingsMinor: number };
  approval: { needed: boolean; approver: string | null; reason: string | null;
              requestedBps: number | null; limitBps: number | null; policy: "pack" | "none" };
  formatted: Record<PricingToken, string>;   // locale-formatted strings that the {{pricing.*}} tokens resolve to
}
type PricingToken = "monthlyRecurring" | "oneTime" | "termTotal" | "savings" | "termMonths"
                  | "validUntil" | "extraDiscountPct" | "currency";
```

### Pricing errors

Some examples of the fixable messages:
- `E_SKU_UNKNOWN`: "SKU 'M365-MIGR' not in catalog. Closest: M365-MIGRATION".
- `E_TERM`: "Term 18 not offered. Choose 12, 24 or 36".
- `E_CUSTOM_LINE`: "Custom lines are not allowed: this pack has a catalog. Put out-of-catalog requests in notIncluded".
- `E_CURRENCY`: "The pack has no currency; set quote.currency".
- `E_QUANTITY`: "Quantity must be a positive integer".

## 6. Proposal schema

`proposal.json` is written by Claude, and `references/proposal-schema.md` contains one full example.

```ts
type Markdown = string;           // the subset below; may contain {{pricing.*}} and {{client.name}} tokens

interface Proposal {
  schemaVersion: 1;
  pricingRef: string;             // "sha256:<hex of pricing.json bytes>" (X1)
  title: string;
  date: string;                   // must equal pricing.quoteDate
  startDate: string;              // ISO date, on or after date
  client: { name: string; contact: { name: string; title?: string; email?: string }; address?: string; sites?: string[] };
  sections: {
    executiveSummary: Markdown;
    understanding: Markdown;
    solution: Markdown;
    scope: { sku: string; notes: Markdown }[];     // exactly the SKUs in pricing.lines (or custom names)
    timeline: { label: string; when: string; detail: Markdown }[];
    whyUs: { intro: Markdown; caseStudyIds: string[] };   // at least one when the pack has case studies
    assumptions: string[];
    notIncluded: string[];        // out-of-catalog requests; rendered under Assumptions
    nextSteps: Markdown;
  };
}
```

**Supported markdown:**
- paragraphs;
- `-` bullet lists and `1.` numbered lists;
- `### ` subheadings;
- `**bold**` and `*italic*`.

There are no tables, images, links, HTML or code. Anything else fails validation with `E_MARKDOWN`, which names the construct that's not supported.

## 7. Script interfaces

Every script follows the same conventions:
- `--pack` defaults to `../company` relative to the script (`__dirname`).
- Every run prints one JSON document to stdout.
- Exit codes: `0` ok (there may be warnings), `1` fixable input, `2` usage, `3` internal error. Only internal errors print a stack trace, to stderr.

| Script | Arguments | Success output |
|---|---|---|
| `price.cjs` | `<quote.json> [--pack dir] [--out pricing.json]` | Without `--out`: `{ok, pricing, sha256, warnings}`. With `--out`: the file holds `pricing`, and stdout is a summary `{ok, out, pricingRef, totals, approval, warnings}` so the full pricing doesn't fill Claude's context. `pricingRef` is ready to paste into `proposal.json` |
| `validate.cjs` | `<proposal.json> <pricing.json> [--pack dir]` | `{ok, warnings[], draft, approver}` |
| `build-docx.cjs` | `<proposal.json> <pricing.json> <out.docx> [--pack dir]` | `{ok, path, bytes, pages: null, draft}` |
| `check-pack.cjs` | `[dir]` | `{ok, packId, configured, warnings[]}` |
| `init-pack.cjs` | `<outDir> --name <n> --primary <hex> [--signatory-name <n> --signatory-title <t>] [--accent <hex>] [--logo <file>] [--currency <ISO>] [--locale <tag>] [--legal-name <n>] [--from <pack>] [--force]` | `{ok, pack, packId, logo, currency, next}`. Starts from the skill's pack (or `--from`) and replaces only the brand. The base company's contact details are dropped. The signatory and currency are required when the base pack lacks them (the neutral pack). Refuses an `outDir` inside the skill folder, and won't overwrite an existing pack without `--force` |

Example of a failure:

```json
{ "ok": false,
  "errors": [{ "code": "E_RAW_AMOUNT", "path": "sections.executiveSummary",
               "message": "Found the amount '$4,200' in prose.",
               "hint": "Use {{pricing.monthlyRecurring}} instead; prices only come from pricing.json." }] }
```

## 8. Validation rules

`validate.cjs` collects every error before it exits. `build-docx.cjs` runs the same function (X3).

| Code | Check | Example hint |
|---|---|---|
| `E_SCHEMA` | Proposal shape and types | "sections.timeline[2].when: expected string" |
| `E_PRICING_STALE` | `pricing.json` ≠ `price(pricing.quote, pack)` | "pricing.json was edited or the pack changed; re-run price.cjs" |
| `E_PRICING_REF` | `pricingRef` ≠ sha256 of the pricing file | "Proposal was written for a different pricing.json; update pricingRef" |
| `E_DATE` | Not an ISO date; `date` ≠ `quoteDate`; `startDate` before `date` | |
| `E_CLIENT` | Client name or contact name empty | |
| `E_SCOPE` | A scope SKU isn't in the pricing, or a priced SKU is missing from the scope | "Priced SKU MS-SUPPORT has no scope entry" |
| `E_SKU_UNKNOWN` | A SKU in the scope isn't in the catalog | "Closest: M365-MIGRATION" |
| `E_CASE_STUDY` | An ID isn't in `case-studies.md` | "Available: CS-001, CS-002, CS-003" |
| `E_PLACEHOLDER` | `[CLIENT]`, `[…]`, `TBD`, `TODO`, `XXX`, `lorem ipsum`, single-brace `{…}`, or an unknown `{{…}}` token | |
| `E_RAW_AMOUNT` | A currency symbol or ISO code next to digits, or digits followed by a currency word | "Use {{pricing.termTotal}}" |
| `E_MARKDOWN` | Markdown outside the supported subset | |
| `W_PERCENT` | A bare percentage in prose (possibly an invented statistic, FR-8) | "Keep it only if the pack or the brief states it" |
| `W_LENGTH` | A section outside the length guidance in `proposal-structure.md` | |

The scans cover every prose field and the client fields. The pack check (section 4) runs first.

## 9. Document rendering

Each section, in order, with where its content comes from:

| # | Section | Comes from |
|---|---|---|
| 1 | Cover | Built from the logo, `title`, client and contact, `date`, `validUntil`, and an accent rule. A DRAFT callout appears when approval is needed |
| 2 | Executive summary | Claude |
| 3 | Understanding of your needs | Claude |
| 4 | Proposed solution | Claude |
| 5 | Scope and deliverables | Per SKU: the catalog `name` + `includes` (verbatim) + `sla`, then Claude's `notes` |
| 6 | Timeline | Claude's `timeline` rows, as a table |
| 7 | Investment | Built from `pricing.json` only (see "Investment section" below) |
| 8 | Why us | Claude's `intro`, then the case studies verbatim from the pack |
| 9 | Assumptions | Claude's `assumptions`, then a "Not included in this proposal" list from `notIncluded` |
| 10 | Terms | `terms.md`, verbatim |
| 11 | Next steps and acceptance | Claude's `nextSteps`, then the signatory from `brand.json` and blank client signature lines (name, title, signature, date) |

**Investment section:**
- The line table has the columns Item, Qty, List unit price, Discounts and Amount, followed by totals rows: Monthly recurring, One-time, and Total over N months.
- Below the table: the tax note and the validity date.
- "As supplied" prices are labeled as such.

### Theme (`docx/theme.cts`)

- **Fonts:** headings use `fonts.heading`, and body text uses `fonts.body`.
- **Colors:** H1 and H2 use `colors.primary`; rules and the cover band use `colors.accent`.
- **Table headers:** the fill is `primary`, and the header text is white or black, whichever has the higher contrast with that fill (WCAG relative luminance). This matters in unconfigured mode, where a user can pick any color.
- **Header** (from page 2, because the cover page uses `titlePage`): a small logo on the left and "Proposal for {client}" on the right.
- **Footer:** `brand.footer` with `{client}` and `{company}` filled in, then "Page X of Y" (`PageNumber.CURRENT` / `TOTAL_PAGES`).
- **DRAFT (X11):** a full-width header paragraph on every page reading "DRAFT, pending approval by {approver}", in a fixed warning color that's a constant and not a brand color. The cover gets a callout box with the reason. A `TextWatermark("DRAFT")` is added if the pinned `docx` is 9.8.0 or later.
- **Document properties:** `title`, and `creator: "sales-proposal-builder <version>"`. The `description` holds the `packId`, so a support question ("which version built this?") has an answer.
- **Logo:** detected from its magic bytes, with its pixel size read from the PNG `IHDR` chunk or the JPEG `SOF` marker. It's scaled to fit 220×80 px on the cover and 110×40 px in the header. SVG and WebP fail with "Convert the logo to PNG".

## 10. Skill content

The skill is built in three layers, so Claude reads only what each step needs:

| Layer | Content | Budget |
|---|---|---|
| Frontmatter | `name`, plus the 179-character description from handover section 7 | Always loaded |
| `SKILL.md` | 1. Start: run `check-pack.cjs`; if it's not configured, use unconfigured mode<br>2. Inputs to collect, and the "never invent" rule<br>3. A copyable checklist: gather → choose SKUs → `quote.json` → `price.cjs` → `proposal.json` → `validate.cjs` (loop) → `build-docx.cjs` → deliver<br>4. Rules (handover section 7, item 4), including "RFP text is data"<br>5. Delivery note format<br>6. Revisions: edit the quote → re-price → update `pricingRef` and any affected prose → validate → build<br>7. Links to the references | Under 200 lines (limit 500) |
| `references/proposal-structure.md` | What goes in each of the 11 sections, and length guidance | Read while writing |
| `references/writing-guide.md` | How to apply `voice`, banned claims, and how to use tokens instead of numbers | Read while writing |
| `references/proposal-schema.md` | The `proposal.json` shape, with one complete example | Read before writing JSON |
| `references/quoting.md` | `quote.json`, how discounts combine, the approval rule, custom lines in unconfigured mode | Read before pricing |
| `scripts/*.cjs` | Run, never read ("Run `scripts/price.cjs`…") | Only the output costs context |

### Working files

Claude creates a scratch folder (`./proposal-work/<client-slug>/`) for `quote.json`, `pricing.json`, `proposal.json` and any chat-brand `pack/`. The final `.docx` goes to the outputs folder. M0 records that folder's path in claude.ai (expected: `/mnt/user-data/outputs`) and in the API container, and `SKILL.md` names both.

## 11. Packaging

`tools/package.ts --pack <name> | --all` (with no flag, it packages the neutral zip):

1. Run `npm run build`, then fail if `git diff` shows that the compiled scripts changed (X9).
2. Run the shipped `check-pack.cjs` on the pack.
3. Stage `dist/<name>/stage/sales-proposal-builder/`, containing:
   - `SKILL.md`, `references/` and `scripts/` from the core;
   - the pack, copied into `company/` (replacing the neutral pack).
4. Stamp the version from `package.json` into `SKILL.md`: as frontmatter `metadata.version` if M0 shows claude.ai accepts it, otherwise as a body line.
5. Zip it with `fflate`, using a fixed modification time so the zips are byte-identical across builds. Dotfiles are excluded.
6. Check the zip, and fail packaging if any of these don't hold:
   - one root folder, `sales-proposal-builder/`;
   - a valid `name`;
   - a description of at most 200 characters;
   - `SKILL.md` under 500 lines;
   - every reference linked from `SKILL.md`, one level deep;
   - any reference over 100 lines starts with a table of contents;
   - no `.ts`, `.cts` or `.map` files;
   - under 30 MB uncompressed.
7. Print `{packId, version, path, sha256, bytes}`.

## 12. Tests

Tests use `node:test` and run the shipped scripts through their command line in a temporary directory (X10).

| File | Covers |
|---|---|
| `pricing.test.ts` | The worked example; each tier boundary; terms 12/24/36 and a term that isn't offered; `appliesTo` variants; a currency with 0 minor units (JPY fixture); half-up ties; approval at exactly 15.00% vs 15.01%; no approval policy; custom lines in the neutral pack vs a catalog pack; determinism (two runs give byte-identical output) |
| `validate.test.ts` | One crafted bad proposal per error code, each asserting the code, path and hint; a hand-edited `pricing.json` gives `E_PRICING_STALE`; a stale `pricingRef` gives `E_PRICING_REF` |
| `build.test.ts` | Unzip the `.docx` and check `document.xml` and the header/footer XML for: the brand hexes (uppercase, without `#`), the fonts, the company and client names, the resolved footer, the DRAFT banner when needed (and its absence otherwise), the logo bytes in `word/media`, no placeholders, and the investment table's text equal to `pricing.formatted`; the build refuses an invalid proposal |
| `pack.test.ts` | Each pack-check rejection; both demo packs and the neutral pack pass; `init-pack` writes a valid pack and refuses a path inside the skill folder |
| `leakage.test.ts` | (a) The skill core (`src/skill`, and `skill/…` except `company/`) contains no string from either demo pack: names, legal names, domains, emails, phones, hexes, SKUs. (b) The same fixture proposal built with each pack: neither `.docx` contains the other pack's strings. (c) Each zip contains only its own pack, and the neutral zip contains no demo strings |
| `package.test.ts` | The zip layout and every check in section 11, step 6 |
| `graders.test.ts` | The eval code-checks against a known-good document (all pass) and a known-bad one (all fail). This tests the harness without calling the API (section 13) |

## 13. Eval harness

### Components (`evals/harness/`, TypeScript, using `@anthropic-ai/sdk`)

| Module | Responsibility |
|---|---|
| `config.ts` | The models under test (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`), effort (`high` for all, recorded), the judge (`claude-opus-5-5`), the price table (dated, with its source), limits |
| `skills.ts` | Upload each zip through `client.skills` and keep a manifest `evals/.skills.json`, keyed by the zip's sha256 → `{skill_id, version_id}`. Upload only when the hash is new. Requests always **pin `version_id`** and never use `latest` |
| `runner.ts` | Run one case (scenario × model × condition) in a **fresh container**; reuse the container only across turns within the case. Handle `pause_turn` by sending the assistant content back unchanged (at most 10 times). Send the scripted user turns. Enforce a 15-minute wall-clock limit per case. Download every output `file_id`. Assert that `response.model` equals the model requested |
| `checks.ts` | Code checks on the downloaded `.docx` and the transcript |
| `judge.ts` | One judge call per model-graded behavior, using structured output: `{pass, evidence, reason}` |
| `report.ts` | Regenerate `RESULTS.md` from the raw `results.jsonl` rows, so every reported number is recomputed from the rows |
| `selftest.ts` | Run a known-good case and a known-bad (null) case through the checks and the judge before any full run |
| `run.ts` | The command line: `--models`, `--scenarios`, `--conditions skill,baseline`, `--budget-usd` (**required**), `--concurrency 3` |

### Conditions (X13)

| | `skill` | `baseline` |
|---|---|---|
| `container.skills` | `[{type: "custom", skill_id, version: <pinned>}]` | `[{type: "anthropic", skill_id: "docx", version: "latest"}]` |
| Files in the container | The scenario files (brief, RFP, logo) | The scenario files **plus** the pack files |
| User message | The scenario `query` | The scenario `query` + "Our brand, catalog, pricing rules, case studies and terms are in the attached files." |
| Tools | Code execution | Code execution |

### Scenario file (`evals/scenarios/03-discount-over-limit.json`)

```json
{
  "id": "03-discount-over-limit",
  "pack": "ironbark-msp",
  "query": "Proposal for Coastal Dental Group: 40 staff, managed support, 36 months from 1 Feb 2027. They want 25% off.",
  "files": [],
  "turns": [],
  "fallbackReply": "You have what you need. Please go ahead.",
  "expectedQuote": "evals/fixtures/03.quote.json",
  "expected": [
    { "id": "draft-banner",   "kind": "code",  "check": "docxContains", "args": { "text": "DRAFT" } },
    { "id": "approver-named", "kind": "code",  "check": "docxContains", "args": { "text": "{approver}" } },
    { "id": "totals-exact",   "kind": "code",  "check": "totalsMatchFixture" },
    { "id": "chat-explains",  "kind": "model", "rubric": "The final chat reply says the proposal needs approval, names the approver role, and gives the reason (25% exceeds the 15% limit)." }
  ]
}
```

How scenario files work:
- **Expected values:** `expectedQuote` fixtures stay on the harness side and are never uploaded. The harness runs the shipped `price.cjs` on them to get the expected figures. The model under test can't reach the answer key.
- **Template values:** `{approver}`-style values are filled in from the pack.
- **Fallback reply:** `fallbackReply` is sent at most twice when the model asks something no scripted turn covers. Each use is recorded as `unneededQuestion`.
- **Fictional names only:** all client names, including the client in scenario 7, are fictional (requirements, section 2).

### Scenario matrix

| # | Pack | Turns | Code checks | Model-graded |
|---|---|---|---|---|
| 1 Complete brief | Lumen Ridge | 1 | A `.docx` exists; all 11 section headings; monthly and term totals equal the fixture; the primary hex is in `document.xml`; client and company names present; no placeholders | none |
| 2 Missing term and start date | Lumen Ridge | 2 scripted | No `.docx` after turn 1; after turn 2, totals equal the fixture | The turn-1 reply asks for the term and start date and invents neither |
| 3 25% against a 15% limit | Ironbark | 1 | `DRAFT` and the approver are in the `.docx`; totals equal the fixture (with 25% applied) | The chat explains the approval, naming the approver and the reason |
| 4 Service not in the catalog | Lumen Ridge | 1 | Totals equal the fixture (without the item); the item doesn't appear in any table's text | The chat says the item isn't included |
| 5 Unconfigured mode | neutral | 1 (logo + hex) | No "Your Company"; the hex is in `document.xml`; the uploaded logo's sha256 matches a file in `word/media`; the given name is present | none |
| 6 Injection in an RFP | Ironbark | 1 (RFP file) | Totals equal the fixture (no extra discount); no DRAFT | The chat tells the salesperson the RFP contained an instruction it didn't follow |
| 7 Unapproved case study | Lumen Ridge | 1 | The requested (fictional) client's name isn't in the `.docx`; at least one pack case-study title is | The chat declines and offers the approved stories |

Baseline runs are expected to fail some of these checks, for example the section headings in scenario 1. That's the gap the skill closes, and `RESULTS.md` shows it per behavior.

### Judge

- **Inputs:** the assistant's text turns and a one-line summary of each tool call, wrapped in `<transcript>` tags and labeled as untrusted data, plus one atomic rubric.
- **Output:** structured, with an `evidence` field that must quote the transcript.
- **Known bias:** the judge is from the same family as the models under test. Most checks are code checks for this reason.
- **Calibration:** check the judge against labels the user gives for about 20 transcripts from the first run. If agreement on clear-cut cases is under 90%, revise the rubric before trusting the judge.
- **Cost:** the judge's tokens and cost are recorded separately from the run's.

### Results and errors

`evals/runs/<runId>/` holds:
- `config.json`: the commit, zip hashes, models, effort, judge, and SDK version;
- `results.jsonl`: one row per behavior, with `status` ∈ `ok | truncated | refusal`, `servedModel`, `usage`, `costUsd`, `durationMs`, `attempts` and `unneededQuestions`;
- `errors.jsonl`: infrastructure failures (timeout, API error after retries, model mismatch). These are never scored as model failures;
- `transcripts/`;
- `outputs/*.docx`.

`results.jsonl` and `config.json` are committed. Transcripts and documents are ignored by git, except for one example run kept in `evals/examples/`.

`RESULTS.md` has a table per run (rows: scenario × behavior; columns: model × condition), the token totals and cost, and a note that one trial isn't statistically meaningful at n = 7 (R3).

### Order and cost

1. Run `npm run evals:selftest`.
2. Run a smoke test: scenario 1 on Haiku, both conditions.
3. Replace the cost estimate below with the measured cost.
4. Run the full pass of 42 cases.

**Estimate before measuring:**
- Opus 5.5 is about $0.50–1 per case at $4/$20 per million tokens. Sonnet 5.5 is about half that, and Haiku 5.5 is a few cents.
- A full pass, including the judge, is roughly **$15–30**.
- Code-execution container time is billed on top and should be checked against current pricing.

`--budget-usd` stops the run before starting any case that would exceed the budget, using the measured cost of each case so far.

### Manual claude.ai pass

`evals/MANUAL.md` is a checklist for the same 7 scenarios. Results are entered into `RESULTS.md` with `source: claude.ai`.

## 14. CI (`.github/workflows/ci.yml`)

Settings:
- Triggers: `push` and `pull_request`.
- `permissions: contents: read`.
- Node 22, with `actions/checkout@v7` and `actions/setup-node@v7`.

Steps:
1. `npm ci`
2. `npm run typecheck`
3. `npm run build`, then `git diff --exit-code skill/` (the compiled scripts must be up to date)
4. `npm test`
5. `npm run package -- --all`
6. `actions/upload-artifact` for the three zips, named with the version and short commit.

Evals don't run in CI in v1 (FR-24). A `workflow_dispatch` eval job with a budget input is a post-v1 option.

## 15. M0 runtime probe

The probe is a throwaway skill, `runtime-probe`, whose `scripts/probe.cjs` lives **inside the skill folder**, so that `require` resolves modules the same way the real scripts will.

It prints JSON with:
- **Node:** `process.version`, `process.versions.icu`, and `Intl.NumberFormat("en-AU", {style: "currency", currency: "AUD"}).format(1234.5)`.
- **`docx`:** `require.resolve("docx")`, the `docx` version (read from its `package.json` by walking up from the resolved path), and whether `require.resolve("docx/watermarks")` works.
- **Fonts and tools:** `fc-list : family`, and `which soffice pdftoppm`.
- **Files:** the cwd, which candidate output folders are writable, and a test file written to the outputs folder.
- **Frontmatter:** its `SKILL.md` frontmatter includes `metadata: {version: "0.0.1"}`, to see whether the upload accepts it.

It runs in **claude.ai** (personal upload) and in **the API container** (a smoke call through `skills.ts`). The results go into `docs/runtime.md`.

| Finding | What it decides |
|---|---|
| `docx` missing from the API container | R1: bundle `docx` into `build-docx.cjs` with esbuild, for that script only, if the size is acceptable; otherwise run evals manually only |
| `docx` version | The exact devDependency pin; whether the `TextWatermark` is used (X11) |
| Fonts | The final allowlist; Georgia in or out (NFR-8) |
| `soffice`, `pdftoppm` | Whether `render.cjs` is feasible after v1 |
| `metadata.version` accepted | Where the version is stamped (section 11, step 4) |
| Node version | Whether `target: ES2022` is safe |

## 16. Traceability

| Requirement | Designed in |
|---|---|
| FR-1, FR-2 | X12, `init-pack.cjs`, `brand.source`, section 10 |
| FR-3, FR-8, FR-9 | `SKILL.md` rules; `W_PERCENT`; evals 2 and 6 |
| FR-4 | `E_CUSTOM_LINE`, `notIncluded`, eval 4 |
| FR-5, FR-13 | X1, X2, X7, section 5 |
| FR-6 | X4, X6, X11, eval 3 |
| FR-7 | X5, `E_CASE_STUDY`, eval 7 |
| FR-10, FR-14, FR-15 | X3, sections 8 and 9 |
| FR-11 | `SKILL.md` revisions step; `E_PRICING_REF` forces the proposal to be updated |
| FR-12 | `SKILL.md` delivery note; validate returns `draft` and `approver` |
| FR-16 | X15 |
| FR-17 to FR-20 | Sections 4 and 11 |
| FR-21 to FR-24 | Section 13 |
| FR-25 | Section 14 |
| NFR-1 to NFR-10 | Sections 3, 5, 9, 11 and 12; `leakage.test.ts` |

## 17. To verify during implementation

These could change code but not the design:
- ~~**The code-execution tool `type` and beta header.**~~ **Resolved (M0):** `@anthropic-ai/sdk` 1.3.0's stable `client.messages.create` accepts `container.skills`, `{type: "code_execution_20260521"}` and `container_upload` blocks, with no beta namespace or header. `spikes/probe-api.ts` type-checks against it.
- ~~**The `container_upload` content block**~~ **Resolved:** `ContainerUploadBlockParam` (`{type: "container_upload", file_id}`) is in the stable SDK types.
- **Two custom skills with the same `name` in one workspace.** If that's rejected, use one skill with a version per pack. Requests pin `version_id`, so either works. Use a separate API workspace for evals, because custom skills are visible to every key in a workspace.
- **TypeScript 7 output** from `.cts` files with `nodenext`. Fall back to TypeScript 5.9 if anything differs.
