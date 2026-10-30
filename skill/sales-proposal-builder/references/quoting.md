# Writing quote.json

`price.cjs` turns a quote into `pricing.json`, the only source of numbers in a proposal. You choose what goes in the quote; the script does all the math.

## Example

```json
{
  "schemaVersion": 1,
  "quoteDate": "2027-01-15",
  "termMonths": 24,
  "lines": [
    { "sku": "SUPPORT", "quantity": 80 },
    { "sku": "SETUP", "quantity": 1 }
  ],
  "extraDiscount": { "bps": 1000, "appliesTo": "recurring", "reason": "Salesperson offered 10% to match a competitor" }
}
```

## Fields

| Field | Rules |
|---|---|
| `quoteDate` | The proposal's date, as `YYYY-MM-DD`. `proposal.json` uses the same date. "Valid until" counts from it. |
| `termMonths` | One of the terms the pack offers (`check-pack.cjs` lists them as `termsOffered`). If the list is empty, any term from 1 to 60 months. |
| `lines` | One line per catalog SKU, with `quantity` as a whole number in the item's unit (users, devices, sites, or 1 for a project). Each SKU appears once. |
| `extraDiscount` | Only if the salesperson asked for one. `bps` is basis points: 1% is 100, so 12.5% is 1250. `appliesTo` is `all`, `recurring` (monthly items) or `one-time`. `reason` says why, in a few words. |
| `currency` | Only when the pack has no currency (an unconfigured pack). An ISO code such as `"USD"`. |

## How discounts combine

The pack's own discounts apply automatically. Never add them to the quote yourself.

1. **Volume:** a percentage by quantity, for catalog items marked `volumeTiered`.
2. **Term:** a percentage for the chosen term, on monthly items only.
3. **Extra:** the `extraDiscount`, on the items in `appliesTo`.

They compound in that order, and each step rounds to the nearest minor unit (cent). `pricing.json` shows every step for every line.

## Approval

Volume and term discounts are company policy, so they never need approval. An extra discount above the pack's limit does. When it's over the limit, `price.cjs` reports `"approval": {"needed": true, "approver": …, "reason": …}`, and the document is marked DRAFT.

Put in the discount the salesperson asked for, even when it's over the limit, so the draft shows it. Never lower it yourself to avoid approval, and never raise it.

## Prices given in chat (unconfigured pack)

With no catalog, each line is a custom item with the price the salesperson gave you:

```json
{ "custom": { "name": "Managed support", "unit": "user/month", "billing": "monthly", "unitPriceMinor": 6500 }, "quantity": 12 }
```

- **`unitPriceMinor`** is in minor units: 65.00 is `6500`. For a currency with no minor unit, such as JPY, it's the whole amount.
- **`billing`** is `monthly` or `one-time`.
- **`unit`** is `user/month`, `device/month`, `site/month` or `month` for monthly items, and `user`, `device`, `site` or `project` for one-time items.

The document labels these prices "as supplied". A pack with a catalog rejects custom lines.

## After pricing

`price.cjs --out pricing.json` prints:
- `pricingRef`: put it in `proposal.json`;
- the formatted totals;
- the approval result.

If anything changes later, edit the quote and price it again. `validate.cjs` rejects a proposal whose `pricingRef` doesn't match the current pricing.
