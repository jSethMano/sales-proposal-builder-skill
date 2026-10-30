# Changelog

All notable changes to the `sales-proposal-builder` skill. Versions follow [Semantic Versioning](https://semver.org/). The version lives in `package.json` and `src/skill/lib/version.cts`, and a test keeps them equal.

## [Unreleased]

### Added
- M0 runtime probe (`spikes/runtime-probe`, `npm run probe:zip`, `npm run probe:api`), not yet run in claude.ai or the API. See `docs/runtime.md`.
- Company pack format: `brand.json`, `catalog.json`, `pricing.json`, `case-studies.md`, `terms.md` and a logo, with a checker that reports every problem at once (`check-pack.cjs`).
- The neutral pack shipped in the skill core, for unconfigured mode, and two fictional demo packs: Lumen Ridge IT (USD) and Ironbark Managed Services (AUD).
- `price.cjs`: compounding volume → term → extra discounts in integer minor units, half-up rounding, and approval when the extra discount is over the pack's limit.
- `init-pack.cjs`: writes a pack for a brand given in chat, never inside the skill folder.
- Leakage test: the skill core and the neutral pack contain no string from either demo pack.
