// ── Comment types ─────────────────────────────────────────────────────────────
//
// Comments live in boards/<slug>/comments.json, separate from board.json so
// the AI loop can rewrite board.json wholesale without touching human discussion.

import type { XY } from './board.js';

export interface CommentTargetNode {
  type: 'node';
  nodeId: string;
  offset?: XY;
}
export interface CommentTargetCanvas {
  type: 'canvas';
  pos: XY;
}
export type CommentTarget = CommentTargetNode | CommentTargetCanvas;

export interface CommentReply {
  id: string;
  author: string;
  createdAt: string;
  text: string;
}

export interface BoardComment {
  id: string;
  target: CommentTarget;
  author: string;
  createdAt: string;
  text: string;
  resolved?: boolean;
  replies: CommentReply[];
}

export interface CommentsFile {
  comments: BoardComment[];
}
