import type {
  EditorTarget,
  GenerateDiagnostic,
  GenerateReadiness,
  InitialDataPayload,
  ValidationError,
  WorkspaceUpdatePayload,
} from '../types.js';

export const DEFAULT_GENERATE_READINESS: GenerateReadiness = {
  ready: true,
  errors: [],
  diagnostics: [],
};

type MaybeGenerateReadiness = Omit<GenerateReadiness, 'diagnostics'> & {
  diagnostics?: GenerateDiagnostic[];
};

type MaybeInitialDataPayload = Omit<InitialDataPayload, 'generateReadiness'> & {
  generateReadiness?: MaybeGenerateReadiness;
};

type MaybeWorkspaceUpdatePayload = Omit<
  WorkspaceUpdatePayload,
  'generateReadiness'
> & {
  generateReadiness?: MaybeGenerateReadiness;
};

export function normalizeInitialDataPayload(
  payload: MaybeInitialDataPayload,
): InitialDataPayload {
  return {
    ...payload,
    generateReadiness: normalizeGenerateReadiness(payload.generateReadiness),
  };
}

export function mergeWorkspaceUpdatePayload(
  currentPayload: InitialDataPayload | null,
  update: MaybeWorkspaceUpdatePayload,
): InitialDataPayload | null {
  if (currentPayload === null) {
    return currentPayload;
  }

  const nextIssues = [
    ...currentPayload.issues.filter((issue) => issue.kind !== update.kind),
    ...update.issues,
  ];

  return {
    ...currentPayload,
    ...(update.profiles === undefined ? {} : { profiles: update.profiles }),
    ...(update.configs === undefined ? {} : { configs: update.configs }),
    issues: nextIssues,
    generateReadiness:
      update.generateReadiness === undefined
        ? currentPayload.generateReadiness
        : normalizeGenerateReadiness(update.generateReadiness),
    ...(update.editorRevision === undefined
      ? {}
      : { editorRevision: update.editorRevision }),
  };
}

export function normalizeGenerateReadiness(
  value: MaybeGenerateReadiness | undefined,
): GenerateReadiness {
  if (value === undefined) {
    return DEFAULT_GENERATE_READINESS;
  }

  return {
    ...value,
    diagnostics: value.diagnostics ?? [],
  };
}

export function formatValidationError(error: ValidationError): string {
  const details = [error.file];
  if (error.configName !== undefined) {
    details.push(error.configName);
  }
  if (error.field !== undefined) {
    details.push(error.field);
  }

  return `${details.join(' / ')}: ${error.message}`;
}

export function getEditorDiagnostics(
  readiness: GenerateReadiness,
  editor: EditorTarget,
): GenerateDiagnostic[] {
  return readiness.diagnostics.filter((diagnostic) => {
    const target = diagnostic.target;
    return (
      target?.kind === editor.kind &&
      diagnostic.file === editor.file &&
      target.index === editor.index
    );
  });
}

export function getDiagnosticField(
  diagnostic: GenerateDiagnostic,
): string | undefined {
  return diagnostic.target?.field ?? diagnostic.field;
}

export function getFieldDiagnosticMessages(
  diagnostics: readonly GenerateDiagnostic[],
  field: string,
): string[] {
  return uniqueMessages(
    diagnostics
      .filter((diagnostic) => getDiagnosticField(diagnostic) === field)
      .map((diagnostic) => diagnostic.message),
  );
}

export function getEntryIssueDiagnostics(
  diagnostics: readonly GenerateDiagnostic[],
  fieldNames: readonly string[],
): GenerateDiagnostic[] {
  const fieldSet = new Set(fieldNames);
  return diagnostics.filter((diagnostic) => {
    const field = getDiagnosticField(diagnostic);
    return field === undefined || !fieldSet.has(field);
  });
}

export function mergeHelperMessages(
  diagnosticMessages: readonly string[],
  localMessages: readonly (string | undefined)[],
): string[] {
  const diagnostics = uniqueMessages(diagnosticMessages);
  if (diagnostics.length > 0) {
    return diagnostics;
  }

  return uniqueMessages(
    localMessages.filter((message): message is string => message !== undefined),
  );
}

export function formatDiagnostic(diagnostic: GenerateDiagnostic): string {
  const field = getDiagnosticField(diagnostic);
  const details = [diagnostic.file];
  if (diagnostic.target?.name !== undefined) {
    details.push(diagnostic.target.name);
  }
  if (field !== undefined) {
    details.push(field);
  }

  return `${details.join(' / ')}: ${diagnostic.message}`;
}

function uniqueMessages(messages: readonly string[]): string[] {
  return [...new Set(messages)];
}
