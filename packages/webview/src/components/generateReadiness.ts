import type {
  GenerateReadiness,
  InitialDataPayload,
  ValidationError,
  WorkspaceUpdatePayload,
} from '../types.js';

export const DEFAULT_GENERATE_READINESS: GenerateReadiness = {
  ready: true,
  errors: [],
};

type MaybeInitialDataPayload = Omit<InitialDataPayload, 'generateReadiness'> & {
  generateReadiness?: GenerateReadiness;
};

type MaybeWorkspaceUpdatePayload = Omit<
  WorkspaceUpdatePayload,
  'generateReadiness'
> & {
  generateReadiness?: GenerateReadiness;
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
  value: GenerateReadiness | undefined,
): GenerateReadiness {
  if (value === undefined) {
    return DEFAULT_GENERATE_READINESS;
  }

  return value;
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
