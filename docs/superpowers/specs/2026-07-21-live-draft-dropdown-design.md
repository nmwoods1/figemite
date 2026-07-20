# Live/Draft dropdown + live board is read-only — design

**Date:** 2026-07-21
**Status:** Approved (pending spec review)

## Problem

Two problems, one feature:

1. **The draft UI is clunky.** It is two floating pieces that fight the top-left
   breadcrumb: `DraftsMenu.tsx` (a "Drafts (N) ▾" button at the top-right, prod
   root only) and `DraftBanner.tsx` (a full-width purple bar at `top:0` that
   overlays the breadcrumb inside a draft, using `window.confirm`).

2. **The live board is freely editable.** Today both humans and agents can edit
   prod content directly; drafts are only *preferred* (via MCP prompt text and a
   human-only promote). Nothing actually prevents editing the live board.

## Goal

- Fold the draft UI into a single **"Live ▾" dropdown embedded in the top-left
  breadcrumb**, with per-draft Promote/Discard behind real confirmation modals.
- Make the **live board read-only for board content** — nodes, edges, frames,
  text, shapes, drawings. The **only** allowed writes on the live board are
  **comments and annotations**. To change content you must create a draft; a
  human promotes it to update live. Enforced in the **client, server, and MCP**.

## Decisions (from brainstorming)

- Per-draft-row Promote/Discard (any draft actionable without opening it).
- Pill shows on all routes (root + sub-boards), dev-mode only.
- Clicking the "Live" row exits a draft back to the live board.
- Enforcement is at **all three layers** (client UI + server persistence + MCP),
  not client-only.

## Key architecture facts (verified)

- **Annotations** (`AnnotationLayer`) ride the doc's `ANNOTATIONS` `Y.Array`: they
  sync across peers but are **never persisted** (`getSnapshot` reads only
  nodes/edges). So they keep working regardless of content-lock or server freeze.
- **Comments** live in a separate `comments.json` with their own API — unaffected.
- **Board content** (nodes/edges) is persisted by `yjs-ws.ts`'s debounced
  persist-on-update, per room, keyed by `(slug, subPath, draftId?)`.
- **Promote** (`handlePromoteDraft`) pushes approved content into the live prod
  room via `replaceRoomContent` and *relies on the prod room's own persist* to
  write disk (falling back to a direct disk write only when no room is connected).
