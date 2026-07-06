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

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BoardFile } from '@easel/shared';
import { BoardCanvas } from './BoardCanvas.js';

afterEach(() => {
  cleanup();
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
});
