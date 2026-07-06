// ── /api/boards handlers ─────────────────────────────────────────────────────
//
// GET  /api/boards — list every board with label, tags, sub-board paths, mtime.
// POST /api/boards — create a new board (seed an empty root board).

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SlugSchema, emptyBoard } from '@easel/shared';
import { boardFilePath } from '../../repository/paths.js';
import { readTags } from '../../repository/tags-repo.js';
import { readJsonBody, sendError, sendJson } from '../../http/body.js';
import { persistBoard } from '../persist.js';
import { ValidationError } from '../errors.js';
import type { RequestContext } from '../router.js';

/** Slugs the tag-filtering UI reserves as pseudo-boards; cannot be created. */
const RESERVED_SLUGS = new Set(['tag', 'untagged']);

interface BoardInfo {
  slug: string;
  label: string;
  tags: string[];
  subBoardPaths: string[][];
  /** Root board file mtime in epoch-ms. Named to match the existing client. */
  lastModifiedMs: number;
}

/** Title-cases a slug for a fallback display label: `my-board` -> `My Board`. */
function titleCaseSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildBoardInfo(ctx: RequestContext, slug: string): BoardInfo | null {
  const bFile = boardFilePath(ctx.config.boardsRoot, slug, []);
  let lastModifiedMs = 0;
  try {
    lastModifiedMs = fs.statSync(bFile).mtimeMs;
  } catch {
    return null; // no root board file — not a real board directory
  }

  let label = titleCaseSlug(slug);
  try {
    label = ctx.repo.extractBoardLabel(slug);
  } catch {
    // Corrupt/unreadable root board — fall back to the title-cased slug rather
    // than dropping the board from the listing.
  }

  const subBoardPaths = ctx.repo.listSubBoardPaths(slug);
  const tags = readTags(ctx.config.boardsRoot, slug).tags;
  return { slug, label, tags, subBoardPaths, lastModifiedMs };
}

/** GET /api/boards → `{ boards: BoardInfo[] }`. */
export function handleListBoards(
  ctx: RequestContext,
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const boards = ctx.repo
    .listSlugs()
    .map((slug) => buildBoardInfo(ctx, slug))
    .filter((b): b is BoardInfo => b !== null);
  sendJson(res, 200, { boards });
}

/** POST /api/boards — create a new board. Body `{ slug, label? }`. */
export async function handleCreateBoard(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as { slug?: unknown; label?: unknown };
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!SlugSchema.safeParse(slug).success) {
    throw new ValidationError(
      `Invalid slug ${JSON.stringify(slug)}. Use letters, digits, "_" and "-".`,
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ValidationError(`The slug ${JSON.stringify(slug)} is reserved and cannot be used.`);
  }
  if (ctx.repo.exists(slug, [])) {
    sendError(res, 409, 'A board with that name already exists.');
    return;
  }
  const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
  const label = rawLabel || titleCaseSlug(slug);
  // Route the seed through the single write funnel so creation suppresses the
  // watcher and records an initial `save` snapshot, exactly like every other
  // board-data write (rather than `repo.seedBoard`, which would bypass both).
  persistBoard(ctx, slug, [], emptyBoard(label), 'save');
  sendJson(res, 200, { ok: true, slug });
}
