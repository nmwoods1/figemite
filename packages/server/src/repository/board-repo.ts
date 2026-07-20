// ── BoardRepository ──────────────────────────────────────────────────────────
//
// Pure file-persistence layer for boards and sub-boards. Ported from the
// original prototype's `vite.config.ts` (read/write/list/delete/seed/label
// logic embedded in the dev-server Vite plugin) into a standalone module with
// no HTTP or plugin dependencies — this class is the sole read/write path for
// board JSON on disk.
//
// All synchronous (`node:fs`), matching the rest of this module's needs:
// board files are small, and synchronous I/O keeps the read/write/delete
// sequencing trivial to reason about (no interleaving with a concurrent
// request for the same file). Later phases can revisit if profiling ever
// shows this matters.

import fs from 'node:fs';
import path from 'node:path';
import { deserialise, emptyBoard, serialise, type BoardFile } from '@figemite/shared';
import {
  boardDirPath,
  boardFilePath,
  contentDirPath,
  draftDirPath,
  draftsRootDir,
  validateSlugAndPath,
} from './paths.js';
import { atomicWriteFileSync } from './atomic-write.js';

export class BoardRepository {
  constructor(private readonly boardsRoot: string) {}

  /**
   * Reads and validates a board (or sub-board). When `draftId` is given, reads
   * that draft's copy from `.drafts/<draftId>/` instead of prod. Throws a clear,
   * distinct error if missing or invalid.
   */
  read(slug: string, subPath: string[] = [], draftId?: string): BoardFile {
    const filePath = boardFilePath(this.boardsRoot, slug, subPath, draftId);

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new Error(
          `Board not found: slug=${JSON.stringify(slug)} path=${JSON.stringify(subPath)} draft=${JSON.stringify(draftId)} (${filePath})`,
        );
      }
      throw err;
    }

    try {
      return deserialise(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid board file at ${filePath}: ${message}`);
    }
  }

  /**
   * Serialises (canonical, via `@figemite/shared`) and atomically writes a board
   * or sub-board. Writes to a temp file in the same directory, then
   * `fs.renameSync`s over the target (atomic on the same filesystem). This is
   * the sole write path — every mutation to board JSON on disk should route
   * through here.
   */
  write(slug: string, subPath: string[], board: BoardFile, draftId?: string): void {
    const filePath = boardFilePath(this.boardsRoot, slug, subPath, draftId);
    atomicWriteFileSync(filePath, serialise(board));
  }

  /**
   * Deletes a sub-board file and all of its descendant sub-boards (files
   * whose dotted path extends this one). Deleting the root (`subPath = []`)
   * removes the entire board directory. Returns the relative names removed:
   * `['board.<path>.json', ...]` for a sub-board delete, `[<slug>]` for a root
   * delete. Deleting something that doesn't exist returns `[]`.
   *
   * NOTE: the root-clear capability is an intentional repository primitive.
   * The HTTP API deliberately does NOT expose it (the DELETE /api/board
   * handler rejects an empty path with 400) — deleting a whole board over the
   * LAN API would be irreversible data loss. Callers that genuinely need to
   * remove a board (an admin/tooling path) use this directly.
   */
  delete(slug: string, subPath: string[], draftId?: string): string[] {
    validateSlugAndPath(slug, subPath);

    if (subPath.length === 0) {
      // Clearing the whole board (prod) — or, with a draftId, the whole draft
      // directory `.drafts/<draftId>/` (board.json, its sub-boards, its
      // .history). This is the discard-draft primitive the promote/discard
      // handlers use; it does NOT touch prod.
      const dir = draftId === undefined
        ? boardDirPath(this.boardsRoot, slug)
        : draftDirPath(this.boardsRoot, slug, draftId);
      if (!fs.existsSync(dir)) return [];
      fs.rmSync(dir, { recursive: true, force: true });
      return [draftId ?? slug];
    }

    const dir = contentDirPath(this.boardsRoot, slug, draftId);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }

    const exact = `board.${subPath.join('.')}.json`;
    const prefix = `board.${subPath.join('.')}.`;
    const deleted: string[] = [];
    for (const entry of entries) {
      if (entry === exact || entry.startsWith(prefix)) {
        fs.rmSync(path.join(dir, entry), { force: true });
        deleted.push(entry);
      }
    }
    return deleted;
  }

  /** True if the given board/sub-board (of prod, or of a draft) file exists. */
  exists(slug: string, subPath: string[] = [], draftId?: string): boolean {
    const filePath = boardFilePath(this.boardsRoot, slug, subPath, draftId);
    return fs.existsSync(filePath);
  }

  /** All board slugs — immediate subdirectories of boardsRoot (excluding dotfiles). */
  listSlugs(): string[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.boardsRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  }

  /**
   * All sub-board paths for a slug, parsed from `board.*.json` filenames back
   * into segment arrays. E.g. `board.NodeA.json`, `board.NodeA.NodeB.json` ->
   * `[['NodeA'], ['NodeA', 'NodeB']]`. Does not include the root `board.json`.
   */
  listSubBoardPaths(slug: string, draftId?: string): string[][] {
    validateSlugAndPath(slug, []);
    const dir = contentDirPath(this.boardsRoot, slug, draftId);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const result: string[][] = [];
    for (const entry of entries) {
      if (entry === 'board.json' || !entry.startsWith('board.') || !entry.endsWith('.json')) {
        continue;
      }
      const inner = entry.slice('board.'.length, -'.json'.length);
      if (!inner) continue;
      result.push(inner.split('.'));
    }
    return result;
  }

  /**
   * The draft ids that physically exist for a board — the immediate
   * subdirectories of `<slug>/.drafts/` that contain a root `board.json`. This
   * is the source of truth for draft *existence*; the human-owned `drafts.json`
   * sidecar carries the metadata index (titles, provenance). Returns `[]` when
   * the board has no `.drafts/` directory.
   */
  listDrafts(slug: string): string[] {
    validateSlugAndPath(slug, []);
    const dir = draftsRootDir(this.boardsRoot, slug);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const draftHasBoard = (name: string): boolean => {
      // `exists` validates the id grammar and throws on a malformed dir name;
      // treat any such stray directory as "not a draft" rather than propagating.
      try {
        return this.exists(slug, [], name);
      } catch {
        return false;
      }
    };
    return entries
      .filter((e) => e.isDirectory() && draftHasBoard(e.name))
      .map((e) => e.name)
      .sort();
  }

  /** Creates the board directory and seeds an empty root board with the given label. */
  seedBoard(slug: string, label: string): void {
    this.write(slug, [], emptyBoard(label));
  }

  /** Reads the root board's `boardLabel`. */
  extractBoardLabel(slug: string): string {
    return this.read(slug, []).boardLabel;
  }
}
