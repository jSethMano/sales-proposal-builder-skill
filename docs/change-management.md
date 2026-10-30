# Changing the skill

How a change gets from an idea to the salespeople using the skill. GitHub holds the source of truth, so every version can be traced to a reviewed pull request, a passing test run, and a release with the exact zips that were uploaded.

## Contents

1. Who owns what
2. From change to release
3. Rolling out a release
4. Rolling back
5. When Anthropic ships a new model
6. One-time GitHub setup

## 1. Who owns what

A skill mixes engineering with business decisions, so changes are approved by whoever owns the decision. `.github/CODEOWNERS` encodes this. In this portfolio repo every line names one person; in a company each names a team.

| Part | Owner in a company | Their review checks |
|---|---|---|
| `SKILL.md`, `references/`, `src/skill/` | AI or platform team | That behavior holds, shown by the evals |
| `packs/*/pricing.json`, `catalog.json` | Sales operations and finance | Prices, discounts, the approval limit and the approver |
| `packs/*/terms.md` | Legal | The contract wording |
| `packs/*/case-studies.md` | Marketing, with the client's consent | That every story is approved and true |
| `packs/*/brand.json`, `logo.png` | Marketing | Brand use |
| `.github/` | AI or platform team | How changes are approved and released |

## 2. From change to release

1. **Branch and change.** One kind of change per pull request, so each one has a clear owner.
2. **Bump the version** if the zip will change: `npm run version:bump -- x.y.z`. Use a patch for fixes and wording, a minor version for new behavior, and a major one for a pack format change. The command updates the version everywhere it lives and opens a `CHANGELOG.md` section, which you then fill in.
3. **Open a pull request.** The template asks what the change touches, and who approved pricing or terms changes.
4. **CI runs** (`ci.yml`): type checks, the compiled scripts matching their source, every test (including leakage and packaging), and the zips built as an artifact.
5. **Evals, for changes to what Claude reads.** Start Actions → Evals → Run workflow, with a budget. A wording change in `SKILL.md` can quietly change behavior that unit tests can't see. Link the run in the pull request.
6. **Review and merge.** The code owners approve; branch protection blocks merging without them and a green CI.
7. **Tag to release:** `git tag vx.y.z && git push origin vx.y.z`. `release.yml` checks the tag against the version and the changelog, runs everything again, and publishes a GitHub Release with one zip per pack, a `SHA256SUMS` file, and the changelog section as notes.

## 3. Rolling out a release

claude.ai has no deploy API for organization skills: the help article describes an admin uploading the zip under Organization settings → Plugins & skills. Rollout is therefore a short, deliberate manual step, done from the release page.

1. **Download** the zip for the company from the GitHub Release, and check it against `SHA256SUMS` (`shasum -a 256 -c SHA256SUMS`).
2. **Pilot (Enterprise).** Upload it in a plugin assigned to a small pilot group. Try the scenarios in `evals/MANUAL.md` in claude.ai.
3. **Everyone.** Assign it to the sales group (Installed by default or Required), or provision it organization-wide on Team.
4. **Remove the previous version** if Inventory shows both. The help article doesn't describe replacing a skill in place, so check.
5. **Record it.** Note in the release, or in your change log of record, which zip went where and when.

**Claude Code.** Organization skills also sync to Claude Code unless managed settings set `syncClaudeAiSkills: false`.

**The Claude API.** A deploy job could publish each release as a new version of the custom skill (`POST /v1/skills/{id}/versions`), with apps pinning a version ID. The eval harness already does the upload (`evals/harness/skills.ts`).

## 4. Rolling back

Every release stays on GitHub. To roll back, upload the previous release's zip the same way, and record why. Then fix forward with a new patch release; don't move or delete tags.

## 5. When Anthropic ships a new model

The same instructions can behave differently on a new model. When one ships:
1. Add it to `evals/harness/config.ts` (`MODELS` and `PRICES`).
2. Run the evals on it.
3. Compare with the last results in `evals/RESULTS.md`.

Change the skill only if a behavior regressed, and that change goes through the normal flow.

## 6. One-time GitHub setup

In the repository's Settings:

1. **Branches → Add branch ruleset for `main`:**
   - require a pull request before merging, with an approval from code owners;
   - require the status check **test-and-package** (from `ci.yml`) to pass;
   - block force pushes and deletion.
2. **Environments → New environment `evals`:**
   - add the secret `ANTHROPIC_API_KEY` (from a workspace used only for evals);
   - optionally add yourself as a required reviewer, so no eval run spends money without approval.
3. **Actions → General:** keep the default read-only `GITHUB_TOKEN`. `release.yml` asks for `contents: write` for itself, and nothing else needs more.
