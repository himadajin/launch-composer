const VARIABLE_PATTERN = /\$\{([^}]+)\}/g;

export interface ResolvePathSuccess {
  ok: true;
  value: string;
}

export interface ResolvePathFailure {
  ok: false;
  message: string;
}

export type ResolvePathResult = ResolvePathSuccess | ResolvePathFailure;

export function resolveArgsFilePath(
  rawPath: string,
  variables: Record<string, string>,
): ResolvePathResult {
  let hadError: string | null = null;

  const resolved = rawPath.replace(VARIABLE_PATTERN, (match, variableName) => {
    if (variableName !== 'workspaceFolder') {
      hadError = `Unsupported variable "${variableName}" in argsFile path.`;
      return match;
    }

    const replacement = variables.workspaceFolder;
    if (replacement === undefined) {
      hadError =
        'Failed to resolve "${workspaceFolder}" in argsFile path because the variable was not provided.';
      return match;
    }

    return replacement;
  });

  if (hadError !== null) {
    return { ok: false, message: hadError };
  }

  if (!isAbsolutePath(resolved)) {
    return {
      ok: false,
      message:
        'argsFile must be an absolute path or start with "${workspaceFolder}".',
    };
  }

  return { ok: true, value: resolved };
}

export function isAbsolutePath(path: string): boolean {
  if (path.startsWith('/')) {
    return true;
  }

  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return true;
  }

  return path.startsWith('\\\\');
}
