import type {
  ArgsFileData,
  ConfigRef,
  ConfigFileData,
  GenerateInput,
  ProfileRef,
  ValidationError,
  ValidationState,
} from './types.js';
import { resolveArgsFilePath } from './variables.js';

const BLOCKED_OVERRIDE_KEYS = ['program', 'type', 'request'] as const;
const DEBUG_REQUEST_VALUES = ['launch', 'attach'] as const;

export async function validateGenerateInput(
  input: GenerateInput,
): Promise<ValidationError[]> {
  const state = await collectValidationState(input);
  return state.errors;
}

export async function collectValidationState(
  input: GenerateInput,
): Promise<ValidationState> {
  const profileRefs = flattenProfiles(input.profiles);
  const configRefs = flattenConfigs(input.configs);
  const errors: ValidationError[] = [];
  const profileMap = new Map<string, ProfileRef>();
  const argsFileCache = new Map<string, ArgsFileData>();

  validateProfileEntries(profileRefs, errors);
  validateConfigFiles(input.configs, errors);
  validateConfigEntries(configRefs, errors);
  validateNameUniqueness(profileRefs, configRefs, errors);

  for (const profileRef of profileRefs) {
    if (
      typeof profileRef.data.name === 'string' &&
      profileRef.data.name !== ''
    ) {
      profileMap.set(profileRef.data.name, profileRef);
    }
  }

  for (const configRef of configRefs) {
    validateConfigSemantics(configRef, profileMap, errors);
    await validateArgsFile(configRef, profileMap, input, argsFileCache, errors);
  }

  return {
    errors,
    profileRefs,
    configRefs,
    profileMap,
    argsFileCache,
  };
}

function flattenProfiles(files: GenerateInput['profiles']): ProfileRef[] {
  return files.flatMap((fileData) =>
    fileData.profiles.map((data, index) => ({
      file: fileData.file,
      index,
      data,
    })),
  );
}

function flattenConfigs(files: GenerateInput['configs']): ConfigRef[] {
  return files.flatMap((fileData) =>
    (Array.isArray(fileData.configurations) ? fileData.configurations : []).map(
      (data, index) => ({
        file: fileData.file,
        index,
        data,
      }),
    ),
  );
}

function validateConfigFiles(
  configFiles: ConfigFileData[],
  errors: ValidationError[],
): void {
  for (const configFile of configFiles) {
    if (
      Object.hasOwn(configFile, 'enabled') &&
      configFile.enabled !== undefined &&
      typeof configFile.enabled !== 'boolean'
    ) {
      errors.push(
        createValidationError({
          file: configFile.file,
          field: 'enabled',
          message: 'Config file enabled must be a boolean.',
        }),
      );
    }

    if (!Array.isArray(configFile.configurations)) {
      errors.push(
        createValidationError({
          file: configFile.file,
          field: 'configurations',
          message: 'Config file configurations must be an array.',
        }),
      );
    }
  }
}

function validateProfileEntries(
  profileRefs: ProfileRef[],
  errors: ValidationError[],
): void {
  for (const profileRef of profileRefs) {
    if (!isNonEmptyString(profileRef.data.name)) {
      errors.push(
        createValidationError({
          file: profileRef.file,
          field: 'name',
          message: 'Profile name is required.',
        }),
      );
    }

    if (
      Object.hasOwn(profileRef.data, 'args') &&
      !isStringArray(profileRef.data.args)
    ) {
      errors.push(
        createValidationError({
          file: profileRef.file,
          field: 'args',
          message: 'Profile args must be an array of strings.',
        }),
      );
    }

    const profileEntry = profileRef.data.configuration;

    if (
      profileEntry !== undefined &&
      (typeof profileEntry !== 'object' ||
        profileEntry === null ||
        Array.isArray(profileEntry))
    ) {
      errors.push(
        createValidationError({
          file: profileRef.file,
          field: 'configuration',
          message: 'Profile configuration must be an object.',
        }),
      );
      continue;
    }

    if (!isDebugRequestValue(profileEntry?.request)) {
      errors.push(
        createValidationError({
          file: profileRef.file,
          field: 'configuration.request',
          message: `Profile request must be one of: ${DEBUG_REQUEST_VALUES.join(', ')}.`,
        }),
      );
    }

    if (!isNonEmptyString(profileEntry?.type)) {
      errors.push(
        createValidationError({
          file: profileRef.file,
          field: 'configuration.type',
          message: 'Profile type is required.',
        }),
      );
    }
  }
}

function validateConfigEntries(
  configRefs: ConfigRef[],
  errors: ValidationError[],
): void {
  for (const configRef of configRefs) {
    if (!isNonEmptyString(configRef.data.name)) {
      errors.push(
        createValidationError({
          file: configRef.file,
          field: 'name',
          message: 'Config name is required.',
        }),
      );
    }

    if (
      Object.hasOwn(configRef.data, 'enabled') &&
      typeof configRef.data.enabled !== 'boolean'
    ) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'enabled',
          message: 'Config enabled must be a boolean.',
        }),
      );
    }

    if (!isNonEmptyString(configRef.data.profile)) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'profile',
          message: 'Config profile is required.',
        }),
      );
    }

    if (
      Object.hasOwn(configRef.data, 'argsFile') &&
      configRef.data.argsFile !== undefined &&
      typeof configRef.data.argsFile !== 'string'
    ) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'argsFile',
          message: 'Config argsFile must be a string.',
        }),
      );
    }

    if (
      Object.hasOwn(configRef.data, 'args') &&
      !isStringArray(configRef.data.args)
    ) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'args',
          message: 'Config args must be an array of strings.',
        }),
      );
    }

    const configEntry = configRef.data.configuration;

    if (
      configEntry !== undefined &&
      (typeof configEntry !== 'object' ||
        configEntry === null ||
        Array.isArray(configEntry))
    ) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'configuration',
          message: 'Config configuration must be an object.',
        }),
      );
      continue;
    }
  }
}

