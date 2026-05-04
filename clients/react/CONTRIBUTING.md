# Contributing to clients/react

`clients/react/` is the reference React WebUI inside the `trust-delta/tmai`
monorepo. Day-to-day workflow lives in the [project hub
`CONTRIBUTING.md`](../../CONTRIBUTING.md) (local setup, branch naming, PR
conventions, bot PR recovery flow). This file just documents the React-
specific bits that don't fit there.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
`CHANGELOG.md` is **hand-maintained** with a `git-cliff` skeleton (run
`pnpm changelog` to seed the section, then add the bundled-tag annotation
and rewrite the footer reference link to the bundle tag — see the comment
block at the top of `cliff.toml` for the exact two-step). The release
workflow lives in tmai-core and the bundle tarball, not here.

| Prefix | CHANGELOG section | When to use |
|---|---|---|
| `feat:` | Added | New user-visible feature |
| `fix:` | Fixed | Bug fix |
| `docs:` | Documentation | Docs-only change |
| `perf:` | Changed | Performance improvement |
| `refactor:` / `style:` / `test:` / `chore:` / `build:` / `ci:` | *(omitted)* | Internal maintenance |

Breaking changes must add `!` after the type (e.g. `feat!:`) and include a
`BREAKING CHANGE:` footer.

## Cross-linking api-spec upgrades

When a UI change depends on a new wire contract shape, include the
`api_spec` version (see `versions.toml` at the monorepo root) in the
commit body so reviewers can cross-check:

```
feat: stream partial token deltas in TerminalPane

Requires api_spec >= 2.3.0 (adds PartialToken SSE event variant).
```

The contract itself lives at `api-spec/` in this repo and is regenerated
from `tmai-core` via the `gen-spec-pr` bot PRs (see
[`src/types/README.md`](src/types/README.md) for how the TypeScript
mirror in `src/types/generated/` stays in sync).

## Versioning

The `tmai-react` package is private (`publish = false`); its version is
independent of any npm publication. Each `v<X.Y.Z>` tag on the monorepo
pins a specific React version via [`versions.toml`](../../versions.toml).
Bumping the React version is a stand-alone step:

```bash
# Edit clients/react/package.json — bump "version".
# Edit versions.toml at the repo root — bump "react".
# Both edits land in the same commit, on a docs/ or chore/ branch.
```

The bundle tarball release is then triggered from
[`trust-delta/tmai-core`](https://github.com/trust-delta/tmai-core)'s
release workflow, which pins the React version from `versions.toml`,
builds the WebUI, and ships the assets in `share/tmai/webui/` of the
final tarball.

## Local changelog preview

```bash
# Preview unreleased entries without writing the file.
pnpm exec git-cliff --unreleased

# Full regeneration (still requires hand-editing afterward —
# annotate the bundled tag, rewrite the footer reference link;
# see cliff.toml for the two-step).
pnpm changelog
```

Install git-cliff: <https://git-cliff.org/docs/installation>
