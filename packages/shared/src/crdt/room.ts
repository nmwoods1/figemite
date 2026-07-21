// ── Room naming + presence types ─────────────────────────────────────────────
//
// Ported verbatim from the prototype's src/lib/realtime-core.ts. Pure and
// environment-agnostic: no DOM, no `location`, no browser APIs — shared between
// the browser client and the Node MCP-server peer.

export interface PresenceUser {
  name: string;
  color: string;
}

export interface PresenceCursor {
  // Flow-space coordinates (independent of viewport pan/zoom).
  x: number;
  y: number;
}

export interface AwarenessState {
  user?: PresenceUser;
  cursor?: PresenceCursor | null;
  // Data-id of the node this user currently has focus inside, or null/undefined
  // when they're not editing anything.
  editingNodeId?: string | null;
  // Current viewport (x/y in screen pixels, zoom in 0..N). Published so other
  // users can "follow" this one's view.
  viewport?: { x: number; y: number; zoom: number };
  // Set to true by AI peers (MCP server) so the canvas can render a distinct
  // badge. Human clients never set this.
  isAI?: boolean;
  // Optional tag identifying the AI client software (e.g. "cursor", "claude-code").
  agentClient?: string;
}

/**
 * The Yjs room name for a board (or sub-board), optionally scoped to a DRAFT.
 * The root board is just its `slug`; a sub-board appends its dot-joined path
 * (`slug.NodeA.NodeB`). The id grammar (see model/schema.ts `ID_GRAMMAR`)
 * guarantees no segment contains a `.`, so the dot encoding is unambiguous.
 *
 * A draft scopes the room to a distinct persistence target
 * (`boards/<slug>/.drafts/<draftId>/…`) by inserting a `~<draftId>` marker
 * right after the slug: `slug~<draftId>` for a draft's root, or
 * `slug~<draftId>.NodeA.NodeB` for a draft sub-board. `~` is outside the id
 * grammar `[A-Za-z0-9_-]+` (and is URL-unreserved), so it is an unambiguous
 * second delimiter that `parseRoomName` can split on before the dots. Omitting
 * `draftId` yields exactly the legacy prod room name — fully backward-compatible.
 */
export function roomNameFor(slug: string, path: string[], draftId?: string): string {
  const head = draftId ? `${slug}~${draftId}` : slug;
  return path.length > 0 ? `${head}.${path.join('.')}` : head;
}
