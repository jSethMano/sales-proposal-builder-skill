## What changed and why

<!-- One or two sentences. Link the request or ticket. -->

## What it touches

- [ ] **Skill core** (`SKILL.md`, `references/`, `src/skill/`): what Claude reads or runs. **Run the evals** (Actions → Evals) and link the run below.
- [ ] **Pricing or catalog** (`packs/*/pricing.json`, `catalog.json`). Approved by (name, role): ___
- [ ] **Terms** (`packs/*/terms.md`). Legal review by: ___
- [ ] **Brand or case studies** (`brand.json`, `logo.png`, `case-studies.md`). Case studies need the client's consent, or must be anonymized.
- [ ] **Tooling, tests or docs only:** the zip doesn't change.

## Checks

- [ ] CI passes: types, compiled scripts current, tests, packaging.
- [ ] If the zip changes: version bumped with `npm run version:bump -- x.y.z`, and the change described in `CHANGELOG.md`.
- [ ] If the document's layout changes: checked with `npm run preview`.
- [ ] Eval run (for skill-core changes): <!-- link, and any behavior that changed -->

## After merge

Tag the version (`git tag vx.y.z && git push origin vx.y.z`). The release workflow builds the zips, and an admin uploads them (`docs/change-management.md`).
