// ── BoardRepository ──────────────────────────────────────────────────────────
//
// Pure file-persistence layer for boards and sub-boards. Ported from the
// figmalade prototype's `vite.config.ts` (read/write/list/delete/seed/label
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
import { deserialise, emptyBoard, serialise, type BoardFile } from '@easel/shared';
import { boardDirPath, boardFilePath, validateSlugAndPath } from './paths.js';
import { atomicWriteFileSync } from './atomic-write.js';

export class BoardRepository {
  constructor(private readonly boardsRoot: string) {}

  /** Reads and validates a board (or sub-board). Throws a clear, distinct error if missing or invalid. */
  read(slug: string, subPath: string[] = []): BoardFile {
    const filePath = boardFilePath(this.boardsRoot, slug, subPath);

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new Error(
          `Board not found: slug=${JSON.stringify(slug)} path=${JSON.stringify(subPath)} (${filePath})`,
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
   * Serialises (canonical, via `@easel/shared`) and atomically writes a board
   * or sub-board. Writes to a temp file in the same directory, then
   * `fs.renameSync`s over the target (atomic on the same filesystem). This is
   * the sole write path — every mutation to board JSON on disk should route
   * through here.
   */
  write(slug: string, subPath: string[], board: BoardFile): void {
    const filePath = boardFilePath(this.boardsRoot, slug, subPath);
    atomicWriteFileSync(filePath, serialise(board));
  }

  /**
   * Deletes a sub-board file and all of its descendant sub-boards (files
   * whose dotted path extends this one). Deleting the root (`subPath = []`)
   * removes the entire board directory.
   */
  delete(slug: string, subPath: string[]): void {
    validateSlugAndPath(slug, subPath);

    if (subPath.length === 0) {
      const dir = boardDirPath(this.boardsRoot, slug);
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }

    const dir = boardDirPath(this.boardsRoot, slug);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    const exact = `board.${subPath.join('.')}.json`;
    const prefix = `board.${subPath.join('.')}.`;
    for (const entry of entries) {
      if (entry === exact || entry.startsWith(prefix)) {
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    }
  }

  /** True if the given board (or sub-board) file exists. */
  exists(slug: string, subPath: string[] = []): boolean {
    const filePath = boardFilePath(this.boardsRoot, slug, subPath);
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
  listSubBoardPaths(slug: string): string[][] {
    validateSlugAndPath(slug, []);
    const dir = boardDirPath(this.boardsRoot, slug);
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

  /** Creates the board directory and seeds an empty root board with the given label. */
  seedBoard(slug: string, label: string): void {
    this.write(slug, [], emptyBoard(label));
  }

  /** Reads the root board's `boardLabel`. */
  extractBoardLabel(slug: string): string {
    return this.read(slug, []).boardLabel;
  }
}
