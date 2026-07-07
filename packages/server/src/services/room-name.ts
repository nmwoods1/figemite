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

import { validateSlugAndPath } from '../repository/paths.js';

export interface ParsedRoomName {
  slug: string;
  subPath: string[];
}

/**
 * Parses a Yjs room name into `{ slug, subPath }`. Throws if the room name is
 * empty, or if any dot-separated segment (the slug or a sub-path segment) is
 * empty or contains a character outside the shared id grammar
 * (`[A-Za-z0-9_-]+`) — see module doc for why that grammar makes the split
 * unambiguous and safe.
 */
export function parseRoomName(room: string): ParsedRoomName {
  if (!room) {
    throw new Error('Invalid room name: empty string');
  }

  const segments = room.split('.');
  const [slug, ...subPath] = segments;

  // A leading/trailing/doubled dot produces an empty-string segment somewhere
  // in the split; validateSlugAndPath's grammar check would also reject an
  // empty string (it doesn't match [A-Za-z0-9_-]+), but we check explicitly
  // first so the error message names the actual problem.
  if (segments.some((seg) => seg.length === 0)) {
    throw new Error(`Invalid room name ${JSON.stringify(room)}: contains an empty segment`);
  }

  try {
    validateSlugAndPath(slug, subPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid room name ${JSON.stringify(room)}: ${message}`);
  }

  return { slug, subPath };
}
