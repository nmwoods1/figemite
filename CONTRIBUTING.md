# Contributing to easel

> "easel" is a placeholder codename and will be renamed before any public release.

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
references (`tsc -b`). Packages live under `packages/*` and use the `@easel/*`
scope.

**Project-reference rule (required):** when you add another workspace package
to a package's runtime dependencies, you must also add it to that package's
TypeScript project references. Concretely, whenever you add `@easel/X` to a
package's `package.json` `dependencies`, you MUST also add
`{ "path": "../X" }` to that same package's `tsconfig.json` `references`.

Keeping `dependencies` and `references` in sync is what makes editor tsserver,
partial builds (`tsc -b`), and incremental rebuilds resolve cross-package
imports correctly. Skipping the reference entry appears to work only because of
stale `dist/` output and bundler-style module resolution, and will break as
soon as the referenced package changes.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) — e.g.
`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`.
