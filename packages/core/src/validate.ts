import type {
  ArgsFileData,
  ConfigRef,
  ConfigFileData,
  GenerateInput,
  TemplateRef,
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
  const templateRefs = flattenTemplates(input.templates);
  const configRefs = flattenConfigs(input.configs);
  const errors: ValidationError[] = [];
  const templateMap = new Map<string, TemplateRef>();
  const argsFileCache = new Map<string, ArgsFileData>();

  validateTemplateEntries(templateRefs, errors);
  validateConfigFiles(input.configs, errors);
  validateConfigEntries(configRefs, errors);
  validateNameUniqueness(templateRefs, configRefs, errors);

  for (const templateRef of templateRefs) {
    if (
      typeof templateRef.data.name === 'string' &&
      templateRef.data.name !== ''
    ) {
      templateMap.set(templateRef.data.name, templateRef);
    }
  }

  for (const configRef of configRefs) {
    validateConfigSemantics(configRef, templateMap, errors);
    await validateArgsFile(
      configRef,
      templateMap,
      input,
      argsFileCache,
      errors,
    );
  }

  return {
    errors,
    templateRefs,
    configRefs,
    templateMap,
    argsFileCache,
  };
}

function flattenTemplates(files: GenerateInput['templates']): TemplateRef[] {
  return files.flatMap((fileData) =>
    fileData.templates.map((data, index) => ({
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

function validateTemplateEntries(
  templateRefs: TemplateRef[],
  errors: ValidationError[],
): void {
  for (const templateRef of templateRefs) {
    if (!isNonEmptyString(templateRef.data.name)) {
      errors.push(
        createValidationError({
          file: templateRef.file,
          field: 'name',
          message: 'Template name is required.',
        }),
      );
    }

    if (
      Object.hasOwn(templateRef.data, 'args') &&
      !isStringArray(templateRef.data.args)
    ) {
      errors.push(
        createValidationError({
          file: templateRef.file,
          field: 'args',
          message: 'Template args must be an array of strings.',
        }),
      );
    }

    if (!isDebugRequestValue(templateRef.data.request)) {
      errors.push(
        createValidationError({
          file: templateRef.file,
          field: 'request',
          message: `Template request must be one of: ${DEBUG_REQUEST_VALUES.join(', ')}.`,
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

    if (
      Object.hasOwn(configRef.data, 'extends') &&
      configRef.data.extends !== undefined &&
      typeof configRef.data.extends !== 'string'
    ) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'extends',
          message: 'Config extends must be a string.',
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

    if (
      configRef.data.extends === undefined &&
      !isDebugRequestValue(configRef.data.request)
    ) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: 'request',
          message: `Config request must be one of: ${DEBUG_REQUEST_VALUES.join(', ')}.`,
        }),
      );
    }
  }
}

function validateNameUniqueness(
  templateRefs: TemplateRef[],
  configRefs: ConfigRef[],
  errors: ValidationError[],
): void {
  const groups = new Map<
    string,
    Array<{ kind: 'template' | 'config'; file: string; index: number }>
  >();

  for (const templateRef of templateRefs) {
    if (!isNonEmptyString(templateRef.data.name)) {
      continue;
    }

    const entries = groups.get(templateRef.data.name) ?? [];
    entries.push({
      kind: 'template',
      file: templateRef.file,
      index: templateRef.index,
    });
    groups.set(templateRef.data.name, entries);
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
    const templateCount = entries.filter(
      (entry) => entry.kind === 'template',
    ).length;
    const configCount = entries.filter(
      (entry) => entry.kind === 'config',
    ).length;
    const locations = entries.map(
      (entry) => `${entry.file}#${entry.index + 1}`,
    );

    let message: string;
    if (templateCount > 0 && configCount === 0) {
      message = `Template name "${name}" is defined in multiple entries: ${locations.join(', ')}`;
    } else if (templateCount === 0 && configCount > 0) {
      message = `Config name "${name}" is defined in multiple entries: ${locations.join(', ')}`;
    } else {
      message = `Name "${name}" is used by multiple templates/configs: ${locations.join(', ')}`;
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
  templateMap: Map<string, TemplateRef>,
  errors: ValidationError[],
): void {
  const extendsName = configRef.data.extends;
  if (extendsName === undefined) {
    return;
  }

  const templateRef = templateMap.get(extendsName);
  if (templateRef === undefined) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'extends',
        message: `Config extends unknown template "${extendsName}".`,
      }),
    );
  }

  for (const key of BLOCKED_OVERRIDE_KEYS) {
    if (Object.hasOwn(configRef.data, key)) {
      errors.push(
        createValidationError({
          file: configRef.file,
          configName: safeConfigName(configRef.data.name),
          field: key,
          message: `Config with extends cannot override "${key}".`,
        }),
      );
    }
  }

  if (
    templateRef?.data.args !== undefined &&
    configRef.data.argsFile !== undefined
  ) {
    errors.push(
      createValidationError({
        file: configRef.file,
        configName: safeConfigName(configRef.data.name),
        field: 'argsFile',
        message:
          'Config cannot specify argsFile when the extended template already defines args.',
      }),
    );
  }
}

async function validateArgsFile(
  configRef: ConfigRef,
  templateMap: Map<string, TemplateRef>,
  input: GenerateInput,
  argsFileCache: Map<string, ArgsFileData>,
  errors: ValidationError[],
): Promise<void> {
  const rawArgsFile = configRef.data.argsFile;
  if (rawArgsFile === undefined || typeof rawArgsFile !== 'string') {
    return;
  }

  const templateRef =
    configRef.data.extends === undefined
      ? undefined
      : templateMap.get(configRef.data.extends);
  if (templateRef?.data.args !== undefined) {
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