function validateNameUniqueness(
  profileRefs: ProfileRef[],
  configRefs: ConfigRef[],
  errors: ValidationError[],
): void {
  const groups = new Map<
    string,
    Array<{ kind: 'profile' | 'config'; file: string; index: number }>
  >();

  for (const profileRef of profileRefs) {
    if (!isNonEmptyString(profileRef.data.name)) {
      continue;
    }

    const entries = groups.get(profileRef.data.name) ?? [];
    entries.push({
      kind: 'profile',
      file: profileRef.file,
      index: profileRef.index,
    });
    groups.set(profileRef.data.name, entries);
  }

  for (const configRef of configRefs) {
    if (!isNonEmptyString(configRef.data.name)) {
      continue;
    }

    const entries = groups.get(configRef.data.name) ?? [];
    entries.push({
      kind: 'config',
      file: configRef.file,
      index: configRef.index,
    });
    groups.set(configRef.data.name, entries);
  }

  for (const [name, entries] of groups.entries()) {
    if (entries.length < 2) {
      continue;
    }

    const firstEntry = entries[0]!;
    const profileCount = entries.filter(
      (entry) => entry.kind === 'profile',
    ).length;
    const configCount = entries.filter(
      (entry) => entry.kind === 'config',
    ).length;
    const locations = entries.map(
      (entry) => `${entry.file}#${entry.index + 1}`,
    );

    let message: string;
    if (profileCount > 0 && configCount === 0) {
      message = `Profile name "${name}" is defined in multiple entries: ${locations.join(', ')}`;
    } else if (profileCount === 0 && configCount > 0) {
      message = `Config name "${name}" is defined in multiple entries: ${locations.join(', ')}`;
    } else {
      message = `Name "${name}" is used by multiple profiles/configs: ${locations.join(', ')}`;
    }

    errors.push(
      createValidationError({
        file: firstEntry.file,
        field: 'name',
        message,
      }),
    );
  }
}

function validateConfigSemantics(
  configRef: ConfigRef,
  profileMap: Map<string, ProfileRef>,
  errors: ValidationError[],
): void {
  if (!isNonEmptyString(configRef.data.profile)) {
    return;
  }

  const profileRef = profileMap.get(configRef.data.profile);
  if (profileRef === undefined) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'profile',
        message: `Config references unknown profile "${configRef.data.profile}".`,
      }),
    );
  }

  const configEntry = configRef.data.configuration;
  for (const key of BLOCKED_OVERRIDE_KEYS) {
    if (configEntry !== undefined && Object.hasOwn(configEntry, key)) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: `configuration.${key}`,
          message: `Config with a profile cannot override "${key}".`,
        }),
      );
    }
  }

  if (
    profileRef?.data.args !== undefined &&
    configRef.data.argsFile !== undefined
  ) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message:
          'Config cannot specify argsFile when the selected profile already defines args.',
      }),
    );
  }
}

async function validateArgsFile(
  configRef: ConfigRef,
  profileMap: Map<string, ProfileRef>,
  input: GenerateInput,
  argsFileCache: Map<string, ArgsFileData>,
  errors: ValidationError[],
): Promise<void> {
  const rawArgsFile = configRef.data.argsFile;
  if (rawArgsFile === undefined || typeof rawArgsFile !== 'string') {
    return;
  }

  const profileRef = profileMap.get(configRef.data.profile);
  if (profileRef?.data.args !== undefined) {
    return;
  }

  const resolvedPath = resolveArgsFilePath(rawArgsFile, input.variables ?? {});
  if (!resolvedPath.ok) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message: resolvedPath.message,
      }),
    );
    return;
  }

  if (argsFileCache.has(resolvedPath.value)) {
    return;
  }

  if (input.readArgsFile === undefined) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message:
          'argsFile was specified, but no args file reader was provided.',
      }),
    );
    return;
  }

  const result = await input.readArgsFile(resolvedPath.value);
  if (result.kind === 'not-found') {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message: `argsFile does not exist: ${resolvedPath.value}`,
      }),
    );
    return;
  }

  if (result.kind === 'error') {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message:
          result.message ?? `Failed to read argsFile: ${resolvedPath.value}`,
      }),
    );
    return;
  }

  if (!isArgsFileData(result.data)) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message:
          'argsFile content is invalid. Expected an object with an "args" string array.',
      }),
    );
    return;
  }

  argsFileCache.set(resolvedPath.value, result.data);
}

function isArgsFileData(value: unknown): value is ArgsFileData {
  if (!isRecord(value)) {
    return false;
  }

  return isStringArray(value.args);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function safeConfigName(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isDebugRequestValue(
  value: unknown,
): value is (typeof DEBUG_REQUEST_VALUES)[number] {
  return (
    typeof value === 'string' &&
    DEBUG_REQUEST_VALUES.some((entry) => entry === value)
  );
}

function createValidationError(input: {
  file: string;
  message: string;
  field?: string | undefined;
  configName?: string | undefined;
}): ValidationError {
  const error: ValidationError = {
    file: input.file,
    message: input.message,
  };

  if (input.field !== undefined) {
    error.field = input.field;
  }

  if (input.configName !== undefined) {
    error.configName = input.configName;
  }

  return error;
}
