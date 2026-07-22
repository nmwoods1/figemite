# Releasing

This document is the release checklist / definition-of-done for cutting a
Figemite version. It covers the mechanical steps, the manual prerequisites
a human must do before the first real release, and the known follow-ups
intentionally deferred past v1.0.

## Versioning policy

Figemite follows [Semantic Versioning](https://semver.org): given a
`MAJOR.MINOR.PATCH` version, we bump

- **MAJOR** when we break a **public contract** (existing boards, connected
  agents, or configs stop working without a migration),
- **MINOR** when we **add** backward-compatible capability,
- **PATCH** for backward-compatible bug fixes.

**What is versioned.** The single released artifact is `@figemite/mcp` (and
the matching `vX.Y.Z` git tag that triggers `release.yml`). The other three
packages — `@figemite/{shared,server,client}` — are `"private": true`,
workspace-internal, and are **not** versioned independently; the git tag is
the version of the app as a whole.

**Public contracts.** These are the surfaces a change can *break*. A break in
any of them is a MAJOR bump; adding to any of them is a MINOR bump:

1. **The MCP tool contract** (`AGENTS.md`) — tool names, their required
   params, and return shapes. AI clients are wired directly to these. Tool
   names and required params are stable within a major version (adding a new
   tool, or a new *optional* param, is MINOR).
2. **The on-disk format** — `board.json`, `comments.json`, `tags.json`,
   `drafts.json`. Users commit these to git, so the format *is* an API. Note
   `board.json` carries a `formatVersion` (see
   `packages/shared/src/model/constants.ts`) with a migration path in
   `schema.ts`: if an old file can be **auto-migrated on load**, the change
   ships as MINOR; if old files would fail to load without user action, it's
   MAJOR.
3. **The `@figemite/mcp` package interface** — its env vars
   (`FIGEMITE_HTTP_URL`, `FIGEMITE_NAME`, `FIGEMITE_CLIENT`, …), the
   `figemite-mcp` bin/CLI, and (once published) the npm entry point.
4. **The HTTP/WebSocket server API** — `/api/*` routes and the Yjs room /
   sync protocol old clients depend on.
5. **Config & security defaults** — e.g. "binds to `127.0.0.1` by default";
   "LAN sharing and mDNS are off by default". Making a previously-off network
   surface on-by-default is a MAJOR (and security-relevant) change.

The **UI itself is not a versioned contract** — redesigning the toolbar,
adding a minimap, restyling nodes, etc. are features (MINOR), never breaks.

**Two tests that decide most cases.** Ask, before a release: *can a user
upgrade and have their existing boards, connected agents, and config keep
working untouched?* If yes → MINOR/PATCH; if they must migrate something →
MAJOR. Concretely:

- **The `board.json` test:** does a file written by the *old* version still
  open cleanly in the *new* one (directly, or via `migrate` in `schema.ts`)?
  If not → MAJOR.
- **The agent test:** does an MCP client configured against the old tool list
  still work? Removing/renaming/repurposing a tool → MAJOR; adding a tool →
  MINOR.

Prefer a migration over a break: when the on-disk format must change, add a
`formatVersion` bump plus a `migrate` step so old boards upgrade silently and
the release can stay MINOR.

## Release steps

1. **Push `main`.** Releases are cut from `main`. Every phase branch is
   already merged and `main` is tagged `v1.0.0`, so just `git push origin main`.
2. **Push the tag.** `git push origin v1.0.0` (annotated tags aren't
   pushed by a plain `git push`). This is the only trigger for
   `.github/workflows/release.yml` — it runs on `push: tags: 'v*'`.
3. **`release.yml` runs the gate, then cuts a GitHub Release.** On a tag push it:
   - installs (`npm ci`), lints, typechecks, tests, and runs the license
     audit and the prepublish reference audit (`npm run audit:refs`) —
     the same non-negotiable gate as CI, run again on the tag itself;
   - builds the `@figemite/mcp` bundle (`npm run -w @figemite/mcp build`);
   - cuts a GitHub Release from the tag with auto-generated release notes.

   **npm publishing is deferred:** the `npm publish` step in `release.yml`
   is commented out, so a tag push does NOT publish to npm. To enable it
   later, create the `@figemite` npm org, add an `NPM_TOKEN` GitHub Actions
   secret, and uncomment the "Publish @figemite/mcp to npm" step.

4. **Verify the release.** Confirm the GitHub Release was cut from the tag.
   (Once npm publishing is enabled, also confirm `@figemite/mcp` shows up on
   npm and that `npx -y @figemite/mcp` works from a clean environment.)

`@figemite/mcp` is the only package intended for npm — `@figemite/{shared,
server,client}` are `"private": true` and stay workspace-internal; users run
them from a clone (see `CONTRIBUTING.md`).

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
