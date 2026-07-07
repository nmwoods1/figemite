# Contributing to Figemite

## Development setup

- Node 20 or newer (see `engines` in `package.json`).
- Install dependencies with `npm ci`.
- Before pushing, make sure these all pass:

```bash
npm run lint
npm run typecheck
npm test
npm run license:audit
```

## Monorepo conventions

This repository is an npm-workspaces monorepo built with TypeScript project
references (`tsc -b`). Packages live under `packages/*` and use the `@figemite/*`
scope.

**Project-reference rule (required):** when you add another workspace package
to a package's runtime dependencies, you must also add it to that package's
TypeScript project references. Concretely, whenever you add `@figemite/X` to a
package's `package.json` `dependencies`, you MUST also add
`{ "path": "../X" }` to that same package's `tsconfig.json` `references`.

Keeping `dependencies` and `references` in sync is what makes editor tsserver,
partial builds (`tsc -b`), and incremental rebuilds resolve cross-package
imports correctly. Skipping the reference entry appears to work only because of
stale `dist/` output and bundler-style module resolution, and will break as
soon as the referenced package changes.

## Forge

This repository is developed on GitHub — GitHub is canonical: issues, pull
requests, and CI (`.github/workflows/ci.yml`) all live there. `npm run
build:static` (see below) produces a `public/` bundle that happens to also
work unmodified on GitLab Pages; that's kept as a documented alternative
for anyone mirroring the repo there, not a second source of truth.

## Static builds

`npm run build:static` builds the client in read-only mode
(`VITE_READONLY=1`) and exports every board under `boards/` as static JSON,
replacing the repo-root `public/` with the result. This is the artifact CI
publishes to GitHub Pages. Two env vars control it:

- `FIGEMITE_BASE` — the Vite `base` path. Defaults to `/`; set to
  `/<reponame>/` for a project-subpath GitHub (or GitLab) Pages deploy.
- `FIGEMITE_BOARDS_DIR` — path to the boards root to export. Defaults to
  `<repoRoot>/boards`.

## Legacy oracle (local only)

`npm run oracle` runs `scripts/oracle.mjs` against a local legacy boards
directory to prove the current model can ingest real boards without silent
data loss. The boards directory is required — pass it as an argument or set
`ORACLE_BOARDS_DIR`; there is no default. It requires private local data that
CI does not have, so it is **not** run in CI — run it manually on a dev
machine after `npm run typecheck`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) — e.g.
`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`.
