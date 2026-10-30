# Changelog

All notable changes to the `sales-proposal-builder` skill. Versions follow [Semantic Versioning](https://semver.org/). The version lives in `package.json` and `src/skill/lib/version.cts`, and a test keeps them equal.

## [Unreleased]

These changes don't alter the zips.

### Added
- Change management:
  - `CODEOWNERS`, and a pull request template;
  - `release.yml`, which turns a `vX.Y.Z` tag into a GitHub Release with one zip per pack and `SHA256SUMS`;
  - `evals.yml`, which runs the evals on demand, with the API key in a protected environment;
  - `npm run version:bump`;
  - `docs/change-management.md`.
- The eval harness finds its existing skill by name when it has no local record, so runs in CI add versions instead of creating duplicates.

## [0.1.1] - 2026-10-30

### Changed
- `SKILL.md` tells Claude to ask with clickable options where the interface has them (claude.ai's interactive questions, or a question tool): catalog items, term, currency, and whether to add a discount. Free-form details are still asked as one short list, and everything is plain text where there are no options.

## [0.1.0] - 2026-10-30

The first version uploaded to claude.ai.

### Changed
- Investment tables leave out the Discounts column when nothing in the table is discounted.

### Added
- M0 runtime probe (`spikes/runtime-probe`, `npm run probe:zip`, `npm run probe:api`), not yet run in claude.ai or the API. See `docs/runtime.md`.
- Company pack format: `brand.json`, `catalog.json`, `pricing.json`, `case-studies.md`, `terms.md` and a logo, with a checker that reports every problem at once (`check-pack.cjs`).
- The neutral pack shipped in the skill core, for unconfigured mode, and two fictional demo packs: Lumen Ridge IT (USD) and Ironbark Managed Services (AUD).
- `price.cjs`: compounding volume → term → extra discounts in integer minor units, half-up rounding, and approval when the extra discount is over the pack's limit.
- `init-pack.cjs`: writes a pack for a brand given in chat, never inside the skill folder.
- Leakage test: the skill core and the neutral pack contain no string from either demo pack.
- `validate.cjs`: checks a proposal against its pack and pricing, and reports every problem at once:
  - the pricing hasn't been edited, and the proposal points at it (`pricingRef`);
  - dates, client and contact;
  - scope covers exactly the priced items;
  - only approved case studies are cited;
  - no placeholders, typed amounts or unsupported markdown.

  Bare percentages and lengths outside the guide are warnings.
- The proposal format (`Proposal` in `src/skill/lib/types.cts`) and a markdown subset parser that the build will reuse. `terms.md` is now checked against the same subset.
- Realistic example proposals for Acme Logistics, one per demo pack, in `test/fixtures/proposals/`.
- `build-docx.cjs`: builds the branded `.docx` and refuses an invalid proposal. It has:
  - a cover with the logo, title, client, dates and signatory;
  - the brand's fonts, colors and page size (Letter or A4, from the locale);
  - running headers and footers with page numbers;
  - an Investment section built only from `pricing.json`;
  - approved pack wording rendered verbatim;
  - a DRAFT banner (and a watermark, on `docx` 9.8.0 or later) whenever approval is needed.
- `SKILL.md`: the rules, a nine-step checklist, unconfigured mode, revisions and script errors. It's 125 lines, with a 179-character description.
- Four reference files, each linked straight from `SKILL.md`: `quoting.md`, `proposal-schema.md`, `proposal-structure.md` and `writing-guide.md`. A test runs their examples through the real scripts and checks their limits against the code.
- `npm run package`: builds reproducible zips with the skill folder at the root, after checking the frontmatter, the version, the references, that no source ships, and the size.
- Eval scenarios 1–7 with fixtures and briefs, and an API harness (`npm run evals`) with:
  - skill and baseline conditions, and pinned skill versions;
  - code checks on the returned `.docx`, and a judge with structured output;
  - a budget guard;
  - infrastructure errors kept separate from model failures;
  - `RESULTS.md` recomputed from raw rows;
  - `--dry-run` and `--judge-selftest`.

  The graders are tested in CI against oracle documents built with the real scripts. No eval run has happened yet, because it needs an API key.
- CI (`.github/workflows/ci.yml`):
  - type-checks;
  - fails if the committed compiled scripts differ from their source;
  - runs the tests;
  - uploads the three zips as an artifact.
- `README.md`: what the skill does, how it works, company packs, a rollout guide checked against Anthropic's help articles, quality, and status. Screenshots are in `docs/images/` (`npm run screenshots`).
- A chat-branded example proposal (`test/fixtures/proposals/kauri-harbour`).
- `npm run preview`: builds the example proposals with each pack, plus a DRAFT, and renders every page with LibreOffice for a visual check. It's a development tool and isn't shipped.
- Leakage tests for built documents: each demo pack's document holds its own brand and nothing from the other pack; a chat-branded document holds nothing from either demo pack or the neutral placeholders.
