# Evals

Seven scenarios check the behaviors that matter most for a sales proposal. Each one runs on Haiku, Sonnet and Opus, with and without the skill. Results go to [`RESULTS.md`](RESULTS.md).

| Path | What it holds |
|---|---|
| `scenarios/*.json` | The query, any files, scripted replies, and the expected behaviors, each either code-checked or graded by a judge model |
| `fixtures/*.quote.json` | The quote a correct run prices. The harness prices it with the real `price.cjs` to get the expected totals. Fixtures are never uploaded, so the model under test can't see them |
| `briefs/` | Files attached to scenarios: an RFP with an instruction planted in it, and a logo |
| `harness/` | The runner, written in TypeScript against `@anthropic-ai/sdk` |
| `runs/<runId>/` | One folder per run. `config.json` and `results.jsonl` are committed. Transcripts and the returned `.docx` files stay local |
| `MANUAL.md` | The same scenarios as a checklist for claude.ai |

## How a case runs

- **One fresh container per case.** Each case runs in a new code-execution container, which is reused only for the turns of that case.
- **Two conditions:**
  - `skill` attaches the packaged zip for the scenario's company, pinned to its exact uploaded version.
  - `baseline` attaches Anthropic's `docx` skill and uploads the company's files, so the comparison shows what the skill adds beyond the data and the ability to make a Word file.
- **Turns:**
  - Scripted replies are sent in order.
  - If the model asks something the script doesn't cover, it gets "You have what you need from me. Please go ahead.", at most twice. Each use is counted as an unneeded question.
  - A paused turn is resumed, up to 10 times.

## How grading works

- **Code checks** look at the final `.docx`: section headings, totals, colors, names, the logo, the DRAFT marking, placeholders. They also check whether a document came back too early.
- **Judge checks** grade one rubric each from the transcript, with quoted evidence. The judge is `claude-opus-5-5`. It's the same family as the models under test, which is why most behaviors are code-checked.
- **Statuses and failures:**
  - Truncated or refused cases are graded but marked.
  - Infrastructure failures go to `errors.jsonl` and are never scored as model failures. Those are timeouts, API errors after retries, and a response served by a different model.
  - A judge that fails leaves the behavior ungraded rather than failed.

`npm test` checks the graders without the API. For each scenario it builds the correct document with the real scripts and expects every code check to pass, and it checks that an empty run fails them.

## Running it

1. **Credentials.** Set `ANTHROPIC_API_KEY`. Custom skills are visible to every key in a workspace, so use a workspace set aside for evals.
2. **Runtime probe (M0).** Run `npm run probe:api -- --cleanup` once (see `docs/runtime.md`). It confirms that the API container has `docx`, and shows where returned files have to be written.
3. **Plan.** `npm run evals -- --dry-run` lists the cases and the estimated cost, with no API calls.
4. **Judge check.** `npm run evals -- --judge-selftest` checks the judge on four known answers, for a few cents.
5. **Smoke test.** `npm run evals -- --budget-usd 1 --models haiku --scenarios 01` runs one scenario on the cheapest model and replaces the cost estimate with a measured one.
6. **Full run.** `npm run evals -- --budget-usd <amount>`. Cases run cheapest model first. A case starts only if its estimated cost still fits in the budget, so a budget stop cuts the expensive models short rather than the cheap ones.
7. **Judge calibration.** Label about 20 judge-graded behaviors from the first run by hand. If the judge agrees with you on fewer than about 90% of the clear-cut ones, fix the rubrics before trusting the judge's grades.
8. **claude.ai pass.** Work through `MANUAL.md` with the three zips.

Each case runs once. With seven scenarios, read a difference of one or two behaviors as indicative, not proven.
