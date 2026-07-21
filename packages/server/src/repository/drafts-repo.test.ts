import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DraftsFile } from '@figemite/shared';
import { readDrafts, writeDrafts } from './drafts-repo.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'figemite-drafts-repo-'));
  fsSync.mkdirSync(path.join(tmpRoot, 'my-board'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function sampleDrafts(): DraftsFile {
  return {
    drafts: [
      { id: 'draft1', title: 'First pass', createdBy: 'human', createdAt: '2026-07-20T00:00:00.000Z' },
      { id: 'draft2', title: 'Agent idea', createdBy: 'agent', createdAt: '2026-07-20T01:00:00.000Z' },
    ],
  };
}

describe('drafts round-trip', () => {
  it('writes and reads back drafts deep-equal', () => {
    writeDrafts(tmpRoot, 'my-board', sampleDrafts());
    expect(readDrafts(tmpRoot, 'my-board')).toEqual(sampleDrafts());
  });

  it('the file on disk is valid JSON at drafts.json', () => {
    writeDrafts(tmpRoot, 'my-board', sampleDrafts());
    const raw = fsSync.readFileSync(path.join(tmpRoot, 'my-board', 'drafts.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('atomic write leaves no leftover temp file', () => {
    writeDrafts(tmpRoot, 'my-board', sampleDrafts());
    expect(fsSync.readdirSync(path.join(tmpRoot, 'my-board'))).toEqual(['drafts.json']);
  });
});

describe('missing drafts file', () => {
  it('returns an empty drafts file', () => {
    expect(readDrafts(tmpRoot, 'my-board')).toEqual({ drafts: [] });
  });
});

describe('invalid drafts file', () => {
  it('throws on schema-invalid content (bad createdBy)', () => {
    fsSync.writeFileSync(
      path.join(tmpRoot, 'my-board', 'drafts.json'),
      JSON.stringify({ drafts: [{ id: 'd1', title: 't', createdBy: 'robot', createdAt: 'x' }] }),
    );
    expect(() => readDrafts(tmpRoot, 'my-board')).toThrow();
  });

  it('throws on a draft id that violates the id grammar', () => {
    fsSync.writeFileSync(
      path.join(tmpRoot, 'my-board', 'drafts.json'),
      JSON.stringify({ drafts: [{ id: 'bad id', title: 't', createdBy: 'human', createdAt: 'x' }] }),
    );
    expect(() => readDrafts(tmpRoot, 'my-board')).toThrow();
  });

  it('throws on corrupt JSON', () => {
    fsSync.writeFileSync(path.join(tmpRoot, 'my-board', 'drafts.json'), '{ not json');
    expect(() => readDrafts(tmpRoot, 'my-board')).toThrow();
  });
});

describe('hostile input rejection', () => {
  it('readDrafts throws for a traversal slug', () => {
    expect(() => readDrafts(tmpRoot, '../escape')).toThrow();
  });
});
