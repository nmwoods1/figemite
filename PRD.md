# Figemite — Product Requirements

This document is the durable behavioral contract for figemite: the capabilities and rules a
refactor must not break, independent of *how* the code is organized. It intentionally does not
describe UI mechanics (button placement, copy, exact colors) — those are free to change. It does
describe what a user (human or AI agent) must still be able to do, and what must remain true no
matter how the implementation is rearranged.

Content is derived from an audit of the shipped code and its test suite (2026-07-23), not from
aspiration. Every requirement below is either **Shipped** (verified true today) or marked
**🔜 Planned** (designed, not yet reachable in the running app). See [§6 Marker legend](#6-marker-legend).

## Table of contents

1. [Thesis & non-goals](#1-thesis--non-goals)
2. [Actors & trust model](#2-actors--trust-model)
3. [Capabilities by domain](#3-capabilities-by-domain)
4. [Cross-cutting invariants](#4-cross-cutting-invariants)
5. [Known gaps & open questions](#5-known-gaps--open-questions)
6. [Marker legend](#6-marker-legend)

---

## 1. Thesis & non-goals

Figemite is a **local-first, collaborative whiteboard**. It runs on the user's own machine,
supports real-time multiplayer with live cursors, and lets an AI agent edit the board alongside
humans as a peer over MCP.

**What it commits to:**
- **Plain, git-diffable JSON on disk** — no server-side database. Every board is a directory of
  JSON files a human can read, diff, and version-control directly.
- **Local-first & private by default** — the server binds to loopback; LAN sharing is an
  explicit opt-in, not a default.
- **AI as a first-class, structurally-limited peer** — an agent joins with its own cursor and
  identity and edits like a real collaborator, but is architecturally incapable of publishing to
  the board of record without a human's deliberate act.

**What it deliberately refuses to be (non-goals, not gaps):**
- Not a Figma plugin, despite the name — an independent, standalone whiteboard.
- No authentication/authorization layer. `SECURITY.md` states this outright: any peer that can
  reach the server has full read/write/delete access to every board it hosts. This is a conscious
  trust-boundary choice (see [§2](#2-actors--trust-model)), not an oversight to "fix" incidentally
  during a refactor.
- No MCP tool for **promote**, **approve**, **comments**, or **tags** — permanent, not a backlog
  item. AGENTS.md is explicit: "Don't ask for one; it won't be added."
- No per-board roles (owner/collaborator/viewer) and no audit log of who changed what.

---

## 2. Actors & trust model

There are three actors, with deliberately asymmetric power — this asymmetry is the spine the rest
of the document hangs off:

| Actor | Connects via | Can do | Cannot do |
|---|---|---|---|
| **Human** | Browser client | Create boards, create/edit/rename/discard drafts, **promote a draft to Live**, restore history (on a draft), add comments/tags/annotations to Live or a draft | Edit Live *content* directly (must go through a draft) |
| **AI agent** | MCP (`packages/mcp`) | Create boards, create drafts, edit draft content (nodes/edges), read Live | Promote, discard, rename a draft, restore history, add/read comments or tags, add annotations — **no tool exists for any of these** |
| **Raw HTTP client** | Direct REST calls, bypassing the browser UI and MCP tool surface | Everything the API technically allows (see [§5](#5-known-gaps--open-questions) — some endpoints have looser guards than the UI/MCP surfaces built on top of them) | — |

**There is no verified identity underneath any of this.** Confirmed in `SECURITY.md` and by
grepping the server for `owner`/`role`/`permission`/`auth`: there is no "board owner" concept, no
per-board permissions. A display name is a self-chosen, unenforced `localStorage` value
(`packages/client/src/lib/identity.ts`). A draft's `createdBy: 'human' | 'agent'` field is
explicitly documented as informational provenance, not a security boundary
(`packages/shared/src/model/drafts.ts:11-15`). An MCP peer's `isAI: true` awareness flag is
**self-asserted by the connecting client**, not verified by the server.

**In short: the human/agent asymmetry is enforced by which door you come through (tool-surface
omission), not by verified identity.** A human using the browser UI is limited by what the UI
exposes; an agent using MCP is limited by which of the 23 tools exist and what they guard; a raw
HTTP client is limited only by what the API endpoints themselves check. This distinction matters
for any refactor that consolidates or re-exposes these surfaces.

---

## 3. Capabilities by domain

### 3.1 BRD — Boards & navigation

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| BRD-1 | Any user can create a new board via a name → slug flow; the slug becomes the literal `boards/<slug>/` directory name and must match `^[A-Za-z0-9_-]+$`. | Shipped | ✅ | `NewBoardModal.tsx`, `packages/server/src/api/handlers/boards.ts` |
| BRD-2 | A new board is seeded empty: `formatVersion: 1`, empty `nodes`/`edges`, default viewport. Creation goes through the same write funnel as every other save (so it also records an initial history snapshot). | Shipped | ✅ | `packages/shared/src/board-io.ts` (`emptyBoard`), `router.test.ts:113-123` |
| BRD-3 | Creating a board with a slug already in use fails (409); slugs `tag` and `untagged` are reserved. | Shipped | ✅ | `boards.ts:81-87`, `router.test.ts:400-409` |
| BRD-4 | **A board cannot be renamed. A whole board cannot be deleted** — no UI control, no API route exposes it (the underlying repository primitive that could is deliberately not wired to HTTP). This is a real product boundary, not an oversight — do not assume either capability exists. | Shipped (absence) | ✅ | `board-repo.ts:79-99` (comment: "deliberately does NOT expose it"), `router.test.ts:415-422` |
| BRD-5 | The dashboard lists boards filterable by tag, with an "Untagged" pseudo-filter; boards can be tagged/untagged via a hover-revealed editor. Tags are normalized (trimmed/lowercased/deduped) before saving. | Shipped | ✅ (tag CRUD) / ⚠️ (normalization has no isolated unit test) | `Dashboard.tsx`, `TagEditor.tsx`, `packages/client/src/lib/tags.ts` |
| BRD-6 | Each board shows a human-relative last-modified time, derived from the root `board.json`'s file mtime. | Shipped | ✅ | `Dashboard.tsx:27-43` |
| BRD-7 | A display name is persisted in `localStorage` and survives across sessions; it is a **soft** prompt to view/edit a board (dismissible without a name, falls back to a generated `guest-xxxxx` identity) but a **hard** gate the first time a user tries to add a comment. | Shipped | ✅ | `identity.ts`, `App.tsx:49-57`, `CommentLayer.tsx:258-276` |
| BRD-8 | All write affordances (new board, tag editor, delete) are hidden in read-only/static-export mode. | Shipped | ✅ | `Dashboard.tsx`, `TagList.tsx` |
| BRD-9 | Any node can drill into its own nested sub-board. The badge to open one is always visible once it exists (even read-only); the affordance to *create* one only appears, and only succeeds, from within a draft — never on Live, never in read-only. | Shipped | ✅ (unit/component) / ⚠️ (no browser e2e for the drill-in click-through itself) | `DrillInBadge.tsx`, `App.tsx:217-244` |
| BRD-10 | Sub-boards persist as dotted-path sibling files (`board.<seg1>.<seg2>....json`) next to the parent, never nested inside it; each path segment is validated against the id grammar and traversal-checked before use. | Shipped | ✅ | `packages/server/src/repository/paths.ts` |

### 3.2 CANVAS — Canvas authoring

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| CANVAS-1 | Exactly 7 node types exist: sticky, text, shape, frame, emoji, icon, drawing. All but "drawing" are toolbar-creatable; drawing nodes are created only by committing a pencil stroke, never via a toolbar button. | Shipped | ✅ | `packages/client/src/nodes/index.ts:17-25`, `Toolbar.tsx:291-375` |
| CANVAS-2 | Shape nodes support exactly 12 kinds (rect, roundRect, ellipse, diamond, triangle, parallelogram, hexagon, pentagon, star, cylinder, cloud, arrow). | Shipped | ✅ | `packages/shared/src/model/board.ts:37-49` |
| CANVAS-3 | An edge's kind is either "arrow" (with an arrow style: none/forward/back/both) or "cardinality" (with a 1:1/1:N/N:1/N:N label, no arrowheads); either kind can be solid or dashed and carry an optional label. Switching kind preserves/defaults the other field sensibly. | Shipped | ✅ | `board.ts:11-18`, `EdgeControls.tsx`, `board-mutations.test.ts:394-517` |
| CANVAS-4 | Edges are created only by dragging between a node's fixed connection-point handles — there is no floating/boundary-following attachment yet (see CANVAS-P1). | Shipped | ✅ | `interaction.spec.ts:594-652` |
| CANVAS-5 | Sticky/shape/frame nodes support a "cycle color" action over a fixed palette; other node types do not. Rotation is supported only for shape/emoji/icon nodes. | Shipped | ✅ | `Toolbar.tsx:204-227`, `rf-adapters.test.ts:378-412` |
| CANVAS-6 | Any node type can carry an optional Markdown description, authored in a rich-text (TipTap) modal and stored as a plain Markdown string. On a content-locked (Live) board, descriptions remain viewable but not editable. | Shipped | ✅ | `board.ts:58-63`, `DescriptionModal.tsx`, `description-mode.ts` |
| CANVAS-7 | Multi-select supports group resize/scale; nodes have an explicit z-order adjustable via keyboard shortcuts. | Shipped | ✅ | `useMultiSelectResize.ts`, `interaction.spec.ts:832,927` |
| CANVAS-🔜1 | (Planned) Dragging/resizing a node will snap to a grid, with a user-facing on/off toggle. Today snapping only happens at toolbar-creation time and for Shift-held pencil strokes. | 🔜 Planned | — | `docs/superpowers/plans/2026-07-22-grid-snapping.md` |
| CANVAS-🔜2 | (Planned) Edges will optionally attach to a node's boundary point facing the other node ("floating" attachment) and carry a per-edge routing style (bezier/straight/elbow). | 🔜 Planned | — | `docs/superpowers/plans/2026-07-22-floating-arrow-edges.md` |

### 3.3 OVL — Overlays (comments, annotations, pencil)

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| OVL-1 | A comment targets either a specific node (with an offset from its center, so it tracks the node if moved) or a bare canvas position. | Shipped | ✅ | `packages/shared/src/model/comments.ts`, `CommentLayer.tsx:244-255` |
| OVL-2 | Any user can reply to a comment (replies accumulate, none individually deletable) and toggle resolve/reopen on a comment. Deleting a comment removes it and all its replies. All comment mutations are no-ops in read-only mode. | Shipped | ✅ | `useComments.ts` |
| OVL-3 | Comments persist to a per-board-**version** `comments.json`, independent of `board.json` — so an AI agent rewriting board content never touches the discussion, and a draft's comments never bleed into Live's (or another draft's) and vice versa. | Shipped | ✅ | `comments.ts`, fixed by commit `e63fd3a` |
| OVL-4 | Annotation strokes sync live across connected peers (same shared CRDT doc as content) but are **never** written to `board.json` on any board version — enforced structurally: the snapshot function that produces persisted content never reads the annotation store, not by a filter applied afterward. "Wipe" clears annotations for every connected peer. | Shipped | ✅ (direct unit + e2e assertion) | `AnnotationLayer.tsx`, `AnnotationLayer.test.tsx:209-222`, `overlays-history.spec.ts:538` |
| OVL-5 | Pencil strokes commit as ordinary, persisted drawing nodes (unlike annotations) and are hidden as a toolbar mode on the content-locked Live board (since they'd create persisted content there); annotations and comments remain available on Live. | Shipped | ✅ | `PencilLayer.tsx`, `overlays-history.spec.ts:472` |
| OVL-6 | Comment, pencil, and annotation toolbar modes are mutually exclusive — activating one deactivates the others. | Shipped | ✅ | `Toolbar.test.tsx:501-511` |

### 3.4 COLLAB — Collaboration & presence

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| COLLAB-1 | Node/edge content (position, size, text, color, structure) syncs live to every connected peer via a shared Yjs CRDT doc; position and text live in separate CRDT keys so a concurrent drag and a concurrent text edit on the same node never collide. | Shipped | ✅ | `packages/shared/src/crdt/schema.ts`, `multiplayer.spec.ts:206-353` |
| COLLAB-2 | Presence (cursor, editing-node, viewport) is carried on ephemeral Yjs "awareness" state — never persisted, vanishes on disconnect. Cursor position is throttled to ~30Hz before publishing. | Shipped | ✅ | `usePresence.ts` |
| COLLAB-3 | The "who's here" panel shows every connected user's name and color, marks the local user, and shows a distinct AI badge/diamond cursor (vs. an arrow) for any peer whose awareness state self-reports `isAI: true`. There is no idle/active distinction — a peer is simply present or absent. | Shipped | ✅ (incl. over the real wire protocol) | `ActiveUsersPanel.tsx`, `PresenceLayer.tsx`, `ai-peer-gate.test.ts:262-313` |
| COLLAB-4 | Follow-mode is triggered by an explicit "Follow" action per user (one followed peer at a time); it snaps the follower's viewport to match the leader's exactly, with no animation, on every leader viewport change. Any manual pan/zoom, pressing Escape, or the leader disconnecting immediately cancels it. | Shipped | ✅ | `useFollowMode.ts`, `multiplayer.spec.ts:467-524` |
| COLLAB-5 | Undo/redo is scoped strictly to the local client's own edits (tracked by CRDT transaction origin) — it is **not** a shared/global stack and can never touch a remote peer's (human or AI) transaction. A single logical multi-field edit undoes as one step; rapid edits within ~400ms coalesce into one step; the stack soft-caps at 100 entries; it's cleared on an external on-disk change or a history restore. | Shipped | ✅ (local-only scoping directly tested) / ❓ (100-entry cap untested) | `useUndoRedo.ts`, `useUndoRedo.test.ts:103-149` |
| COLLAB-6 | The sync-status indicator shows exactly three states — connecting / synced / offline. There is no separate "error" or "saving" state. | Shipped | ✅ | `useSyncStatus.ts` |
| COLLAB-7 | An offline client-side cache (IndexedDB) exists only for draft rooms, never for Live — so a stale local cache can never revert a promoted Live board. | Shipped | ✅ (cache-attachment behavior) / ❓ (no test drives a full offline-edit-then-reconnect scenario for content) | `realtime.ts`, `realtime.test.ts:177-195` |
| COLLAB-8 | Concurrent edits to different nodes, or different fields of the same node, always merge independently. Concurrent edits to the **same** field of the same node are last-write-wins over the whole value (Yjs does not merge inside a plain object) — this is intentional, not a bug. A concurrent delete-vs-edit race on the same node always resolves to a self-consistent board (no dangling edges/orphaned text), regardless of which side "wins." | Shipped | ✅ (fuzz-tested, 300 randomized runs) | `convergence.fuzz.test.ts` |
| COLLAB-9 | A human and an AI agent editing the same board concurrently use the identical CRDT merge path — there is no special-cased merge logic for AI vs. human writes. | Shipped | ✅ | `ai-peer-gate.test.ts` |
| COLLAB-10 | The advisory "AI lock" that gates the human UI while an agent session is active is a **UX-only affordance** — it does not prevent a human from editing concurrently through a different client, and it is not a CRDT- or server-enforced write lock. If a human bypasses it, ordinary CRDT merge rules (COLLAB-8) apply. | Shipped | ⚠️ (inferred from the absence of a server-side write gate, not positively tested) | `useAiLock.ts`, `ai-session.ts` |

### 3.5 GOV — Versioning & governance

This is the highest-stakes domain: the mechanism that makes "AI as a safe peer" true.

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| GOV-1 | Live board **content** (nodes/edges) is read-only for direct editing, for humans and AI agents alike. To make a change, an actor creates a **draft** — a full, independently-editable copy at `boards/<slug>/.drafts/<draftId>/`, including its own forked copy of the comment thread. | Shipped | ✅ | `packages/server/src/api/handlers/drafts.ts` |
| GOV-2 | A human reviews a draft and **promotes** it, which overwrites Live's content: prod sub-boards absent from the draft are deleted, `boardLabel`/viewport are preserved, the comment thread is replaced with the draft's, and `tags.json` is left untouched (tags are Live-only, see GOV-8). The prior Live state is archived as a permanent, un-thinned history entry — there is no separate "undo promote" feature; rolling back a promote means restoring that immediately-preceding history entry. | Shipped | ✅ | `packages/server/src/api/handlers/promote.ts` |
| GOV-3 | A promoted draft is **kept by default** — deleting it requires an explicit opt-in at promote time. A draft can also be independently discarded (deleted without promoting). | Shipped | ✅ | `promote.ts:24-28,150-158` |
| GOV-4 | Every board version (Live, and each draft independently) has a browsable, restorable snapshot history. Browsing/previewing a snapshot is fully read-only and isolated from the live document — it never mutates the doc you're viewing. | Shipped | ✅ | `useHistory.ts`, `snapshot-history.ts` |
| GOV-5 | **Restoring** a snapshot is only ever offered on a draft, never on Live — there is no server-side "restore" endpoint at all; restore is a client-side CRDT write into whichever room the current pane is joined to, and the Live pane's restore control is hidden and replaced with "create a draft to restore." | Shipped | ✅ | `BoardCanvas.tsx`, `useHistory.test.ts:139-256` |
| GOV-6 | Live-content-read-only is enforced independently at three surfaces: **client** (interaction/React-Flow-prop gating — not a data-layer guard), **server** (a prod room's CRDT updates sync live in memory but are never persisted to disk or snapshotted; only a promote writes prod's `board.json`), and **MCP** (every content-mutating tool throws unless the connection is scoped to a draft). See [§5](#5-known-gaps--open-questions) for one known exception to this guarantee. | Shipped | ✅ (all three layers individually tested) | `BoardCanvas.tsx`, `yjs-ws.ts:298-312`, `packages/mcp/src/server.ts:171-181` |
| GOV-7 | Comments and annotations are exempt from Live-read-only **for humans** — they are one of the only kinds of write allowed directly on Live. This exemption does not extend to AI agents: there is no MCP tool for comments or annotations at all (enforced by omission, not a guard check). | Shipped | ✅ (human path) / ⚠️ (agent-omission verified by code audit, not a dedicated negative test) | `comments.ts` (no lock check), `packages/mcp/src/server.ts` (no such tool registered) |
| GOV-8 | Tags are Live-only — a draft never carries its own tag set, and promoting a draft never touches Live's tags. | Shipped | ⚠️ (asserted by design/absence of a `draftId` param on the tags path, no dedicated test) | `paths.ts` |
| GOV-9 | There is no "board owner" or "collaborator" role. A draft's `createdBy: 'human' \| 'agent'` field is self-declared provenance for UI display only, never a security boundary. | Shipped | ❓ (documentation-level guarantee; hard to test a negative) | `SECURITY.md`, `packages/shared/src/model/drafts.ts:11-15` |
| GOV-10 | Promoting is gated on there being no active AI-editing lock on the board (409 if locked), preventing a promote from racing a live agent session. | Shipped | ✅ | `promote.ts:75-77` |

### 3.6 AI — MCP agent surface

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| AI-1 | The MCP tool surface is exactly 23 tools (connection/discovery, board/draft creation and listing, read/presence, and 10 content-mutation tools) — no more, no fewer. This exact list is drift-tested: adding, removing, or renaming a tool fails the test suite. | Shipped | ✅ | `packages/mcp/src/server.ts`, `server.test.ts:116-147` |
| AI-2 | Every one of the 10 content-mutating tools (add/update/move/delete node, add/update/delete edge, set text/description, add drawing) requires the connection to be scoped to a draft; called against a Live connection, each throws a "read-only, create a draft" error instead of mutating. Read and presence tools work against a Live connection. | Shipped | ✅ (unit + end-to-end against a real server) | `server.ts:171-181`, `ai-peer-gate.test.ts` |
| AI-3 | No MCP tool exists (and per project policy, may never exist) for promote, approve, comments, or tags. | Shipped | ✅ (promote/approve: dedicated negative test) / ⚠️ (comments/tags: verified by code audit, no dedicated negative test) | `server.test.ts:159-166`, `AGENTS.md` |
| AI-4 | An agent can create a brand-new board and can create its own draft on any board without a human creating it first — the human's role is **approving** (promoting) a draft, not originating one. | Shipped | ✅ | `board-http.ts`, `server.ts:328-392` |
| AI-5 | A board an agent just created is immediately Live and therefore read-only over MCP just like any other board — the agent must still create a draft before adding content to it. | Shipped | ⚠️ (logically implied by AI-2's guard; no dedicated test exercises this exact create→edit-without-draft sequence) | `server.ts:171-181` |
| AI-6 | An agent's connection carries a self-asserted `isAI: true` awareness flag and is rendered distinctly in the presence UI (diamond cursor, AI badge) — verified at the wire-protocol level against a real independent observer, not just at construction. This is a display convention, not a server-verified identity. | Shipped | ✅ | `packages/mcp/src/peer.ts`, `ai-peer-gate.test.ts:262-313` |
| AI-7 | There is no AI-specific rate limit or connection cap. The only size guard is a generic 8MB HTTP body cap applied identically to every REST caller, agent or browser. | Shipped | ✅ | `packages/server/src/http/body.ts` |
| AI-8 | Tool names and required parameters are stable within a major version (adding a tool or an optional parameter is a MINOR change; renaming/removing a tool or promoting an optional parameter to required is MAJOR). | Shipped (policy) | — | `RELEASING.md` |
| AI-🔜1 | (Planned) `add_edge`/`update_edge` will accept an optional `routing` parameter (bezier/straight/elbow), additive per the MINOR-version policy. | 🔜 Planned | — | `docs/superpowers/plans/2026-07-22-floating-arrow-edges.md` (Task 7) |

### 3.7 DATA — Persistence & format

| ID | Requirement | Status | Coverage | Ref |
|---|---|---|---|---|
| DATA-1 | A board is a directory of plain JSON files: root `board.json`, one dotted-path file per sub-board, `comments.json` (per version), `tags.json` (Live-only), `drafts.json` (index), plus `.history/` and `.drafts/<id>/` working directories. Any file except `board.json` is optional and treated as empty if absent. | Shipped | ✅ | `packages/server/src/repository/paths.ts` |
| DATA-2 | `board.json`'s schema is `{ formatVersion, boardLabel, viewport, nodes[], edges[] }`. Serialization is canonical and deterministic — two logically-identical boards with differently-ordered arrays serialize to byte-identical JSON, which is load-bearing for the dual-writer (browser + MCP) guarantee. | Shipped | ✅ | `packages/shared/src/board-io.ts` |
| DATA-3 | Every board write is atomic (temp file + rename) — the file on disk is never observed half-written. | Shipped | ✅ | `board-repo.ts` |
| DATA-4 | A board with no `formatVersion` ("legacy v0") is migrated automatically on read (missing per-node `order` is stamped from array index, `formatVersion` is set to current). A `formatVersion` newer than the running build's is a hard, explicit error rather than a silent data-mangling attempt. | Shipped | ✅ (legacy migration) / ⚠️ (future-version rejection has no dedicated test) | `packages/shared/src/model/schema.ts` |
| DATA-5 | Every path (slug, sub-board segment) is validated against a strict id grammar and, separately, checked to resolve inside the boards root — double-defended against path traversal. | Shipped | ✅ | `paths.ts` |
| DATA-6 | A static, fully read-only export mode exists (`npm run build:static`) for hosting on GitHub/GitLab Pages: it includes every board's content, sub-boards, comments, and tags, plus an index manifest, but **excludes drafts and history entirely**. Every write operation in this mode throws immediately client-side rather than attempting a network call; listing drafts resolves to an empty list rather than throwing. | Shipped | ✅ (write-blocking) / ⚠️ (drafts/history exclusion inferred from source, no negative test) | `packages/server/src/static-export.ts`, `boards-api.ts` |

---

## 4. Cross-cutting invariants

These are the negative-space rules — the ones a refactor is most likely to break by accident,
because nothing forces you to look at them; they're what *doesn't* happen.

- **INV-1 — Live board content changes only via a human-triggered promote.** True for the browser
  client and the MCP tool surface. **Known exception:** a raw HTTP client hitting the legacy
  `POST /api/board` endpoint directly can currently write to Live content unconditionally — see
  [§5](#5-known-gaps--open-questions).
- **INV-2 — An AI agent can never write to Live, comments, tags, or annotations.** For content
  this is an active guard (`assertEditable`); for comments/tags/annotations it's simpler and
  stronger — no MCP tool for any of them exists at all.
- **INV-3 — Comments are scoped per board version.** A draft's comment thread and Live's never
  bleed into each other; each draft forks its own copy at creation and replaces Live's at promote.
- **INV-4 — Annotations sync live but are never persisted, on any board version; pencil strokes
  are always persisted.** This is structural (the persistence snapshot function has no knowledge
  of the annotation store), not a filter that could be quietly removed.
- **INV-5 — Boards remain plain, git-diffable JSON files; comments and tags live in files separate
  from board content**, specifically so an AI agent rewriting board content structurally cannot
  touch human discussion or categorization.
- **INV-6 — Undo/redo is scoped to the local client's own edits only.** It is never a shared
  stack and must never be able to undo a remote peer's (human or AI) transaction.
- **INV-7 — `formatVersion` only ever migrates forward for recognized older versions; an unknown
  newer version must hard-fail, never silently mangle data.**
- **INV-8 — Tags are Live-only and never fork into a draft.**
- **INV-9 — There is no authentication or authorization layer anywhere in the system.** Access
  control is purely architectural (which tools/endpoints exist, what they individually guard) —
  never identity-based. If a future refactor introduces auth, every requirement in this document
  that currently reads "enforced by omission" must be revisited, not assumed to still hold.

---

## 5. Known gaps & open questions

Found during this audit; not requirements, but items worth a deliberate decision rather than an
accidental fix or accidental worsening during a refactor.

1. **`POST /api/board` has no draft/read-only guard at all.** Unlike every other write path, this
   legacy endpoint checks only the AI-editing lock and then writes directly to Live's
   `board.json`. No current client (browser or MCP) calls it, but it is live and reachable by any
   raw HTTP client — meaning INV-1's guarantee holds for the shipped clients, not as an absolute
   property of the server. (`packages/server/src/api/handlers/board.ts`)
2. **One test is currently failing**, not just uncovered: the multi-instance MCP registry's
   "drops a server once it's closed" case
   (`packages/mcp/src/mcp-server-integration.test.ts`) — reproducibly fails on rerun. Treat
   registry eviction as **not currently proven**, whatever the code appears to do.
3. **AGENTS.md claims the server "auto-ends stale AI sessions,"** but the only auto-end mechanism
   found (`AiSessionManager`, a 5-minute timer gated behind `/api/ai/begin`) is never called by
   the MCP server. What actually happens to an MCP peer's presence when its process dies without
   calling `disconnect` is unverified — likely just the underlying Yjs/y-websocket library's
   generic stale-client handling, not anything AI-specific.
4. **The `/api/ai/begin` / `/api/ai/end` lock mechanism's purpose is unclear.** It's fully
   implemented and tested in isolation, but nothing in the current client or MCP server calls it.
   Worth asking the team whether it's a deliberate escape hatch for a future non-MCP AI
   integration, or dead scaffolding from a pre-draft architecture.
5. **No test drives a full offline-edit-then-reconnect scenario** for board content — the
   "edits made offline are never lost" guarantee rests on Yjs's own documented behavior, not on
   anything this codebase's test suite exercises directly.
6. **No browser (e2e) test exercises the drill-in click-through into a sub-board.** Coverage is
   solid at the unit/component level, but the actual multi-step user flow has never been driven
   in a real browser.
7. **No dedicated negative test guards against a comments/tags MCP tool being added** (unlike the
   promote/approve omission, which has one). If GOV-7/AI-3 are load-bearing, consider adding one.

---

## 6. Marker legend

- **Status:** unmarked = **Shipped** and verified true today. **🔜 Planned** = designed, not yet
  reachable in the running app (see `docs/superpowers/plans/`).
- **Coverage** (shipped requirements only): **✅** — asserted by an automated test I located and
  read. **⚠️** — partially covered, or covered only indirectly/by inference from code structure.
  **❓** — no automated test found; true as far as a manual code read can establish.
- Requirement IDs (`REQ-DOMAIN-N`, `INV-N`) are stable — reference a specific one in a PR or test
  rather than re-describing the behavior in prose.
