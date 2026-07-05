import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditableField } from '../src/components/hooks.js';

const DELAY = 300;

describe('useEditableField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not commit when the editor merely opens', () => {
    const commit = vi.fn();
    renderHook(() => useEditableField('initial', DELAY, commit));

    act(() => {
      vi.advanceTimersByTime(DELAY * 2);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('commits user input once after the debounce delay', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useEditableField('initial', DELAY, commit),
    );

    act(() => {
      result.current.onChange('typed');
    });
    expect(result.current.value).toBe('typed');
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DELAY);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('typed');
  });

  it('debounces rapid input and commits only the last value', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useEditableField('initial', DELAY, commit),
    );

    act(() => {
      result.current.onChange('a');
    });
    act(() => {
      vi.advanceTimersByTime(DELAY - 1);
    });
    act(() => {
      result.current.onChange('ab');
    });
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('ab');
  });

  it('syncs from external data and does not commit the synced value', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ external }) => useEditableField(external, DELAY, commit),
      { initialProps: { external: 'one' } },
    );

    act(() => {
      result.current.onChange('typed');
    });
    rerender({ external: 'two' });

    expect(result.current.value).toBe('two');

    act(() => {
      vi.advanceTimersByTime(DELAY * 2);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('does not commit while readOnly', () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useEditableField('initial', DELAY, commit, { readOnly: true }),
    );

    act(() => {
      result.current.onChange('typed');
    });
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps committing subsequent edits after an external sync', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ external }) => useEditableField(external, DELAY, commit),
      { initialProps: { external: 'one' } },
    );

    rerender({ external: 'two' });
    act(() => {
      result.current.onChange('three');
    });
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('three');
  });
});
