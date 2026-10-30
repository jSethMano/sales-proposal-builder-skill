# proposal.json

## Contents

- Fields
- Tokens
- Complete example

## Fields

| Field | What goes in it |
|---|---|
| `schemaVersion` | `1` |
| `pricingRef` | The `pricingRef` that `price.cjs` printed, e.g. `"sha256:9f2c…"` |
| `title` | A short title naming the services, e.g. "Managed IT Support and Microsoft 365 Migration" |
| `date` | The proposal's date, the same as `quoteDate` in the quote |
| `startDate` | When the services start, `YYYY-MM-DD`, on or after `date` |
| `client.name` | The client's name, as the salesperson gave it |
| `client.contact` | `name` (required), plus `title` and `email` if you have them |
| `client.address`, `client.sites` | Only if given |
| `sections.executiveSummary` | Markdown |
| `sections.understanding` | Markdown |
| `sections.solution` | Markdown |
| `sections.scope` | One entry per priced line, in any order: `{ "item": "<SKU>", "notes": "<markdown>" }`. For a custom line, `item` is its name. |
| `sections.timeline` | Rows of `{ "label", "when", "detail" }`. `detail` is markdown. |
| `sections.whyUs` | `{ "intro": "<markdown>", "caseStudyIds": ["CS-001"] }`, with at least one ID if the pack has case studies |
| `sections.assumptions` | A list of short sentences |
| `sections.notIncluded` | A list of things requested but not offered or not priced, or `[]` |
| `sections.nextSteps` | Markdown |

The build adds the cover, the Investment section (from `pricing.json`), the terms (from the pack) and the signature block. You don't write those.

## Tokens

Use a token wherever prose needs a figure. The build replaces it with the formatted value.

| Token | Becomes |
|---|---|
| `{{pricing.monthlyRecurring}}` | The monthly total |
| `{{pricing.oneTime}}` | The one-time total |
| `{{pricing.termTotal}}` | The total over the term |
| `{{pricing.savings}}` | The savings against list prices over the term |
| `{{pricing.termMonths}}` | The term in months, e.g. `24` |
| `{{pricing.validUntil}}` | The date the proposal is valid until |
| `{{pricing.extraDiscountPct}}` | The extra discount, e.g. `10%` |
| `{{pricing.currency}}` | The currency code |
| `{{client.name}}` | The client's name |

## Complete example

This example goes with the quote in [quoting.md](quoting.md): 80 users of `SUPPORT` and one `SETUP`.

```json
{
  "schemaVersion": 1,
  "pricingRef": "sha256:<copy from price.cjs output>",
  "title": "Managed IT Support",
  "date": "2027-01-15",
  "startDate": "2027-02-01",
  "client": {
    "name": "Riverside Dental",
    "contact": { "name": "Alex Chen", "title": "Practice Manager", "email": "alex.chen@riversidedental.example" }
  },
  "sections": {
    "executiveSummary": "Riverside Dental has asked us to take over IT support for its 80 staff from February. This proposal sets out the service we recommend, how we would set it up, and what it costs.\n\nWe propose our managed support service for every user, with a one-time setup project first, so that support starts from an environment we have documented. The service costs {{pricing.monthlyRecurring}} per month over a {{pricing.termMonths}}-month term, and setup costs {{pricing.oneTime}}. The Investment section sets out each line, including the discount agreed for this proposal.",
    "understanding": "Riverside Dental has 80 staff across its practice and needs dependable day-to-day IT support from a single provider.\n\nWe understand the priorities to be:\n\n- Support for every member of staff, with a clear response time when an issue stops work.\n- A smooth handover from the current arrangement, starting in February.\n\nIf any of these priorities are different, we will revise the proposal before it is signed.",
    "solution": "We propose two services from our catalog, chosen for a practice of this size that wants one provider to call.\n\n- **Managed support** for all 80 users, covering the service desk, routine maintenance and monitoring, so that staff have one number to call and problems are often fixed before anyone notices them.\n- **Setup**, a one-time project to audit and document the current environment before support starts.\n\nSetup comes first, so that the service desk works from accurate documentation from the first day of the term, and the handover from the current arrangement happens before February rather than during it.",
    "scope": [
      { "item": "SUPPORT", "notes": "Covers all 80 staff from the start date. We will agree escalation contacts during setup." },
      { "item": "SETUP", "notes": "Completed in the two weeks before the start date." }
    ],
    "timeline": [
      { "label": "Setup", "when": "Two weeks before the start date", "detail": "Audit, documentation and handover." },
      { "label": "Managed support", "when": "From 1 February 2027", "detail": "Service desk and maintenance for all staff." }
    ],
    "whyUs": {
      "intro": "We have supported organisations of a similar size through the same kind of handover. The case study below describes one of them.",
      "caseStudyIds": ["CS-001"]
    },
    "assumptions": [
      "Riverside Dental will provide administrator access to its systems before setup begins.",
      "Prices are based on 80 users; changes are billed as described in the terms."
    ],
    "notIncluded": [],
    "nextSteps": "To proceed, please sign the acceptance section and return it to us. We will then confirm the setup dates and introduce the team who will look after Riverside Dental. This proposal is valid until {{pricing.validUntil}}."
  }
}
```
