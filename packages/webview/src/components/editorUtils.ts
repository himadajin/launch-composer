import { useEffect, useRef } from 'react';

export const DEBUG_REQUEST_OPTIONS = ['launch', 'attach'] as const;

export function useDebouncedCommit(
  value: string,
  delay: number,
  onCommit: (value: string) => void,
) {
  // Keep onCommit in a ref so the timer always calls the latest version
  // without needing it in the effect's dependency array. This mirrors
  // VS Code's "register handler after value is set" pattern: programmatic
  // value updates (useEffect syncs from data props) don't restart the timer.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onCommitRef.current(value);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
    // onCommit is intentionally excluded — always current via ref above
  }, [delay, value]);
}

export function updateOptionalString<T extends Record<string, unknown>>(
  data: T,
  key: string,
  value: string,
): T {
  const next: Record<string, unknown> = { ...data };
  if (value.trim() === '') {
    delete next[key];
  } else {
    next[key] = value;
  }

  return next as T;
}

export function updateOptionalArray<T extends Record<string, unknown>>(
  data: T,
  key: string,
  value: string[] | undefined,
): T {
  const next: Record<string, unknown> = { ...data };
  if (value === undefined || value.length === 0) {
    delete next[key];
  } else {
    next[key] = value;
  }

  return next as T;
}

export function updateRequiredString<T extends Record<string, unknown>>(
  data: T,
  key: string,
  value: string,
): T {
  return {
    ...data,
    [key]: value,
  };
}

export function withConfiguration<T extends { configuration?: Record<string, unknown> }>(
  data: T,
  config: Record<string, unknown>,
): T {
  if (Object.keys(config).length === 0) {
    const next = { ...data };
    delete next.configuration;
    return next;
  }
  return { ...data, configuration: config } as T;
}

export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeDebugRequest(
  value: unknown,
): (typeof DEBUG_REQUEST_OPTIONS)[number] {
  return isDebugRequest(value) ? value : 'launch';
}

function isDebugRequest(
  value: unknown,
): value is (typeof DEBUG_REQUEST_OPTIONS)[number] {
  return (
    typeof value === 'string' &&
    DEBUG_REQUEST_OPTIONS.some((entry) => entry === value)
  );
}
