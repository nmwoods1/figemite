// ── figemite MCP server — the AI-agent peer on the shared CRDT contract ────────
//
// Connects to a running `@figemite/server` as a multiplayer AI peer (via
// `BoardPeer`) and exposes board operations as MCP tools. Ported from the
// original prototype's mcp/legacy-mcp-server/src/server.ts, with the
// private per-project `ops.ts` deleted entirely: every node/edge mutation
// below calls straight into `@figemite/shared`'s `crdt/ops` (via `./tools.js`)
// — the SAME ops the browser client uses. That's the whole point of this
// package: ONE contract, not two hand-synced copies.
//
// Also gone: the legacy's debounced `POST /api/board` flush
// (`scheduleFlush`/`flushToDisk`). The server now seeds and persists every
// Yjs room itself (P5-T28) — a peer only needs to get its edit onto the
// room; the server takes it from there. See peer.ts's module doc.
//
// Registered as `createFigemiteMcpServer(...)` (a factory, not a module-level
// singleton) so tests can construct an isolated server instance; `index.ts`
// is the thin runnable entry that builds one from env/CLI config and
// connects it to stdio.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BoardPeer } from './peer.js';
import { InstanceRegistry, type Instance } from './registry.js';
import { listBoards, createBoard, listDrafts, createDraft } from './board-http.js';
import {
  getBoard,
  getNode,
  listNodes,
  addNode,
  updateNode,
  moveNode,
  deleteNode,
  setNodeText,
  addDrawing,
  setDescription,
  addEdge,
  updateEdge,
  deleteEdge,
} from './tools.js';
import type { BoardNode, XY } from '@figemite/shared';

// ── Cursor-lead niceties ──────────────────────────────────────────────────────
// Ported verbatim from the legacy: park the cursor where a mutation is about
// to land, and pause briefly, so a human watching the board sees the AI
// "reach" for a target instead of teleporting + mutating in the same frame.

const CURSOR_LEAD_MS = 300;
const DRAW_SWEEP_STOPS = 10;
const DRAW_SWEEP_MS = 40;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function centreOf(pos: XY, size: unknown): XY {
  let w = 0;
  let h = 0;
  if (typeof size === 'number') {
    w = size;
    h = size;
  } else if (size && typeof size === 'object') {
    const sz = size as { width?: number; height?: number };
    w = sz.width ?? 0;
    h = sz.height ?? 0;
  }
  return { x: pos.x + w / 2, y: pos.y + h / 2 };
}

function nodeCentre(node: BoardNode): XY {
  const size = 'size' in node ? node.size : 0;
  return centreOf(node.pos, size);
}

async function leadCursor(peer: BoardPeer, target: XY | null): Promise<void> {
  if (!target) return;
  peer.setCursor(target);
  await delay(CURSOR_LEAD_MS);
}

async function sweepCursorAlong(peer: BoardPeer, points: XY[]): Promise<void> {
  if (points.length === 0) return;
  const stops = Math.min(DRAW_SWEEP_STOPS, points.length);
  for (let i = 0; i < stops; i++) {
    const idx = Math.floor((i / Math.max(1, stops - 1)) * (points.length - 1));
    peer.setCursor(points[idx]);
    await delay(DRAW_SWEEP_MS);
  }
}

