# Proposal structure

The document's sections, in order. You write the ones marked **you**; the build writes the rest from the pack and the pricing. Word ranges are guides: `validate.cjs` warns outside them, and the whole proposal should run to about 8–12 pages.

| # | Section | Written by | Words |
|---|---|---|---|
| 1 | Cover | Build | |
| 2 | Executive summary | **You** | 80–250 |
| 3 | Understanding of your needs | **You** | 60–300 |
| 4 | Proposed solution | **You** | 80–400 |
| 5 | Scope and deliverables | Build, plus your notes per item | 5–120 per note |
| 6 | Timeline | **You** (table rows) | 3–80 per row; at most 12 rows |
| 7 | Investment | Build, from `pricing.json` | |
| 8 | Why {company} | Your intro, then the case studies from the pack | 15–120 for the intro |
| 9 | Assumptions | **You**, plus "Not included in this proposal" from `notIncluded` | |
| 10 | Terms | Build, from `company/terms.md` | |
| 11 | Next steps and acceptance | **You**, then the signature block | 20–150 |

## What each section says

**Executive summary.** Cover three things in a few short paragraphs:
- what the client asked for;
- what you propose;
- what it costs, using tokens.

Someone who reads only this section should know the answer.

**Understanding of your needs.** Restate the client's situation and priorities in their own terms, using only what the brief says. End by inviting a correction. Never add problems or goals the brief didn't mention.

**Proposed solution.** Name each catalog item you chose and say why it fits, in a bulleted list if there are several. Explain the order of work if one item must come before another. Don't repeat the catalog's "Includes" lists; the Scope section prints them.

**Scope notes.** For each item, one or two sentences on how it applies to this client, such as how many users or which sites. The build prints the item's description, its "Includes" list and its service level above your note.

**Timeline.** A few phases, with `when` as weeks after acceptance or a date. Don't promise dates the salesperson hasn't agreed.

**Why us.** One or two sentences linking the approved case studies to this client. Choose the case studies closest to the client's industry or project.

**Assumptions.** What the price and plan depend on, such as access, numbers or locations. Put out-of-catalog requests in `notIncluded`, not here.

**Next steps.** How to accept and what happens next. End with `{{pricing.validUntil}}`.
