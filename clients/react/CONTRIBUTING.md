# Contributing to tmai-react

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
`CHANGELOG.md` is **generated automatically** by [git-cliff](https://git-cliff.org/) — do not
hand-edit it.

| Prefix | CHANGELOG section | When to use |
|---|---|---|
| `feat:` | Added | New user-visible feature |
| `fix:` | Fixed | Bug fix |
| `docs:` | Documentation | Docs-only change |
| `perf:` | Changed | Performance improvement |
| `refactor:` / `style:` / `test:` / `chore:` / `build:` / `ci:` | *(omitted)* | Internal maintenance |

Breaking changes must add `!` after the type (e.g. `feat!:`) and include a `BREAKING CHANGE:` footer.

## Cross-linking api-spec upgrades

When a UI change depends on a new `tmai-api-spec` contract, include the api-spec version in the
commit body so git-cliff can surface it in the changelog:

```
feat: stream partial token deltas in TerminalPane

Requires tmai-api-spec >= 0.4.0 (adds PartialToken SSE event variant).
```

The current spec pin is visible under `dependencies` / `devDependencies` in `package.json`.

## Releasing

```bash
# Bump version, regenerate CHANGELOG, create git tag — all in one step.
npm version patch   # or: minor | major
git push --follow-tags
```

`npm version` runs the `version` lifecycle script, which calls `git-cliff --output CHANGELOG.md`
and stages the result before npm creates the version commit and tag.

On tag push, the [release workflow](.github/workflows/release.yml) re-runs git-cliff and pushes
a follow-up `[skip ci]` commit if the changelog differs (e.g. when the tag was pushed manually
without running `npm version`).

## Local changelog preview

```bash
# Preview unreleased entries without writing the file.
git-cliff --unreleased

# Full regeneration (requires git-cliff installed locally).
git-cliff --output CHANGELOG.md
```

Install git-cliff: <https://git-cliff.org/docs/installation>
