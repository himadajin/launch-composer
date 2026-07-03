import type {
  ArgsFileData,
  ConfigRef,
  ConfigFileData,
  GenerateInput,
  ProfileRef,
  ValidationError,
  ValidationErrorTarget,
  ValidationState,
} from './types.js';
import { resolveArgsFilePath } from './variables.js';

const BLOCKED_OVERRIDE_KEYS = ['program', 'type', 'request'] as const;
const DEBUG_REQUEST_VALUES = ['launch', 'attach'] as const;

interface FieldValidationRule<TRef> {
  field: string;
  applies?: (ref: TRef) => boolean;
  valid: (ref: TRef) => boolean;
  message: string;
  blocksRemaining?: boolean;
}

const PROFILE_FIELD_RULES: readonly FieldValidationRule<ProfileRef>[] = [
  {
    field: 'name',
    valid: (profileRef) => isNonEmptyString(profileRef.data.name),
    message: 'Profile name is required.',
  },
  {
    field: 'args',
    applies: (profileRef) => Object.hasOwn(profileRef.data, 'args'),
    valid: (profileRef) => isStringArray(profileRef.data.args),
    message: 'Profile args must be an array of strings.',
  },
  {
    field: 'configuration',
    applies: (profileRef) => profileRef.data.configuration !== undefined,
    valid: (profileRef) => isRecord(profileRef.data.configuration),
    message: 'Profile configuration must be an object.',
    blocksRemaining: true,
  },
  {
    field: 'configuration.request',
    valid: (profileRef) =>
      isDebugRequestValue(profileRef.data.configuration?.request),
    message: `Profile request must be one of: ${DEBUG_REQUEST_VALUES.join(', ')}.`,
  },
  {
    field: 'configuration.type',
    valid: (profileRef) =>
      isNonEmptyString(profileRef.data.configuration?.type),
    message: 'Profile type is required.',
  },
];

const CONFIG_FIELD_RULES: readonly FieldValidationRule<ConfigRef>[] = [
  {
    field: 'name',
    valid: (configRef) => isNonEmptyString(configRef.data.name),
    message: 'Config name is required.',
  },
  {
    field: 'excluded',
    applies: (configRef) => Object.hasOwn(configRef.data, 'excluded'),
    valid: (configRef) => typeof configRef.data.excluded === 'boolean',
    message: 'Config excluded must be a boolean.',
  },
  {
    field: 'profile',
    valid: (configRef) => isNonEmptyString(configRef.data.profile),
    message: 'Config profile is required.',
  },
  {
    field: 'argsFile',
    applies: (configRef) =>
      Object.hasOwn(configRef.data, 'argsFile') &&
      configRef.data.argsFile !== undefined,
    valid: (configRef) => typeof configRef.data.argsFile === 'string',
    message: 'Config argsFile must be a string.',
  },
  {
    field: 'args',
    applies: (configRef) => Object.hasOwn(configRef.data, 'args'),
    valid: (configRef) => isStringArray(configRef.data.args),
    message: 'Config args must be an array of strings.',
  },
  {
    field: 'configuration',
    applies: (configRef) => configRef.data.configuration !== undefined,
    valid: (configRef) => isRecord(configRef.data.configuration),
    message: 'Config configuration must be an object.',
  },
];

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
    if (!Array.isArray(configFile.configurations)) {
      errors.push(
        createValidationError({
          file: configFile.file,
          field: 'configurations',
          message: 'Config file configurations must be an array.',
          target: { kind: 'configFile' },
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
    validateFieldRules(profileRef, PROFILE_FIELD_RULES, errors, (rule) =>
      createValidationError({
        file: profileRef.file,
        field: rule.field,
        message: rule.message,
        target: profileTarget(profileRef),
      }),
    );
  }
}

function validateConfigEntries(
  configRefs: ConfigRef[],
  errors: ValidationError[],
): void {
  for (const configRef of configRefs) {
    validateFieldRules(configRef, CONFIG_FIELD_RULES, errors, (rule) =>
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: rule.field,
        message: rule.message,
        target: configTarget(configRef),
      }),
    );
  }
}

function validateFieldRules<TRef>(
  ref: TRef,
  rules: readonly FieldValidationRule<TRef>[],
  errors: ValidationError[],
  createError: (rule: FieldValidationRule<TRef>) => ValidationError,
): void {
  for (const rule of rules) {
    if (rule.applies !== undefined && !rule.applies(ref)) {
      continue;
    }

    if (rule.valid(ref)) {
      continue;
    }

    errors.push(createError(rule));
    if (rule.blocksRemaining === true) {
      return;
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
        target: { kind: firstEntry.kind, index: firstEntry.index },
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
        target: configTarget(configRef),
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
          target: configTarget(configRef),
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
        target: configTarget(configRef),
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
        target: configTarget(configRef),
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
        target: configTarget(configRef),
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
        target: configTarget(configRef),
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
        target: configTarget(configRef),
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
        target: configTarget(configRef),
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

function profileTarget(profileRef: ProfileRef): ValidationErrorTarget {
  return { kind: 'profile', index: profileRef.index };
}

function configTarget(configRef: ConfigRef): ValidationErrorTarget {
  return { kind: 'config', index: configRef.index };
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
  target: ValidationErrorTarget;
}): ValidationError {
  const error: ValidationError = {
    file: input.file,
    message: input.message,
    target: input.target,
  };

  if (input.field !== undefined) {
    error.field = input.field;
  }

  if (input.configName !== undefined) {
    error.configName = input.configName;
  }

  return error;
}
