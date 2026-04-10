import {
  applyEdits,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser/lib/esm/main.js';

export interface JsonParseIssue {
  code: string;
  offset: number;
}

export type JsonObjectPatchOperation =
  | {
      type: 'set';
      path: (string | number)[];
      value: unknown;
    }
  | {
      type: 'delete';
      path: (string | number)[];
    };

const JSON_FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
} as const;

export function parseJsoncDocument<T>(text: string): {
  value: T;
  issues: JsonParseIssue[];
} {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  return {
    value: value as T,
    issues: errors.map((error) => ({
      code: printParseErrorCode(error.error),
      offset: error.offset,
    })),
  };
}

export function parseJsonc<T>(text: string, label: string): T {
  const { value, issues } = parseJsoncDocument<T>(text);

  if (issues.length > 0) {
    const details = issues
      .map((issue) => `${issue.code} at ${issue.offset}`)
      .join(', ');
    throw new Error(`Failed to parse ${label}: ${details}`);
  }

  return value;
}

export function stringifyJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function applyJsonDocumentPatches(
  text: string,
  patches: JsonObjectPatchOperation[],
): string {
  let nextText = text;
  const hadTrailingNewline = text.endsWith('\n');

  for (const patch of patches) {
    const edits = modify(
      nextText,
      patch.path,
      patch.type === 'set' ? patch.value : undefined,
      {
        formattingOptions: JSON_FORMATTING_OPTIONS,
      },
    );

    nextText = applyEdits(nextText, edits);
  }

  if (hadTrailingNewline) {
    return nextText.endsWith('\n') ? nextText : `${nextText}\n`;
  }

  return nextText.endsWith('\n') ? nextText.slice(0, -1) : nextText;
}

export function appendJsonArrayValue(
  text: string,
  path: (string | number)[],
  value: unknown,
): string {
  const parsed = parseJsoncDocument<unknown>(text);
  if (parsed.issues.length > 0) {
    const details = parsed.issues
      .map((issue) => `${issue.code} at ${issue.offset}`)
      .join(', ');
    throw new Error(`Failed to append array value: ${details}`);
  }

  const array = getJsonPathValue(parsed.value, path);
  if (!Array.isArray(array)) {
    throw new Error('Target path must resolve to a JSON array.');
  }

  return applyJsonDocumentPatches(text, [
    {
      type: 'set',
      path: [...path, array.length],
      value,
    },
  ]);
}

export function joinJsonPatchPath(
  prefix: (string | number)[],
  patches: JsonObjectPatchOperation[],
): JsonObjectPatchOperation[] {
  return patches.map((patch) => ({
    ...patch,
    path: [...prefix, ...patch.path],
  }));
}

export function findArrayEntryOffset(
  text: string,
  path: (string | number)[],
): number | null {
  const tree = parseTree(text, undefined, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  let node = tree;

  for (const segment of path) {
    if (node === undefined) {
      return null;
    }

    if (typeof segment === 'number') {
      if (node.type !== 'array' || node.children === undefined) {
        return null;
      }
      node = node.children[segment];
      continue;
    }

    if (node.type !== 'object' || node.children === undefined) {
      return null;
    }

    const property = node.children.find(
      (child) => child.children?.[0]?.value === segment,
    );
    node = property?.children?.[1];
  }

  return node?.offset ?? null;
}

export function createTextRevision(text: string): string {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${(hash >>> 0).toString(16)}:${text.length}`;
}

function getJsonPathValue(value: unknown, path: (string | number)[]): unknown {
  let current = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return undefined;
      }

      current = current[segment];
      continue;
    }

    if (typeof current !== 'object' || current === null) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
