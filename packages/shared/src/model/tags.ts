// ── Tags types ─────────────────────────────────────────────────────────────────
//
// Tags live in boards/<slug>/tags.json, separate from board.json so that AI
// agents rewriting board.json never touch board tagging metadata.

export interface TagsFile {
  tags: string[];
}