- **MCP** routes every tool through a single `assertConnected()` gate; the peer
  already carries its `draftId` (`connect_board`'s `draft` param).
- The client already has an `aiLocked` "editing paused" path that disables RF
  interaction — a ready template for the content-lock.

## Design

### Part A — Client: the Live/Draft dropdown

- **New `LiveDraftMenu.tsx`** — owns all draft logic (`listDrafts`, `createDraft`,
  `promoteDraft`, `discardDraft`); renders the pill + dropdown + confirm modals.
  Single replacement for both deleted components.
- **New `ConfirmModal.tsx`** — a small generic confirmation dialog mirroring
  `NewBoardModal` (fixed backdrop, click-out + Escape to cancel, white card,
  Cancel + a coloured Confirm). Reused for Discard and Promote.
- **Edit `Breadcrumb.tsx`** — add optional `draftControl?: React.ReactNode`,
  rendered as the trailing item in its flex row. Breadcrumb stays presentational.
- **Edit `App.tsx` (`BoardRoute`)** — build `<LiveDraftMenu>` and pass it as
  `draftControl` on every route, gated `!READONLY`. Remove the `DraftsMenu` and
  `DraftBanner` renders. Thread `onOpenDraft` / `onExitDraft` unchanged.
- **Delete `DraftsMenu.tsx` and `DraftBanner.tsx`.**

Pill states:
- **Live (no `draftId`):** green dot + "Live" + chevron.
- **In a draft:** amber dot + the draft's title + chevron (distinct amber tint —
  this replaces the banner's "you're in a draft" signal). Falls back to the raw
  `draftId` until metadata loads.

Dropdown (anchored under the pill, closes on outside-click / Escape):
1. **Live row** — green dot + "Live", subtitle "Read-only · create a draft to
   edit" when it is the current context. Marked `current` on prod; clicking it
   while in a draft calls `onExitDraft()`.
2. **Drafts** (when ≥1) — one row each: title + "by a person / an agent";
   clicking the label opens/switches into it; the open draft is highlighted +
   `current`; trailing **Promote** (↑) and **Discard** (trash) icon-buttons, each
   opening its `ConfirmModal` (row-open click suppressed on the buttons).
3. **+ New draft** — `createDraft(slug)` then `onOpenDraft(newId)`.

Confirm copy:
- **Discard** — "Discard draft?" · "This permanently deletes the draft
  \"{title}\". The live board is not affected." · red **Discard**.
- **Promote** — "Promote to live?" · "This overwrites the live board with
  \"{title}\". The current live board is saved to history first, so you can roll
  back." · primary **Promote to live**.

Post-action: refresh the draft list; if the acted-on draft is the one you're
currently viewing, navigate back to live (`onExitDraft()`). Loading / empty /
error states carry over from today's `DraftsMenu`.

### Part B — Client: the live board is content-locked

Introduce `contentLocked` in the editable pane, true when editing the live board:
derived from "editable pane AND no `draftId`". Thread `draftId` from `BoardCanvas`
into `EditableCanvas` (today it only reaches the room config).

- **RF interaction:** OR `contentLocked` into every gate `aiLocked` already
  drives — `nodesDraggable`, `nodesConnectable`, `elementsSelectable`,
  `edgesReconnectable` all become false on live. (Mirrors `aiLocked`; selection
  is disabled too so the multi-select resize overlay and per-node resizers can't
  mutate — a view-only selection mode is a possible later refinement.)
- **`useBoardInteractions`:** pass `aiLocked || contentLocked` so content
  shortcuts (delete / paste / duplicate / undo / redo) are inert on live.
- **`Toolbar`:** new `contentLocked` prop. When locked, render only the
  **Comment** and **Annotation** toggles (+ the annotation **Wipe**) and the sync
  indicator. Hide the content-creation tools (sticky / text / shape / frame /
  emoji / icon), the colour-cycle, the edge controls, the **Pencil** (it creates
  a *persisted* drawing node), and **History** (restore mutates prod content).
- **Sub-board drill-in:** `subBoard.canCreate = !readonly && !contentLocked`.
  Navigating into existing sub-boards still works; creating one does not.
- **Sub-board delete:** `App.tsx` offers `onDelete` only when
  `!READONLY && path.length > 0 && !contentLocked`.
- **Descriptions:** the editable description opener is not wired on live (nodes
  aren't selectable there anyway). View-only descriptions are a later refinement.
- **No banner** (per the brief). The amber pill + the reduced toolbar are the
  signal; the dropdown's Live row carries the "create a draft to edit" line.

### Part C — Server: the live board is frozen on disk

Prod content on disk may change **only via promote** — enforced by the update's
CRDT **origin**, not by disarming persistence.

Verified mechanism: `loadBoardIntoDoc` transacts with `LOCAL_ORIGIN`; a peer's
edit (browser/agent/raw client) arrives on the server doc with the websocket
connection as its origin, **never** `LOCAL_ORIGIN`. `bindState` seeds the doc
(also `LOCAL_ORIGIN`) *before* `armPersist` attaches the listener, so that seed
can't trigger a persist. Therefore, on a **prod** room, a post-arm `LOCAL_ORIGIN`
update means exactly one thing: `replaceRoomContent` from **promote**.

- **`yjs-ws.ts` `armPersist`:** the `on('update', (_u, origin) => …)` handler
  gains one guard — for a prod room (`draftId === undefined`), ignore any update
  whose `origin !== LOCAL_ORIGIN`. Draft rooms persist on every update, exactly as
  today. Prod content edits from peers still sync live but are never written to
  `board.json` and take no `'save'` snapshot.
- **`handlePromoteDraft`: no change.** Its `replaceRoomContent` mutates the prod
  doc with `LOCAL_ORIGIN`, which the guard admits → the room's own debounce
  persists + snapshots; the existing `if (!applied) persistBoard(...)` fallback
  still covers the no-room case. Promote is the *only* way prod disk changes.
- **Documented limitation:** a raw (non-UI, non-MCP) client could still push an
  in-memory content change to a live prod room that concurrently-connected peers
  see until reload; it is never persisted and vanishes on reseed. Reverting
  arbitrary CRDT updates server-side is out of scope — the durable store is frozen
  and no sanctioned client produces such an edit.

### Part D — MCP: editing requires a draft

- Add `assertEditable()` = `assertConnected()` plus "the peer has a `draftId`",
  throwing a clear error otherwise: *"This is the live board and is read-only.
  Create a draft with create_draft, then connect_board with that draft to edit."*
- Switch every **mutating** tool (add_*, move, update/set_*, delete, edge ops) to
  `assertEditable()`. **Read** tools (get_board / get_node / list_nodes) and
  **presence** tools (move_cursor / set_editing) keep `assertConnected()` — an
  agent may still connect to and read the live board.
- Update `connect_board`'s description to say the live board is read-only and
  editing needs a draft; update **AGENTS.md** to match.

## Testing

- **Client:** update `App.test.tsx`; drop `DraftBanner`/`DraftsMenu`-specific
  assertions. Add coverage for `LiveDraftMenu` (pill label per state, list,
  per-row promote/discard opening the modal, exit-via-Live-row), `ConfirmModal`
  (confirm / cancel / Escape / backdrop), and the content-lock (Toolbar shows only
  comment + annotation when `contentLocked`; RF interaction props are false).
- **Server:** a prod room's edits are not persisted (`board.json` unchanged after
  a doc update); a draft room's still are; promote writes prod on disk with no
  prod room connected and converges an open room when present.
- **MCP:** a mutating tool on a prod connection throws the read-only error; the
  same tool on a draft connection succeeds; read/presence tools work on prod.
- **Manual (browser preview):** live board shows the reduced toolbar and blocks
  drag/create; create a draft → fully editable → promote via modal → lands back
  on a live board that now shows the promoted content; comments + annotations work
  on live; nothing renders in READONLY.

## Non-goals

- No change to the routing/room-name/draft data model beyond what is above.
- No CRDT-level rejection of individual updates (see Part C limitation).
- No view-only node selection / view-only descriptions on live (possible later).