function edgeMidpoint(peer: BoardPeer, source: string, target: string): XY | null {
  const a = getNode(peer, source);
  const b = getNode(peer, target);
  if (!a || !b) return null;
  const ca = nodeCentre(a);
  const cb = nodeCentre(b);
  return { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
}

function textResult(text: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return textResult(JSON.stringify(value, null, 2));
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface FigemiteMcpServerOptions {
  /** URL of the synthetic "local" instance (your own localhost server). Defaults to `http://localhost:5400`. */
  defaultHttpUrl?: string;
  /** Default display name for the AI's presence. Defaults to "AI". */
  defaultName?: string;
  /** Default agent-client tag. Defaults to "claude-code". */
  defaultAgentClient?: string;
  /** Injectable InstanceRegistry (tests supply a fake-backed one). Defaults to one seeded with `defaultHttpUrl`. */
  registry?: InstanceRegistry;
  /** Injectable BoardPeer factory. Defaults to `(opts) => new BoardPeer(opts)`. */
  makePeer?: (opts: ConstructorParameters<typeof BoardPeer>[0]) => BoardPeer;
}

const DEFAULT_HTTP_URL = 'http://localhost:5400';

/**
 * Builds a fresh `McpServer` with every board tool registered. A factory
 * (not a module singleton) so tests can construct an isolated instance and
 * so `index.ts` stays a thin entry point.
 *
 * There is NO shared "active server": every board/draft tool addresses a
 * specific figemite instance by `instanceId` (resolved through the
 * `InstanceRegistry`), and connections are held per-instance in a map so an
 * agent can be connected to several servers at once.
 */
export function createFigemiteMcpServer(options: FigemiteMcpServerOptions = {}): McpServer {
  const defaultHttpUrl = options.defaultHttpUrl ?? DEFAULT_HTTP_URL;
  const defaultName = options.defaultName ?? 'AI';
  const defaultAgentClient = options.defaultAgentClient ?? 'claude-code';
  const registry = options.registry ?? new InstanceRegistry({ localUrl: defaultHttpUrl });
  const makePeer = options.makePeer ?? ((opts) => new BoardPeer(opts));

  // One live connection per instance id — no shared "active" peer.
  const peers = new Map<string, BoardPeer>();

  /** Resolve a healthy instance by id, or throw a message listing what IS available. */
  function resolveInstance(instanceId: string): Instance {
    const instance = registry.get(instanceId);
    if (instance) return instance;
    const available = registry.healthyIds();
    const hint = available.length
      ? `Available instances: ${available.join(', ')}.`
      : 'No instances are currently visible.';
    throw new Error(
      `Unknown or unhealthy instance "${instanceId}". Call list_instances to see live servers. ${hint}`,
    );
  }

  function assertConnected(instanceId: string): BoardPeer {
    const p = peers.get(instanceId);
    if (!p) {
      throw new Error(
        `Not connected to instance "${instanceId}". Call connect_board with this instanceId first.`,
      );
    }
    return p;
  }

  // Every board-CONTENT mutation goes through here: the live ("prod") board is
  // read-only, so editing requires a connection to a DRAFT. Reading and presence
  // (get_*, move_cursor, set_editing, set_viewport) stay on assertConnected().
  function assertEditable(instanceId: string): BoardPeer {
    const p = assertConnected(instanceId);
    if (!p.draftId) {
      throw new Error(
        'This is the live board and is read-only. Create a draft with create_draft, ' +
          'then connect_board with that draft (the `draft` param) to make changes. ' +
          'A human approves the draft to update the live board.',
      );
    }
    return p;
  }

  /** Zod field for the required instanceId, shared by every tool's inputSchema. */
  const instanceIdField = z
    .string()
    .describe('Target figemite instance id (from list_instances). Required on every board/draft operation.');

  const server = new McpServer({ name: 'figemite', version: '0.1.0' });

  // ── connect_board / disconnect ───────────────────────────────────────────

  server.registerTool(
    'connect_board',
    {
      description: [
        'Connect to a figemite board on a specific instance as a multiplayer AI peer.',
        'Call this before any read/presence/content tool for that instance.',
        'Returns the current board snapshot. The AI gets a visible cursor and "AI"',
        "name pill in everyone's browser.",
        '',
        'Pass `instanceId` (from list_instances) to choose WHICH server to connect to.',
        'You can be connected to several instances at once — each holds its own',
        'connection, addressed by its instanceId. Re-connecting to the same instanceId',
        'replaces that instance\'s connection (e.g. to switch board or draft).',
        '',
        'IMPORTANT: the live ("prod") board is READ-ONLY. You can connect to it',
        'to read/observe, but every content edit (add/move/update/delete nodes',
        'and edges) REQUIRES a draft — pass `draft` (from create_draft /',
        'list_drafts) to edit. A human reviews and approves the draft to update',
        'the live board; only a human can approve — there is deliberately no',
        'tool for that.',
      ].join('\n'),
      inputSchema: {
        instanceId: instanceIdField,
        slug: z.string().describe('Board slug, e.g. "spend"'),
        draft: z
          .string()
          .optional()
          .describe(
            'Draft id to edit (from create_draft / list_drafts). REQUIRED to make any ' +
              'content edit — the live board is read-only. Omit only to read/observe prod.',
          ),
        path: z
          .array(z.string())
          .optional()
          .describe('Sub-board path, e.g. ["NodeA"]. Omit for root.'),
        name: z.string().optional().describe('Display name shown in the browser (default: "AI")'),
        agentClient: z
          .string()
          .optional()
          .describe('Tag for your AI client, e.g. "cursor" or "claude-code"'),
      },
    },
    async (input) => {
      const instance = resolveInstance(input.instanceId);

      // Replace any existing connection to this instance.
      const existing = peers.get(input.instanceId);
      if (existing) {
        existing.destroy();
        peers.delete(input.instanceId);
      }

      const peer = makePeer({
        wsUrl: instance.wsUrl,
        slug: input.slug,
        path: input.path ?? [],
        draftId: input.draft,
        name: input.name ?? defaultName,
        agentClient: input.agentClient ?? defaultAgentClient,
      });
      peers.set(input.instanceId, peer);

      await peer.waitForSync(15_000);

      // Park the cursor so the AI is visible immediately: centre of the
      // bounding box of existing node centres, or the origin on an empty board.
      const snapshot = getBoard(peer);
      if (snapshot.nodes.length > 0) {
        const xs = snapshot.nodes.map((n) => nodeCentre(n).x);
        const ys = snapshot.nodes.map((n) => nodeCentre(n).y);
        peer.setCursor({
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        });
      } else {
        peer.setCursor({ x: 0, y: 0 });
      }

      return jsonResult({
        connected: true,
        instanceId: input.instanceId,
        room: peer.roomName,
        wsUrl: instance.wsUrl,
        ...snapshot,
      });
    },
  );

  server.registerTool(
    'disconnect',
    {
      description: "Disconnect from an instance's board. Removes this peer from awareness.",
      inputSchema: { instanceId: instanceIdField },
    },
    async (input) => {
      const peer = peers.get(input.instanceId);
      if (!peer) return textResult(`Not connected to instance "${input.instanceId}".`);
      peer.destroy();
      peers.delete(input.instanceId);
      return textResult(`Disconnected from instance "${input.instanceId}".`);
    },
  );

  // ── Instances (discovery + health) ────────────────────────────────────────

  server.registerTool(
    'list_instances',
    {
      description: [
        'List the figemite server instances this MCP can currently reach.',
        'Includes your own local server (id "local") plus any discovered over mDNS.',
        'Each entry has an id, name, url, boards, version, and health/last-seen.',
        'Stopped/crashed instances drop off automatically via health checks.',
        'Use an instance id here as the instanceId for connect_board and the',
        'board/draft management tools.',
      ].join(' '),
      inputSchema: {},
    },
    async () => jsonResult({ instances: registry.list() }),
  );

  // ── Board management (HTTP; no connection required) ──────────────────────

  server.registerTool(
    'list_boards',
    {
      description: [
        'List all boards on a specific figemite instance (pass its instanceId from list_instances).',
        "Does not require connect_board first. Returns each board's slug, label, tags,",
        'last-modified time, and sub-board paths.',
      ].join(' '),
      inputSchema: { instanceId: instanceIdField },
    },
    async (input) => jsonResult(await listBoards(resolveInstance(input.instanceId).httpUrl)),
  );

  server.registerTool(
    'create_board',
    {
      description: [
        'Create a new, empty board on a specific figemite instance (pass its instanceId).',
        'Does not require connect_board first — call connect_board with the same instanceId',
        'and the returned slug afterwards to start editing it.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        slug: z.string().describe('Lowercase, hyphenated board slug, e.g. "payment-flow"'),
        label: z
          .string()
          .optional()
          .describe('Display label; defaults to a titlecased version of the slug'),
      },
    },
    async (input) =>
      jsonResult(await createBoard(resolveInstance(input.instanceId).httpUrl, input.slug, input.label)),
  );

  // ── Drafts (HTTP; no connection required) ─────────────────────────────────
  //
  // Agents work in DRAFTS so a human can review + approve changes before they
  // overwrite the live board. There is deliberately NO promote/approve tool —
  // promotion is a human-only browser action, exactly as comments/tags stay
  // human-owned by having no MCP tools (see AGENTS.md).

  server.registerTool(
    'list_drafts',
    {
      description: [
        'List the drafts of a board on a specific instance (id, title, who created it, when).',
        'Use a draft id with connect_board (same instanceId) to edit inside that draft.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        slug: z.string().describe('Board slug, e.g. "spend"'),
      },
    },
    async (input) => jsonResult(await listDrafts(resolveInstance(input.instanceId).httpUrl, input.slug)),
  );

  server.registerTool(
    'create_draft',
    {
      description: [
        'Create a new draft of a board — a full copy you can edit safely without',
        'touching the live ("prod") board. Returns the new draft id; pass it as',
        '`draft` to connect_board to start editing inside the draft. A human',
        'reviews the draft and approves it (in their browser) to overwrite prod;',
        'you cannot approve it yourself.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        slug: z.string().describe('Board slug to draft, e.g. "spend"'),
        title: z
          .string()
          .optional()
          .describe('Human-readable title for the draft; defaults to "Draft #N" (N = current draft count + 1)'),
      },
    },
    async (input) =>
      jsonResult(await createDraft(resolveInstance(input.instanceId).httpUrl, input.slug, input.title)),
  );

  // ── Reads (require connection) ───────────────────────────────────────────

  server.registerTool(
    'get_board',
    {
      description: 'Return the current state of all nodes and edges on the board.',
      inputSchema: { instanceId: instanceIdField },
    },
    async (input) => jsonResult(getBoard(assertConnected(input.instanceId))),
  );

  server.registerTool(
    'get_node',
    {
      description: 'Return a single node by id.',
      inputSchema: { instanceId: instanceIdField, id: z.string().describe('Node id') },
    },
    async (input) => {
      const node = getNode(assertConnected(input.instanceId), input.id);
      if (!node) throw new Error(`Node "${input.id}" not found`);
      return jsonResult(node);
    },
  );

  server.registerTool(
    'list_nodes',
    {
      description: 'List nodes on the board, optionally filtered by type.',
      inputSchema: {
        instanceId: instanceIdField,
        type: z
          .string()
          .optional()
          .describe('Filter by node type: sticky, text, shape, frame, emoji, icon, drawing'),
      },
    },
    async (input) => jsonResult(listNodes(assertConnected(input.instanceId), input.type)),
  );

  // ── Presence ──────────────────────────────────────────────────────────────

  server.registerTool(
    'move_cursor',
    {
      description: 'Move the AI cursor to a flow-space position. Humans see it move in real time.',
      inputSchema: {
        instanceId: instanceIdField,
        x: z.number().describe('Flow-space X coordinate'),
        y: z.number().describe('Flow-space Y coordinate'),
      },
    },
    async (input) => {
      assertConnected(input.instanceId).setCursor({ x: input.x, y: input.y });
      return textResult(`Cursor moved to (${input.x}, ${input.y})`);
    },
  );

  server.registerTool(
    'set_editing',
    {
      description: [
        "Show or hide the AI's editing outline on a node.",
        'Pass a nodeId to show an outline (browsers see "[AI name] editing" label).',
        'Pass null to clear.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        nodeId: z.string().nullable().describe('Node id to outline, or null to clear'),
      },
    },
    async (input) => {
      const p = assertConnected(input.instanceId);
      if (input.nodeId) {
        const node = getNode(p, input.nodeId);
        if (node) await leadCursor(p, nodeCentre(node));
      }
      p.setEditing(input.nodeId);
      return textResult(
        input.nodeId ? `Editing outline on "${input.nodeId}"` : 'Editing outline cleared',
      );
    },
  );

  server.registerTool(
    'set_viewport',
    {
      description: "Publish the AI's current viewport so humans can optionally follow it.",
      inputSchema: {
        instanceId: instanceIdField,
        x: z.number().describe('Viewport X offset (screen pixels)'),
        y: z.number().describe('Viewport Y offset (screen pixels)'),
        zoom: z.number().describe('Zoom level (1 = 100%)'),
      },
    },
    async (input) => {
      assertConnected(input.instanceId).setViewport({ x: input.x, y: input.y, zoom: input.zoom });
      return textResult(`Viewport set to (${input.x}, ${input.y}) zoom=${input.zoom}`);
    },
  );

  // ── Node ops ──────────────────────────────────────────────────────────────

  server.registerTool(
    'add_node',
    {
      description: [
        "Add a node to the board. Returns the new node's id.",
        'Required: type ("sticky"|"text"|"shape"|"frame"|"emoji"|"icon") and pos {x,y}.',
        'For sticky/frame: also provide size and color.',
        'For shape: also provide shape ("rect"|"ellipse"|"diamond"|...) and color.',
        'For emoji: provide text (emoji glyph) and size (px).',
        'For icon: provide name (icon registry key), size (px), and color.',
        'For pencil strokes ("drawing"): use add_drawing instead — it takes',
        'absolute points and computes the bbox for you.',
        'Text content (text/title) can be provided here or set later with set_node_text.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        type: z.string().describe('Node type'),
        pos: z.object({ x: z.number(), y: z.number() }).describe('Flow-space position'),
        id: z.string().optional().describe('Optional stable id; auto-generated if omitted'),
        size: z.object({ width: z.number(), height: z.number() }).optional(),
        color: z.string().optional().describe('Hex color, e.g. "#fef3c7"'),
        shape: z
          .enum([
            'rect',
            'ellipse',
            'roundRect',
            'diamond',
            'triangle',
            'parallelogram',
            'hexagon',
            'pentagon',
            'star',
            'cylinder',
            'cloud',
            'arrow',
          ])
          .optional()
          .describe('Shape kind for shape nodes'),
        text: z.string().optional().describe('Text content'),
        title: z.string().optional().describe('Title (for frame nodes)'),
        name: z.string().optional().describe('Icon name (for icon nodes)'),
        rotation: z.number().optional(),
        description: z.string().optional().describe('Markdown description shown in the ≡ badge'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      await leadCursor(p, centreOf(input.pos, input.size));
      const id = addNode(p, input);
      return jsonResult({ id });
    },
  );

  server.registerTool(
    'add_drawing',
    {
      description: [
        'Add a `drawing` node (pencil stroke) to the board.',
        'Pass `points` in ABSOLUTE canvas-space — the server computes the bbox',
        "and rebases them to be relative to the node's pos (matching the browser",
        "pencil tool). Returns the new node's id.",
        'Defaults: color = "#1e293b", strokeWidth = 3.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        points: z
          .array(z.object({ x: z.number(), y: z.number() }))
          .min(1)
          .describe('Absolute canvas-space points along the stroke'),
        color: z.string().optional().describe('Stroke colour, e.g. "#7c3aed"'),
        strokeWidth: z.number().optional().describe('Stroke width in px (default 3)'),
        id: z.string().optional().describe('Optional stable id; auto-generated if omitted'),
        description: z.string().optional().describe('Markdown description shown in the ≡ badge'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      await sweepCursorAlong(p, input.points);
      const id = addDrawing(p, input);
      return jsonResult({ id });
    },
  );

  server.registerTool(
    'update_node',
    {
      description:
        'Update fields on an existing node. Only provided keys are changed; others are left intact.',
      inputSchema: {
        instanceId: instanceIdField,
        id: z.string().describe('Node id to update'),
        patch: z.record(z.string(), z.unknown()).describe('Key-value pairs to merge into the node'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const existing = getNode(p, input.id);
      if (existing) {
        const patch = input.patch as { pos?: XY; size?: unknown };
        const nextPos = patch.pos ?? existing.pos;
        const nextSize = patch.size ?? ('size' in existing ? existing.size : undefined);
        await leadCursor(p, centreOf(nextPos, nextSize));
      }
      updateNode(p, input.id, input.patch);
      return textResult(`Node "${input.id}" updated.`);
    },
  );

  server.registerTool(
    'move_node',
    {
      description: 'Move a node to a new flow-space position.',
      inputSchema: {
        instanceId: instanceIdField,
        id: z.string().describe('Node id'),
        pos: z.object({ x: z.number(), y: z.number() }).describe('New position'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const existing = getNode(p, input.id);
      await leadCursor(
        p,
        centreOf(input.pos, existing && 'size' in existing ? existing.size : undefined),
      );
      moveNode(p, input.id, input.pos);
      return textResult(`Node "${input.id}" moved to (${input.pos.x}, ${input.pos.y}).`);
    },
  );

  server.registerTool(
    'delete_node',
    {
      description: 'Delete a node from the board.',
      inputSchema: { instanceId: instanceIdField, id: z.string().describe('Node id to delete') },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const doomed = getNode(p, input.id);
      if (doomed) await leadCursor(p, nodeCentre(doomed));
      deleteNode(p, input.id);
      return textResult(`Node "${input.id}" deleted.`);
    },
  );

  server.registerTool(
    'set_node_text',
    {
      description: [
        'Set the text content of a node.',
        'For frame nodes this sets the frame title.',
        'Text changes are applied granularly to the nodeTexts Y.Map so concurrent',
        'edits from humans are not overwritten.',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        id: z.string().describe('Node id'),
        text: z.string().describe('New text (or frame title)'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const node = getNode(p, input.id);
      if (node) await leadCursor(p, nodeCentre(node));
      setNodeText(p, input.id, input.text);
      return textResult(`Text on "${input.id}" set.`);
    },
  );

  server.registerTool(
    'set_description',
    {
      description: [
        'Set the Markdown description on a node — shown behind the ≡ badge in the browser.',
        'Equivalent to update_node with a { description } patch, but a dedicated tool for',
        'this common case (per-node descriptions are a core part of the board format).',
      ].join(' '),
      inputSchema: {
        instanceId: instanceIdField,
        id: z.string().describe('Node id'),
        description: z.string().describe('Markdown description text'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const node = getNode(p, input.id);
      if (node) await leadCursor(p, nodeCentre(node));
      setDescription(p, input.id, input.description);
      return textResult(`Description set on "${input.id}".`);
    },
  );

  // ── Edge ops ──────────────────────────────────────────────────────────────

  server.registerTool(
    'add_edge',
    {
      description: 'Add an edge (arrow or cardinality line) between two nodes.',
      inputSchema: {
        instanceId: instanceIdField,
        source: z.string().describe('Source node id'),
        target: z.string().describe('Target node id'),
        id: z.string().optional(),
        style: z.enum(['solid', 'dashed']).optional(),
        kind: z.enum(['arrow', 'cardinality']).optional(),
        arrow: z.enum(['none', 'end', 'both']).optional(),
        cardinality: z.enum(['1:1', '1:N', 'N:1', 'N:N']).optional(),
        label: z.string().optional().describe('Label shown at the edge midpoint'),
        sourceHandle: z.enum(['t', 'r', 'b', 'l']).nullable().optional(),
        targetHandle: z.enum(['t', 'r', 'b', 'l']).nullable().optional(),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      // Trace source -> target so the AI looks like it's "drawing" the
      // connection, not teleporting to dead space between the two nodes.
      const a = getNode(p, input.source);
      const b = getNode(p, input.target);
      if (a) {
        p.setCursor(nodeCentre(a));
        await delay(CURSOR_LEAD_MS);
      }
      if (b) {
        p.setCursor(nodeCentre(b));
        await delay(CURSOR_LEAD_MS);
      }
      const id = addEdge(p, input);
      return jsonResult({ id });
    },
  );

  server.registerTool(
    'update_edge',
    {
      description: 'Update fields on an existing edge.',
      inputSchema: {
        instanceId: instanceIdField,
        id: z.string().describe('Edge id'),
        patch: z.record(z.string(), z.unknown()).describe('Key-value pairs to merge'),
      },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const existingEdge = getBoard(p).edges.find((e) => e.id === input.id);
      if (existingEdge) {
        await leadCursor(p, edgeMidpoint(p, existingEdge.source, existingEdge.target));
      }
      updateEdge(p, input.id, input.patch);
      return textResult(`Edge "${input.id}" updated.`);
    },
  );

  server.registerTool(
    'delete_edge',
    {
      description: 'Delete an edge.',
      inputSchema: { instanceId: instanceIdField, id: z.string().describe('Edge id to delete') },
    },
    async (input) => {
      const p = assertEditable(input.instanceId);
      const doomedEdge = getBoard(p).edges.find((e) => e.id === input.id);
      if (doomedEdge) await leadCursor(p, edgeMidpoint(p, doomedEdge.source, doomedEdge.target));
      deleteEdge(p, input.id);
      return textResult(`Edge "${input.id}" deleted.`);
    },
  );

  return server;
}

export type { Instance };
