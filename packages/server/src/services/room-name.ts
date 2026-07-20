// ── parseRoomName ────────────────────────────────────────────────────────────
//
// The inverse of `@figemite/shared`'s `roomNameFor(slug, path)`: given a Yjs room
// name (`<slug>` or `<slug>.<seg1>.<seg2>...`), recovers the `{ slug, subPath }`
// pair the persistence provider needs to read/write the right board file.
//
// Safe to split naively on `.`: every slug and path segment is drawn from the
// shared id grammar (`ID_GRAMMAR` / `SlugSchema` / `PathSegmentSchema` in
// model/schema.ts), which is `[A-Za-z0-9_-]+` — no segment can itself contain a
// `.`, so `roomNameFor`'s dot-join is unambiguous and this split is a true
// inverse. `parseRoomName` re-validates every segment against that same
// grammar (via `validateSlugAndPath`) rather than trusting the split blindly —
// a room name is attacker-controlled input (it comes straight off the
// WebSocket upgrade URL), so a malformed room (empty segments from a leading/
// trailing/double dot, or a segment with an invalid character) is rejected
// here BEFORE any disk access, rather than being handed to `BoardRepository`
// (whose own path builders would reject it too, but only after doing more
// work, and with a less specific error).

import { validateDraftId, validateSlugAndPath } from '../repository/paths.js';

export interface ParsedRoomName {
  slug: string;
  subPath: string[];
  /** Present when the room addresses a DRAFT (`slug~<draftId>[.seg...]`). */
  draftId?: string;
}

/**
 * Parses a Yjs room name into `{ slug, subPath, draftId? }`. Throws if the room
 * name is empty, or if any segment (the slug, the draft id, or a sub-path
 * segment) is empty or contains a character outside the shared id grammar
 * (`[A-Za-z0-9_-]+`) — see module doc for why that grammar makes the splits
 * unambiguous and safe.
 *
 * A draft room carries a `~<draftId>` marker right after the slug
 * (`slug~<draftId>` or `slug~<draftId>.NodeA.NodeB`). `~` is outside the id
 * grammar, so we split on it FIRST (at most once) to peel off `slug` and
 * `draftId`, then split the remainder on `.` for the sub-path. `draftId` is
 * re-validated with the same grammar gate as a path segment — a room name is
 * attacker-controlled (straight off the WS upgrade URL), so this is the
 * load-bearing traversal defense for `.drafts/<draftId>/`.
 */
export function parseRoomName(room: string): ParsedRoomName {
  if (!room) {
    throw new Error('Invalid room name: empty string');
  }

  // Peel off an optional draft marker: everything up to the first `.` is the
  // "head" (`slug` or `slug~draftId`); the rest is the dotted sub-path.
  const firstDot = room.indexOf('.');
  const head = firstDot === -1 ? room : room.slice(0, firstDot);
  const rest = firstDot === -1 ? '' : room.slice(firstDot + 1);

  const tildeCount = (head.match(/~/g) ?? []).length;
  if (tildeCount > 1) {
    throw new Error(`Invalid room name ${JSON.stringify(room)}: multiple "~" in draft marker`);
  }

  let slug: string;
  let draftId: string | undefined;
  if (tildeCount === 1) {
    const [rawSlug, rawDraftId] = head.split('~');
    slug = rawSlug;
    draftId = rawDraftId;
    if (draftId.length === 0) {
      throw new Error(`Invalid room name ${JSON.stringify(room)}: empty draft id`);
    }
  } else {
    slug = head;
  }

  const subPath = rest.length === 0 ? [] : rest.split('.');

  // A leading/trailing/doubled dot produces an empty-string segment; the
  // grammar check below would also reject it, but we name the actual problem.
  if (subPath.some((seg) => seg.length === 0)) {
    throw new Error(`Invalid room name ${JSON.stringify(room)}: contains an empty segment`);
  }

  try {
    validateSlugAndPath(slug, subPath);
    if (draftId !== undefined) validateDraftId(draftId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid room name ${JSON.stringify(room)}: ${message}`);
  }

  return draftId === undefined ? { slug, subPath } : { slug, subPath, draftId };
}
