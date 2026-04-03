import {
  parse,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser/lib/esm/main.js';

export function parseJsonc<T>(text: string, label: string): T {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`)
      .join(', ');
    throw new Error(`Failed to parse ${label}: ${details}`);
  }

  return value as T;
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
