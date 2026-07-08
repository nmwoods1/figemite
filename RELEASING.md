# Releasing

This document is the release checklist / definition-of-done for cutting a
Figemite version. It covers the mechanical steps, the manual prerequisites
a human must do before the first real release, and the known follow-ups
intentionally deferred past v1.0.

## Release steps

1. **Merge to `main`.** Releases are cut from `main`, not a phase branch.
   The `v1.0.0` tag was created on `phase-7`'s HEAD as part of the v1.0
   gate (see below) — merge that branch to `main` before pushing the tag,
   so `main` and the tag point at the same commit.
2. **Push the tag.** `git push origin v1.0.0` (annotated tags aren't
   pushed by a plain `git push`). This is the only trigger for
   `.github/workflows/release.yml` — it runs on `push: tags: 'v*'`.
3. **`release.yml` runs the gate, then publishes.** On a tag push it:
   - installs (`npm ci`), lints, typechecks, tests, and runs the license
     audit and the prepublish reference audit (`npm run audit:refs`) —
     the same non-negotiable gate as CI, run again on the tag itself;
   - builds the `@figemite/mcp` publish bundle
     (`npm run -w @figemite/mcp build`);
   - publishes `@figemite/mcp` to npm (`npm publish -w @figemite/mcp`,
     using the `NPM_TOKEN` secret);
   - cuts a GitHub Release from the tag with auto-generated release notes.
4. **Verify the publish.** Confirm `@figemite/mcp` shows up on npm at the
   tagged version and that `npx -y @figemite/mcp` works from a clean
   environment.

Only `@figemite/mcp` is published to npm — `@figemite/{shared,server,client}`
are `"private": true` and stay workspace-internal; users run them from a
clone (see `CONTRIBUTING.md`).

## Manual prerequisites (one-time, before the first real release)

These are outside this repo and must be done by a human with the right
account access before step 2 above can succeed:

- **Push `main` to GitHub.** The `origin` remote is configured to
  `https://github.com/nmwoods1/figemite.git`; `git push -u origin main`, then
  push the `v1.0.0` tag when ready to cut the release.
- **Repository URL is set.** `packages/mcp/package.json` and the READMEs point
  at `https://github.com/nmwoods1/figemite`.
- **Create the npm org/account** that will own the `@figemite` scope, and
  generate an `NPM_TOKEN` with publish rights to it.
- **Add `NPM_TOKEN` as a GitHub Actions secret** on the repository (Settings
  → Secrets and variables → Actions) so `release.yml` can authenticate to
  npm.
- **Add the hero GIF.** `README.md` references `docs/hero.gif` (a short
  screen-recording of the board in use) but the file doesn't exist yet —
  record one and drop it in `docs/` before the release is public-facing.
- **Double check GitHub Pages / GitLab Pages settings** if static hosting
  (`npm run build:static`) is going to be wired up as a CI/CD publish step
  beyond what's in this repo today.

## Definition of done for this gate (v1.0.0)

Verified as part of the P7-T41 release gate, on `phase-7` HEAD
(`a364b27`):

- **Prepublish reference audit**: `npm run audit:refs` — 292 tracked files
  scanned, zero forbidden references (prototype/company/personal
  identifiers and leftover `easel`-rename markers). This is the hard
  release blocker and it is clean.
- **Cold-clone build proof**: a pristine `git worktree` checkout (no
  reused `node_modules`) ran `npm ci`, `npm run typecheck`, `npm run
lint`, `npm test` (101 test files, 1518 tests, all passing), `npm run
build:static`, `npm run audit:refs`, and `npm run -w @figemite/mcp
build` — all green. `npm run test:e2e` (36 Playwright specs) also
  passed cleanly in the same worktree.
- **README quickstart proof**: `npm ci && npm run dev` in the main
  checkout brought up Vite and served both `/` and `/api/boards` on
  `http://127.0.0.1:5173` as documented.
- **MCP bundle smoke test**: the built `packages/mcp/dist/index.js` was
  spawned standalone and driven over stdio JSON-RPC (`initialize` +
  `tools/list`); it advertised exactly the expected 20 tools.
- **Local tag**: `v1.0.0` is an annotated tag on `phase-7` HEAD. It has
  **not** been pushed — pushing it is what triggers the real release (see
  above), and that should happen from `main`, not `phase-7`.

## Deferred to 1.1

These are known, real follow-ups surfaced during the build. None of them
block v1.0 — they're documented here so they aren't lost:

- **Accessibility baseline.** The toolbar (and canvas UI generally) has no
  systematic keyboard-navigation, focus-management, or ARIA-role pass.
  Mouse/touch interaction works; keyboard-only and screen-reader use does
  not have a defined baseline yet.
- **Orphaned-comments prune.** Deleting a node currently leaves any
  comments pinned to it in `comments.json` — they become "orphaned"
  (pinned to a node id that no longer exists) rather than being pruned or
  reattached. `CommentLayer.tsx` already has to account for this case at
  render time; there's no cleanup pass yet.
- **`updateNode` ghost-undefined-key parity fix.** `updateEdge` (in
  `packages/shared/src/crdt/ops.ts`) explicitly deletes a key when a patch
  sets it to `undefined`, so it never leaves a ghost own-enumerable
  `key: undefined` in the CRDT map. `updateNode`'s merge
  (`{ ...existing, ...patch }`) does not have the same guard — it should,
  for consistency and to avoid the same class of stale-undefined-key bug
  on the node path.
- **Systematic StrictMode non-resumable-resource audit.** Two related bugs
  were found and fixed in `BoardCanvas.tsx` where `<StrictMode>`'s
  mount → cleanup → re-mount double-invocation could tear down a
  non-resumable resource (e.g. a socket/connection) that the second
  invocation then couldn't reconstruct correctly — see the detailed
  comments around those fixes in that file. Both known instances are
  fixed, but there has not been a systematic sweep of the rest of the
  codebase for the same pattern (any `useEffect`/lazy-`useState` pairing
  a non-idempotent teardown with a resource that can't simply be
  recreated).
- **External-file-edit-during-a-live-room reconciliation.** If
  `board.json` is edited on disk (e.g. by hand, or by a script) while a
  room is live with connected peers, there is no defined reconciliation
  between the external edit and the in-memory CRDT state — the current
  behavior is whatever falls out of the file watcher and persistence
  layer's existing conflict handling, not a deliberately designed merge
  policy for this case.
