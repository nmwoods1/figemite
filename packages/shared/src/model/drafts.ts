// ── Drafts types ─────────────────────────────────────────────────────────────
//
// A board can have any number of DRAFT versions. Each draft is a full board
// directory nested under the parent at boards/<slug>/.drafts/<id>/ — its
// board.json is a normal BoardFile, stored exactly like a prod board. The list
// of drafts (their ids, human titles, and provenance) is indexed in a
// human-owned sidecar boards/<slug>/drafts.json, kept separate from board.json
// so an agent rewriting board content never touches the draft index — the same
// separation tags.json / comments.json use.
//
// Only a HUMAN can approve ("promote") a draft to overwrite prod; there is no
// MCP tool for promotion, mirroring how comments/tags stay human-owned by
// omission. `createdBy` records what the caller *claims* (the browser tags
// 'human', the MCP create_draft tool tags 'agent') — it is informational
// provenance, NOT a security boundary (the system has no real actor identity).

/** Who created a draft, as self-declared by the caller. Informational only. */
export type DraftAuthorKind = 'human' | 'agent';

export interface DraftMeta {
  /** The draft id — the `.drafts/<id>/` directory name and room coordinate. */
  id: string;
  /** Human-readable title for the draft. */
  title: string;
  /** Self-declared provenance (not enforced — see module doc). */
  createdBy: DraftAuthorKind;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

export interface DraftsFile {
  drafts: DraftMeta[];
}
