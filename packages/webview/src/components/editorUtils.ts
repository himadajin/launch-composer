import { useEffect } from 'react';

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

export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
