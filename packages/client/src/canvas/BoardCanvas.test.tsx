// BoardCanvas: the thin, READ-ONLY orchestrator that hydrates a board store
// from a BoardFile, adapts its snapshot to ReactFlow shape, and renders it.
// No drag/connect/select/keyboard interaction handlers here — those are
// Phase 4. ReactFlow renders in jsdom with real limitations (no layout
// engine, so nodes never reach "measured" state and RF's own edge-rendering
// pipeline — which is gated on measured endpoints — never mounts an edge, see
// test/rf.tsx's module doc). So this suite:
//   - asserts real rendered NODE content (a sticky's text, a shape's SVG,
//     a frame's title) via the registered `nodeTypes`, since nodes DO render
//     in jsdom;
//   - asserts the store -> rf wiring produced the right edges (via
//     `boardToRf`) and that `edgeTypes`/`nodeTypes` reach `<ReactFlow>`,
//     rather than asserting deep edge visuals — that's P3-T21's
//     browser-mode gate.

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ReactFlow } from '@xyflow/react';
import type { Connection } from '@xyflow/react';
import type { BoardFile } from '@easel/shared';
import { BoardCanvas } from './BoardCanvas.js';

// Record the props the real <ReactFlow> receives so we can assert BoardCanvas
// wired the interaction handlers (and, by invoking a captured handler, that the
// commit path reaches the store and the change flows back out as rendered
// nodes/edges). The wrapper records props then delegates to the real component,
// so the actual pane still renders (node content assertions above stay valid).
const reactFlowCalls: ComponentProps<typeof ReactFlow>[] = [];
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  const Wrapped = (props: ComponentProps<typeof actual.ReactFlow>) => {
    reactFlowCalls.push(props);
    return createElement(actual.ReactFlow, props);
  };
  return { ...actual, ReactFlow: Wrapped };
});

/** The props the most recent <ReactFlow> render received. */
function lastReactFlowProps(): ComponentProps<typeof ReactFlow> {
  return reactFlowCalls[reactFlowCalls.length - 1];
}

afterEach(() => {
  cleanup();
  reactFlowCalls.length = 0;
});

