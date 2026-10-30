# Eval results

Written by `evals/harness/report.ts` from each run's `results.jsonl`. Newest run first. Scenarios are in `evals/scenarios/`.

How to read this:
- **skill** runs the packaged skill. **base** is the same model with code execution, Anthropic's docx skill and the company's files attached, so it shows what the skill adds beyond the data.
- Each case runs **once**. With 7 scenarios, a single flip is within run-to-run noise, so read differences of one or two behaviors as indicative, not proven.
- API runs have no claude.ai system prompt. `MANUAL.md` covers the claude.ai check.

No runs yet. Run `npm run evals -- --budget-usd <amount>`; see `evals/README.md`.
