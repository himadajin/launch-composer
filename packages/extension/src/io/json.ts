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
      key: string;
      value: unknown;
    }
  | {
      type: 'delete';
      key: string;
    };

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

export function applyArrayObjectPatch(
  text: string,
  index: number,
  patches: JsonObjectPatchOperation[],
): string {
  let nextText = text;

  for (const patch of patches) {
    const edits = modify(
      nextText,
      [index, patch.key],
      patch.type === 'set' ? patch.value : undefined,
      {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: '\n',
        },
      },
    );

    nextText = applyEdits(nextText, edits);
  }

  return nextText.endsWith('\n') ? nextText : `${nextText}\n`;
}

export function findArrayEntryOffset(
  text: string,
  index: number,
): number | null {
  const tree = parseTree(text, undefined, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (
    tree === undefined ||
    tree.type !== 'array' ||
    tree.children === undefined
  ) {
    return null;
  }

  return tree.children[index]?.offset ?? null;
}

export function createTextRevision(text: string): string {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${(hash >>> 0).toString(16)}:${text.length}`;
}
