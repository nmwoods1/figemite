import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommentsFile } from '@figemite/shared';
import { readComments, writeComments } from './comments-repo.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-comments-repo-'));
  fsSync.mkdirSync(path.join(tmpRoot, 'my-board'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function sampleComments(): CommentsFile {
  return {
    comments: [
      {
        id: 'c1',
        target: { type: 'canvas', pos: { x: 5, y: 5 } },
        author: 'Nick',
        createdAt: '2026-07-06T00:00:00.000Z',
        text: 'hello',
        replies: [],
      },
    ],
  };
}

describe('comments round-trip', () => {
  it('writes and reads back comments deep-equal', () => {
    writeComments(tmpRoot, 'my-board', sampleComments());
    expect(readComments(tmpRoot, 'my-board')).toEqual(sampleComments());
  });

  it('the file on disk is valid JSON', () => {
    writeComments(tmpRoot, 'my-board', sampleComments());
    const raw = fsSync.readFileSync(path.join(tmpRoot, 'my-board', 'comments.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('atomic write leaves no leftover temp file', () => {
    writeComments(tmpRoot, 'my-board', sampleComments());
    const entries = fsSync.readdirSync(path.join(tmpRoot, 'my-board'));
    expect(entries).toEqual(['comments.json']);
  });
});

describe('missing comments file', () => {
  it('returns an empty comments file', () => {
    expect(readComments(tmpRoot, 'my-board')).toEqual({ comments: [] });
  });

  it('a draft with no comments file yet reads back empty', () => {
    expect(readComments(tmpRoot, 'my-board', 'd1')).toEqual({ comments: [] });
  });
});

describe('version scoping (prod vs. draft)', () => {
  it('writes a draft comment under .drafts/<draftId>/comments.json', () => {
    writeComments(tmpRoot, 'my-board', sampleComments(), 'd1');
    const filePath = path.join(tmpRoot, 'my-board', '.drafts', 'd1', 'comments.json');
    expect(fsSync.existsSync(filePath)).toBe(true);
    expect(readComments(tmpRoot, 'my-board', 'd1')).toEqual(sampleComments());
  });

  it('keeps prod and draft threads independent (no leak either direction)', () => {
    const prod = sampleComments();
    const draft: CommentsFile = {
      comments: [
        {
          id: 'c2',
          target: { type: 'canvas', pos: { x: 9, y: 9 } },
          author: 'Ada',
          createdAt: '2026-07-07T00:00:00.000Z',
          text: 'draft-only',
          replies: [],
        },
      ],
    };
    writeComments(tmpRoot, 'my-board', prod);
    writeComments(tmpRoot, 'my-board', draft, 'd1');

    // Each version reads back only its own thread.
    expect(readComments(tmpRoot, 'my-board')).toEqual(prod);
    expect(readComments(tmpRoot, 'my-board', 'd1')).toEqual(draft);

    // Overwriting the draft never touches prod.
    writeComments(tmpRoot, 'my-board', { comments: [] }, 'd1');
    expect(readComments(tmpRoot, 'my-board')).toEqual(prod);
    expect(readComments(tmpRoot, 'my-board', 'd1')).toEqual({ comments: [] });
  });
});

describe('invalid comments file', () => {
  it('throws on schema-invalid content', () => {
    fsSync.writeFileSync(
      path.join(tmpRoot, 'my-board', 'comments.json'),
      JSON.stringify({ comments: 'not-an-array' }),
    );
    expect(() => readComments(tmpRoot, 'my-board')).toThrow();
  });

  it('throws on corrupt JSON', () => {
    fsSync.writeFileSync(path.join(tmpRoot, 'my-board', 'comments.json'), '{ not json');
    expect(() => readComments(tmpRoot, 'my-board')).toThrow();
  });
});

describe('hostile input rejection', () => {
  it('readComments throws for a traversal slug', () => {
    expect(() => readComments(tmpRoot, '../escape')).toThrow();
  });

  it('writeComments throws for a traversal slug and creates nothing outside root', () => {
    const outside = path.join(path.dirname(tmpRoot), 'escape', 'comments.json');
    expect(() => writeComments(tmpRoot, '../escape', sampleComments())).toThrow();
    expect(fsSync.existsSync(outside)).toBe(false);
  });
});