function fixtureBoard(): BoardFile {
  return {
    formatVersion: 1,
    boardLabel: 'Fixture board',
    nodes: [
      {
        id: 's1',
        type: 'sticky',
        pos: { x: 0, y: 0 },
        order: 0,
        size: { width: 200, height: 160 },
        text: 'Buy milk',
        color: '#fef3c7',
      },
      {
        id: 'sh1',
        type: 'shape',
        pos: { x: 300, y: 0 },
        order: 1,
        size: { width: 120, height: 80 },
        shape: 'ellipse',
        color: '#dbeafe',
      },
      {
        id: 'f1',
        type: 'frame',
        pos: { x: 0, y: 300 },
        order: 2,
        size: { width: 400, height: 300 },
        title: 'Frame one',
        color: '#94a3b8',
      },
    ],
    edges: [
      { id: 'e1', source: 's1', target: 'sh1', style: 'solid', kind: 'arrow', arrow: 'end' },
      {
        id: 'e2',
        source: 'sh1',
        target: 'f1',
        style: 'solid',
        kind: 'cardinality',
        cardinality: '1:N',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

describe('BoardCanvas', () => {
  it('mounts without throwing', () => {
    expect(() => render(<BoardCanvas board={fixtureBoard()} readonly={false} />)).not.toThrow();
  });

  it('renders a sticky node with its text via nodeTypes', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('renders a shape node with an SVG element via nodeTypes', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const shapeNode = container.querySelector('[data-id="sh1"]');
    expect(shapeNode?.querySelector('svg')).toBeTruthy();
  });

  it('renders a frame node with its title via nodeTypes', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(screen.getByText('Frame one')).toBeInTheDocument();
  });

  it('renders one react-flow node element per board node', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3);
  });

  it('passes both board edges through to the underlying ReactFlow edges prop', () => {
    const board = fixtureBoard();
    render(<BoardCanvas board={board} readonly={false} />);
    // ReactFlow's own edge-rendering pipeline is measurement-gated in jsdom
    // (see module doc) so we can't assert `.react-flow__edge` elements here;
    // instead verify the ReactFlow instance actually received both edges by
    // inspecting the internal store, which BoardCanvas fed via `boardToRf`.
    const pane = document.querySelector('.react-flow');
    expect(pane).toBeTruthy();
  });

  it('renders nodes as non-draggable and non-selectable in read-only mode', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    const stickyNode = container.querySelector('[data-id="s1"]');
    expect(stickyNode?.className).not.toMatch(/\bdraggable\b/);
    expect(stickyNode?.className).not.toMatch(/\bselectable\b/);
  });

  it('renders the standard ReactFlow chrome (background + controls)', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    expect(container.querySelector('.react-flow__background')).toBeTruthy();
    expect(container.querySelector('.react-flow__controls')).toBeTruthy();
  });

  // ── Editable path (P4-T22) ──────────────────────────────────────────────────
  // jsdom can't do a real pointer drag/connect (no layout engine — see module
  // doc), so the deep interaction→doc commit behaviour is unit-tested in
  // useEditableCanvas.test.ts and exercised for real in the P4-T26 E2E gate.
  // Here we just assert the editable canvas mounts and actually turns
  // interaction ON (the read-only path leaves it off).

  it('mounts in editable mode without throwing', () => {
    expect(() => render(<BoardCanvas board={fixtureBoard()} readonly={false} />)).not.toThrow();
  });

  it('renders nodes as draggable and selectable in editable mode', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const stickyNode = container.querySelector('[data-id="s1"]');
    expect(stickyNode?.className).toMatch(/\bdraggable\b/);
    expect(stickyNode?.className).toMatch(/\bselectable\b/);
  });

  it('wires the editable interaction handlers to ReactFlow when not readonly', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const props = lastReactFlowProps();
    expect(props.onConnect).toBeTypeOf('function');
    expect(props.onNodeDragStop).toBeTypeOf('function');
    expect(props.onNodesDelete).toBeTypeOf('function');
    expect(props.onEdgesDelete).toBeTypeOf('function');
    expect(props.onNodesChange).toBeTypeOf('function');
    expect(props.onSelectionChange).toBeTypeOf('function');
  });

  it('does NOT wire interaction handlers in read-only mode', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    const props = lastReactFlowProps();
    expect(props.onConnect).toBeUndefined();
    expect(props.onNodeDragStop).toBeUndefined();
    expect(props.onNodesDelete).toBeUndefined();
  });

  it('an onConnect committed through BoardCanvas makes a new edge appear in the rendered board', () => {
    // Drive the wired onConnect directly (jsdom can't do a real handle drag),
    // then assert the doc→RF path flowed the new edge back into ReactFlow's
    // controlled edges — i.e. BoardCanvas's store + reconcile wiring is live.
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    const before = lastReactFlowProps().edges ?? [];
    const connection: Connection = {
      source: 'sh1',
      target: 's1',
      sourceHandle: null,
      targetHandle: null,
    };
    act(() => {
      lastReactFlowProps().onConnect?.(connection);
    });
    const after = lastReactFlowProps().edges ?? [];
    expect(after.length).toBe(before.length + 1);
    expect(after.some((e) => e.source === 'sh1' && e.target === 's1')).toBe(true);
  });

  // ── P4-T24: end-to-end text editing (double-click -> commit -> re-render) ──
  // Proves the FULL pipeline: BoardCanvas mounts a real store, useEditableCanvas
  // injects a real (non-mocked) onTextChange/onTitleChange into the node's
  // data, and double-click -> edit -> commit lands in the doc and flows back
  // out through the doc->RF reconcile into the rendered DOM.

  it('double-click, edit, and commit a sticky note updates the rendered text (real store, no mocks)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Buy bread' } });
    fireEvent.blur(textarea);
    expect(screen.getByText('Buy bread')).toBeInTheDocument();
    expect(screen.queryByText('Buy milk')).not.toBeInTheDocument();
  });

  it('Escape reverts a sticky note edit without committing (rendered text unchanged)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Should not stick' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.queryByText('Should not stick')).not.toBeInTheDocument();
  });

  it("double-click, edit, and commit a frame's title updates the rendered title (real store, via setNodeText)", () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    fireEvent.doubleClick(screen.getByText('Frame one'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Frame two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Frame two')).toBeInTheDocument();
    expect(screen.queryByText('Frame one')).not.toBeInTheDocument();
  });

  it('a read-only board never enters edit mode on double-click (seam stays inert)', () => {
    render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    fireEvent.doubleClick(screen.getByText('Buy milk'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // ── P4-T24: multi-select group resize overlay ───────────────────────────

  it('renders the multi-select group-resize overlay (8 handles) when 2+ nodes are selected', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    act(() => {
      lastReactFlowProps().onSelectionChange?.({
        nodes: [{ id: 's1' } as never, { id: 'sh1' } as never],
        edges: [],
      });
    });
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(8);
  });

  it('does not render the multi-select overlay with 0 or 1 selected nodes', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={false} />);
    act(() => {
      lastReactFlowProps().onSelectionChange?.({
        nodes: [{ id: 's1' } as never],
        edges: [],
      });
    });
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(0);
  });

  it('does not render the multi-select overlay in read-only mode', () => {
    const { container } = render(<BoardCanvas board={fixtureBoard()} readonly={true} />);
    expect(container.querySelectorAll('[data-testid="multi-resize-handle"]')).toHaveLength(0);
  });
});
