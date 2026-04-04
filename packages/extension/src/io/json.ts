import {
  parse,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser/lib/esm/main.js';

export interface JsonParseIssue {
  code: string;
  offset: number;
}

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
