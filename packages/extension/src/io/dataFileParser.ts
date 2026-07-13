import type {
  ConfigData,
  ConfigFileData,
  ProfileData,
} from '@launch-composer/core';

import type { ComposerDataIssue } from '../messages.js';
import { parseJsoncDocument, type JsonParseIssue } from './json.js';
import type { DataFileKind } from './workspaceLayout.js';

export type DocumentParseResult<T> =
  { status: 'ok'; data: T } | { status: 'invalid'; issue: ComposerDataIssue };

export function parseProfileDocument(
  file: string,
  text: string,
): DocumentParseResult<ProfileData[]> {
  const parsed = parseJsoncDocument<unknown>(text);
  if (parsed.issues.length > 0) {
    return {
      status: 'invalid',
      issue: createParseIssue('profile', file, text, parsed.issues),
    };
  }

  if (!Array.isArray(parsed.value)) {
    return {
      status: 'invalid',
      issue: {
        kind: 'profile',
        file,
        code: 'invalid-shape',
        message: `${file} must contain a JSON array.`,
      },
    };
  }

  return { status: 'ok', data: parsed.value as ProfileData[] };
}

export function parseConfigDocument(
  file: string,
  text: string,
): DocumentParseResult<Omit<ConfigFileData, 'file'>> {
  const parsed = parseJsoncDocument<unknown>(text);
  if (parsed.issues.length > 0) {
    return {
      status: 'invalid',
      issue: createParseIssue('config', file, text, parsed.issues),
    };
  }

  if (!isRecord(parsed.value) || !Array.isArray(parsed.value.configurations)) {
    return {
      status: 'invalid',
      issue: {
        kind: 'config',
        file,
        code: 'invalid-shape',
        message: `${file} must contain an object with a "configurations" array.`,
      },
    };
  }

  return {
    status: 'ok',
    data: { configurations: parsed.value.configurations as ConfigData[] },
  };
}

export function unwrapParsedDocument<T>(result: DocumentParseResult<T>): T {
  if (result.status === 'invalid') {
    throw new Error(result.issue.message);
  }

  return result.data;
}

function createParseIssue(
  kind: DataFileKind,
  file: string,
  text: string,
  issues: JsonParseIssue[],
): ComposerDataIssue {
  if (text.trim() === '') {
    return {
      kind,
      file,
      code: 'empty',
      message:
        kind === 'profile'
          ? `${file} is empty. Expected a JSON array such as [].`
          : `${file} is empty. Expected an object with a "configurations" array.`,
    };
  }

  return {
    kind,
    file,
    code: 'invalid-json',
    message: `Invalid JSON in ${file}. Open the file and fix the syntax.`,
    details: issues
      .map((issue) => `${issue.code} at ${issue.offset}`)
      .join(', '),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
