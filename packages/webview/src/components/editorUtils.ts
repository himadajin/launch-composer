import { useEffect } from 'react';

export const DEBUG_REQUEST_OPTIONS = ['launch', 'attach'] as const;

export function useDebouncedCommit(
  value: string,
  delay: number,
  onCommit: (value: string) => void,
) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onCommit(value);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [delay, onCommit, value]);
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
