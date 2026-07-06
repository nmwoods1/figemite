// The edit state machine shared by Sticky/Text/Shape/Frame/Emoji: enter edit
// mode, track a draft independent of the committed value, commit on
// blur/Enter (calling the caller's onCommit), and cancel/revert on Escape.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditableText } from './useEditableText.js';

describe('useEditableText', () => {
  it('starts not editing, with draft equal to the initial value', () => {
    const { result } = renderHook(() => useEditableText('hello', vi.fn()));
    expect(result.current.editing).toBe(false);
    expect(result.current.draft).toBe('hello');
  });

  it('startEdit enters edit mode', () => {
    const { result } = renderHook(() => useEditableText('hello', vi.fn()));
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
  });

  it('onChange updates the draft while editing', () => {
    const { result } = renderHook(() => useEditableText('hello', vi.fn()));
    act(() => result.current.startEdit());
    act(() => result.current.onChange('hello world'));
    expect(result.current.draft).toBe('hello world');
  });

  it('commit calls onCommit with the draft and exits edit mode', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditableText('hello', onCommit));
    act(() => result.current.startEdit());
    act(() => result.current.onChange('changed'));
    act(() => result.current.commit());
    expect(onCommit).toHaveBeenCalledWith('changed');
    expect(result.current.editing).toBe(false);
  });

  it('commit does not call onCommit when the draft is unchanged', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditableText('hello', onCommit));
    act(() => result.current.startEdit());
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it('cancel reverts the draft to the original value and exits edit mode without committing', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditableText('hello', onCommit));
    act(() => result.current.startEdit());
    act(() => result.current.onChange('changed'));
    act(() => result.current.cancel());
    expect(result.current.editing).toBe(false);
    expect(result.current.draft).toBe('hello');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('updates the draft when the underlying value changes externally while not editing', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useEditableText(value, vi.fn()),
      { initialProps: { value: 'hello' } },
    );
    rerender({ value: 'updated externally' });
    expect(result.current.draft).toBe('updated externally');
  });
});
