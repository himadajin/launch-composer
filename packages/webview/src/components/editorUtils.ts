export const DEBUG_REQUEST_OPTIONS = ['launch', 'attach'] as const;

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

export function withConfiguration<
  T extends { configuration?: Record<string, unknown> },
>(data: T, config: Record<string, unknown>): T {
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
