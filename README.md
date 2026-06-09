# weld

**A Solidity formatter and linter for the Sky ecosystem.**

By River Credit Labs · licensed under [AGPL-3.0-or-later](#license).

`weld` enforces and auto-applies the house code style used across the Sky / PAU smart-contract
repositories (the [`diamond-pau`](https://github.com/) family). It is the mechanical companion to the
written style guide in [`STYLE.md`](./STYLE.md): the linter flags violations, and the formatter fixes
the auto-fixable ones — so reviews can focus on logic instead of whitespace.

The style it targets is derived from the scrutinized, audited `diamond-pau` codebase, which is treated
as the ground truth. `weld` is verified to be **idempotent** on that canonical corpus (formatting an
already-correct file produces no changes) via a regression harness — see [Testing](#testing).

---

## What it does

- **Formatter** (`weld fmt`) — a deterministic, text-based auto-fixer. It normalizes whitespace and
  EOF, comment spacing, import grouping/brace spacing, `mapping (` spacing, section-header banners,
  blank-line structure (after `{`, before `}`, between members), declaration wrapping/collapsing
  (functions, events, errors) with complex-modifier stacking, column alignment (types, `indexed`
  params, struct fields + their comments, `require`, struct literals, consecutive same-callee calls),
  NatSpec (`///`→`/** */`, aligned `@param`/`@return`), and boolean/ternary wrapping. The full list is
  the "Formatter-only normalisations" table in [`STYLE.md`](./STYLE.md).
- **Linter** (`weld lint`) — AST-based rules across six categories: `file/*`, `imports/*`, `naming/*`,
  `structure/*`, `patterns/*`, and `ordering/*` (interface members alphabetical, constructor args
  alphabetical, contract section order). Each rule is `error`, `warn`, or `off`, and the required SPDX
  license + pragma version are configurable (`solidity.spdx` / `solidity.pragma`).

Run `weld rules` to list every rule and its effective severity. The full rationale and examples live
in [`STYLE.md`](./STYLE.md).

---

## Run it locally

`weld` is a Node.js CLI (Node 18+; developed on Node 22/24). It is not published to npm — you build
it from this repo and put it on your `PATH`.

### 1. Build and install the CLI

From the `weld` package directory:

```sh
npm ci            # reproducible, integrity-checked install from package-lock.json
npm run build     # compile TypeScript → dist/ (also marks the bin executable)
npm link          # symlink `weld` onto your PATH

weld --version    # verify — prints e.g. 1.0.0-rc.2
```

`npm link` creates a global symlink, so `weld` now works from any directory. (To remove it later:
`npm unlink -g weld`.) If you re-pull or edit the source, re-run `npm run build` — the global `weld`
points at `dist/`, so a rebuild is all that's needed.

### 2. Run it on a Solidity project

```sh
cd /path/to/your/contracts        # any repo with .sol files under src/ test/ script/

weld init                         # (optional) write weld.config.json — edit spdx/pragma to match the repo
weld fmt --check                  # preview: list what would change, exit 1 if anything would (no writes)
weld fmt                          # apply formatting in place
weld lint                         # report style/pattern violations (exit 1 on errors)
```

A `weld.config.json` is discovered by walking up from the current directory, so one at the repo root
governs the whole project. Without one, built-in defaults apply (AGPL-3.0-or-later, `^0.8.34`). If
your repo uses a different license/pragma, run `weld init` and set `solidity.spdx` / `solidity.pragma`
(see [Configuration](#configuration--weldconfigjson)).

### 3. Without a global install

Invoke the built CLI by path — handy for CI or a one-off:

```sh
node /path/to/weld/dist/index.js fmt --check "src/**/*.sol"
```

A consuming repo's Makefile can do the same with a relative path, e.g. `node ../weld/dist/index.js …`.

### 4. From source, without building

To try a change without compiling, run straight from the TypeScript via `tsx`. Pass CLI args after
`--` so npm forwards flags like `--check`:

```sh
npm run dev -- fmt --check "src/**/*.sol"   # runs src/index.ts directly (no dist/ build needed)
```

See [Development](#development) for the full dev/test loop.

---

## Usage

```sh
weld init                 # write a weld.config.json with defaults into the current directory
weld lint                 # lint files matching the configured include globs
weld lint --fix           # lint, then auto-fix the fixable findings
weld fmt                  # format files in place           (alias of `weld format`)
weld fmt --check          # dry run: exit 1 if anything would change (CI-friendly)
weld rules                # list all rules and their severities
weld migrate              # upgrade weld.config.json to the current schema
```

Target specific files or rules:

```sh
weld lint "src/**/*.sol" --errors-only
weld lint "src/**/*.sol" --rules "naming/interface-i-prefix,structure/section-header-format"
weld fmt  "src/facets/aave/AaveFacet.sol"
```

---

## Configuration — `weld.config.json`

`weld init` writes a config you can edit. It is discovered by walking up from the current directory,
so one file at a repo root governs the whole project.

```jsonc
{
  "version": "1.0.0-rc.2",       // weld release that wrote this config (see Migrations)
  "solidity": {
    "spdx": "AGPL-3.0-or-later", // required SPDX license (e.g. "BUSL-1.1", "MIT"; null = any)
    "pragma": "^0.8.34"          // required pragma version (e.g. "0.8.30")
  },
  "format": {
    "lineLength": 120,           // wrap single-line decls over this width
    "collapseLength": 90,        // collapse a wrapped decl back to one line only when result ≤ this
    "sectionHeaderLength": 100,  // total width of /*** ... ***/ banners
    "mappingSpace": true         // true → "mapping (" ; false → "mapping("
  },
  "lint": {
    "rules": {
      "naming/interface-i-prefix": "error",
      "ordering/interface-members-alphabetical": "warn",
      "patterns/require-custom-errors": "off"
      // ... every rule, set to "error" | "warn" | "off"
    }
  },
  "include": ["src/**/*.sol", "test/**/*.sol", "script/**/*.sol"],
  "exclude": ["**/node_modules/**", "**/lib/**", "**/out/**", "**/cache/**"]
}
```

With no config file present, `weld` uses these same defaults.

### Versioning & migrations

The config's `version` is a **semver string** — the weld release that wrote it (prereleases like
`1.0.0-rc.1` / `1.0.0-beta` are supported and ordered correctly). When you upgrade `weld` and a newer
release changed the config shape, the old config is detected and migrated **in memory** automatically
(with a one-line notice), so commands keep working. Persist the upgrade with:

```sh
weld migrate          # rewrite weld.config.json at the current version
weld migrate --check  # exit 1 if a schema migration is pending (CI-friendly)
```

Migrations are a **version-keyed forward graph** (`src/config.ts` → `MIGRATIONS`): each edge upgrades
the config from one release to the next (`{ from, to, migrate }`). To upgrade, weld selects every edge
whose `to` is in `(yourVersion, currentVersion]` and applies them in ascending semver order — so a
config from any older release is carried forward across **multiple releases in one pass** (e.g.
`1.0.0 → 1.1.0 → 2.0.0`). You only ever write single-step `from → to` edges; weld composes them.

A config written by a **newer** weld than the one installed is left untouched with a warning (no
down-migration). Legacy configs from before semver versioning (or the earlier integer schema) are
treated as `0.0.0` and migrated forward.

Add a migration only when a release changes the config **shape** (rename/restructure/remove a field):
append an edge to `MIGRATIONS` with the release's version as `to`. Additive fields need no
migration — they're backfilled from defaults on load.

---

## Supply-chain hardening

- All dependencies are **pinned to exact versions** (no `^`/`~`); `.npmrc` sets `save-exact=true`.
- `package-lock.json` (with integrity hashes) is committed — install with **`npm ci`** for a
  reproducible, hash-verified dependency tree.

---

## Testing

```sh
npm test                 # idempotency gate (golden corpus) + transformation fixtures
npm run test:roundtrip   # round-trip recovery — flatten alignment, re-format, measure recovery
```

Two complementary suites (see [`test/run.mjs`](./test/run.mjs)):

- **Idempotency gate** — the golden corpus (`test/corpus/`) is a curated set of *canonical* files;
  formatting them must produce **no change**. This guards against drift: if a formatter change starts
  altering known-good code, it fails.
- **Transformation fixtures** (`test/fixtures/`) — *messy* `<name>.input.sol` files that must format
  to their hand-verified `<name>.expected.sol`. These prove weld actually **fixes** bad input (and
  that each expected output is itself a fixed point). Add a fixture by dropping in an `.input.sol`
  and its `.expected.sol` (fixtures are formatted with a source path, so source-only rules apply).

---

## Development

```sh
npm run dev -- <command>   # run from source via tsx, no build step (e.g. npm run dev -- lint src/Foo.sol)
npm run typecheck          # tsc --noEmit
npm run build              # compile to dist/
```

Adding a rule: implement it in `src/rules/<category>.ts`, register it in `src/linter.ts`, give it a
default severity in `src/config.ts` (`NATIVE_SEVERITY`), and document it in `STYLE.md`. Changing the
config shape in a release: bump the package `version`, and append a `{ from, to, migrate }` edge to
`MIGRATIONS` in `src/config.ts` (with the release's version as `to`).

---

## License

Copyright © River Credit Labs.

Licensed under the GNU Affero General Public License v3.0 or later (**AGPL-3.0-or-later**) — see the
[`LICENSE`](./LICENSE) file. This matches the Sky / PAU ecosystem.
