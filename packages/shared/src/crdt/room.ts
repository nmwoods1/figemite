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
 * The Yjs room name for a board (or sub-board). The root board is just its
 * `slug`; a sub-board appends its dot-joined path (`slug.NodeA.NodeB`). The id
 * grammar (see model/schema.ts `ID_GRAMMAR`) guarantees no segment contains a
 * `.`, so this encoding is unambiguous.
 */
export function roomNameFor(slug: string, path: string[]): string {
  return path.length > 0 ? `${slug}.${path.join('.')}` : slug;
}
