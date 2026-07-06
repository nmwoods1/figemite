import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TagsFile } from '@easel/shared';
import { readTags, writeTags } from './tags-repo.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-tags-repo-'));
  fsSync.mkdirSync(path.join(tmpRoot, 'my-board'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function sampleTags(): TagsFile {
  return { tags: ['roadmap', 'q3'] };
}

describe('tags round-trip', () => {
  it('writes and reads back tags deep-equal', () => {
    writeTags(tmpRoot, 'my-board', sampleTags());
    expect(readTags(tmpRoot, 'my-board')).toEqual(sampleTags());
  });

  it('the file on disk is valid JSON', () => {
    writeTags(tmpRoot, 'my-board', sampleTags());
    const raw = fsSync.readFileSync(path.join(tmpRoot, 'my-board', 'tags.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('atomic write leaves no leftover temp file', () => {
    writeTags(tmpRoot, 'my-board', sampleTags());
    const entries = fsSync.readdirSync(path.join(tmpRoot, 'my-board'));
    expect(entries).toEqual(['tags.json']);
  });
});

describe('missing tags file', () => {
  it('returns an empty tags file', () => {
    expect(readTags(tmpRoot, 'my-board')).toEqual({ tags: [] });
  });
});

describe('invalid tags file', () => {
  it('throws on schema-invalid content', () => {
    fsSync.writeFileSync(
      path.join(tmpRoot, 'my-board', 'tags.json'),
      JSON.stringify({ tags: [1, 2, 3] }),
    );
    expect(() => readTags(tmpRoot, 'my-board')).toThrow();
  });

  it('throws on corrupt JSON', () => {
    fsSync.writeFileSync(path.join(tmpRoot, 'my-board', 'tags.json'), '{ not json');
    expect(() => readTags(tmpRoot, 'my-board')).toThrow();
  });
});

describe('hostile input rejection', () => {
  it('readTags throws for a traversal slug', () => {
    expect(() => readTags(tmpRoot, '../escape')).toThrow();
  });

  it('writeTags throws for a traversal slug and creates nothing outside root', () => {
    const outside = path.join(path.dirname(tmpRoot), 'escape', 'tags.json');
    expect(() => writeTags(tmpRoot, '../escape', sampleTags())).toThrow();
    expect(fsSync.existsSync(outside)).toBe(false);
  });
});
