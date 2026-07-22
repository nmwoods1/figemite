// ── DescriptionReadOnlyContext ───────────────────────────────────────────────
//
// A tiny cross-cutting signal for "descriptions are VIEW-ONLY in this subtree".
// On the live (content-locked) board a node's description can still be OPENED
// and read, but not added or edited — so the description badge must not offer
// the hover-to-add affordance, and the modal opens read-only.
//
// Rather than thread a `descriptionReadOnly` flag through `boardToRf` → each
// node component → `BaseNode` (the node components map `data` to explicit
// BaseNode props, so that would touch every describable node type), this is
// provided ONCE around the editable pane's ReactFlow subtree (BoardCanvas's
// `EditableCanvas`) and consumed directly by `BaseNode`. ReactFlow renders
// custom nodes within the React tree under the provider, so the context
// reaches them normally.
//
// Default `false` (descriptions editable) keeps every existing render path —
// drafts, unit tests that render nodes without a provider — behaving exactly
// as before; only the live board sets it `true`.

import { createContext } from 'react';

export const DescriptionReadOnlyContext = createContext(false);
