// ── DescriptionModal: TipTap markdown editor for a node's description ───────
//
// Ported from the legacy figmalade prototype's
// `src/components/DescriptionModal.tsx`, same visual design and the same
// TipTap extension set (StarterKit + TaskList/TaskItem + Markdown — see
// package.json's `@tiptap/*` deps, all MIT). Deviations:
//
//   - This component is store-agnostic: it takes `initialText`/`onSave`
//     (a plain string in, a plain markdown string out) rather than a node id
//     or store reference. The caller (the editable canvas, which owns "which
//     node's description is open" state per this task's spec) is responsible
//     for wiring `onSave` to `store.updateNode(id, { description })`.
//   - `readOnly` omits `onSave` (typed optional) — a readonly render never
//     calls it, matching "write disabled in readonly."
//   - Named export (`DescriptionModal`), matching this codebase's `Toolbar`/
//     `MultiSelectResizer`/etc. convention rather than the legacy's default
//     export.

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';

export interface DescriptionModalProps {
  nodeLabel: string;
  initialText: string;
  readOnly?: boolean;
  /** Called with the edited markdown when Save is clicked (or Cmd/Ctrl+Enter).
   * Not called in `readOnly` mode (there's no Save affordance to trigger it). */
  onSave?: (text: string) => void;
  onClose: () => void;
}

const TOOLBAR_BTN: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '3px 7px',
  borderRadius: 4,
  fontSize: 12,
  color: '#475569',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

const TOOLBAR_BTN_ACTIVE: CSSProperties = {
  ...TOOLBAR_BTN,
  background: '#e2e8f0',
  color: '#1e293b',
};

function ToolbarDivider() {
  return (
    <div style={{ width: 1, height: 16, background: '#e2e8f0', margin: '0 2px', flexShrink: 0 }} />
  );
}

function ToolbarBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      style={active ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
      title={title}
    >
      {children}
    </button>
  );
}

function EditorToolbar({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        padding: '5px 12px',
        borderBottom: '1px solid #e2e8f0',
        flexShrink: 0,
        flexWrap: 'wrap',
        background: '#f8fafc',
      }}
    >
      <ToolbarBtn
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (⌘B)"
      >
        <b>B</b>
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (⌘I)"
      >
        <i>I</i>
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <s>S</s>
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
      >
        {'`'}
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        H1
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        H2
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        H3
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        • list
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Ordered list"
      >
        1. list
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="Task list"
      >
        ☑ tasks
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
      >
        &#10077;
      </ToolbarBtn>
      <ToolbarBtn
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Code block"
      >
        {'</>'}
      </ToolbarBtn>
    </div>
  );
}

export function DescriptionModal({
  nodeLabel,
  initialText,
  readOnly = false,
  onSave,
  onClose,
}: DescriptionModalProps) {
  const editor = useEditor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Markdown],
    content: initialText,
    // The `content` string is markdown (this is a description editor, not an
    // HTML/JSON one) — without this, @tiptap/markdown's default `contentType:
    // 'json'` treats `initialText` as a bare JSON-less string and the editor
    // starts empty instead of parsing e.g. "Some **existing** notes".
    contentType: 'markdown',
    editable: !readOnly,
    autofocus: !readOnly ? 'end' : false,
  });

  const doSave = () => {
    if (!editor) return;
    // @tiptap/markdown augments the editor instance with getMarkdown().
    const md: string = (editor as unknown as { getMarkdown: () => string }).getMarkdown();
    onSave?.(md.trim());
    onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (!readOnly && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        doSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doSave closes over `editor`/`onSave`/`onClose`, which change every render; re-running this effect every render would thrash the listener for no benefit.
  }, [readOnly, onClose, editor]);

  const isEmpty = !editor || !editor.getText().trim();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          width: 580,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {readOnly ? 'Description' : 'Edit description'}
            </span>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginTop: 2 }}>
              {nodeLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#94a3b8',
              fontSize: 20,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 4,
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Formatting toolbar — edit mode only */}
        {!readOnly && editor && <EditorToolbar editor={editor} />}

        {/* Editor body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {isEmpty && readOnly ? (
            <div style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>
              No description.
            </div>
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>

        {/* Footer — edit mode only */}
        {!readOnly && (
          <div
            style={{
              padding: '10px 20px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 'auto' }}>
              ⌘ + Enter to save · Esc to cancel
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                background: '#fff',
                color: '#64748b',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doSave}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid #1e293b',
                borderRadius: 6,
                background: '#1e293b',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Save
            </button>
          </div>
        )}
      </div>

      <style>{`
        .tiptap {
          outline: none;
          font-size: 13px;
          line-height: 1.75;
          color: #1e293b;
          min-height: 180px;
        }
        .tiptap > * + * { margin-top: 6px; }
        .tiptap h1 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
        .tiptap h2 { font-size: 15px; font-weight: 700; margin: 0 0 4px; }
        .tiptap h3 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
        .tiptap p  { margin: 0; }
        .tiptap ul, .tiptap ol { padding-left: 20px; margin: 0; }
        .tiptap li { margin-bottom: 2px; }
        .tiptap li p { margin: 0; }
        .tiptap code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 12px; }
        .tiptap pre  { background: #f1f5f9; padding: 10px 14px; border-radius: 6px; overflow: auto; }
        .tiptap pre code { background: none; padding: 0; }
        .tiptap blockquote { border-left: 3px solid #cbd5e1; padding: 2px 12px; color: #64748b; margin: 0; }
        .tiptap a { color: #2563eb; text-decoration: underline; }
        .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
        .tiptap ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 6px; }
        .tiptap ul[data-type="taskList"] > li > label { flex-shrink: 0; margin-top: 3px; }
        .tiptap ul[data-type="taskList"] > li > div { flex: 1; }
        .tiptap hr { border: none; border-top: 1px solid #e2e8f0; }
        .tiptap p.is-editor-empty:first-child::before {
          content: 'Write a description…';
          color: #94a3b8;
          pointer-events: none;
          float: left;
          height: 0;
        }
      `}</style>
    </div>
  );
}
