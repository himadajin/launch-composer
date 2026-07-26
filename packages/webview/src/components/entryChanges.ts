import type { ConfigData, EntryPatchOperation, ProfileData } from '../types.js';
import { withConfiguration } from './editorUtils.js';

export interface EntryChange<T> {
  data: T;
  patches: EntryPatchOperation[];
}

interface EntryWithConfiguration {
  configuration?: Record<string, unknown>;
}

interface StringFieldOptions {
  required?: boolean;
  trimValue?: boolean;
  deletePatchMode?: 'value-present' | 'property-present';
}

export function updateProfileType(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return updateConfigurationString(data, 'type', value, { required: true });
}

export function updateProfileRequest(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return updateConfigurationString(data, 'request', value, { required: true });
}

export function updateProfileProgram(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return updateConfigurationString(data, 'program', value);
}

export function updateProfileCwd(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return updateConfigurationString(data, 'cwd', value);
}

export function updateProfileStopAtEntry(
  data: ProfileData,
  checked: boolean,
): EntryChange<ProfileData> {
  return updateBooleanConfigurationField(data, 'stopAtEntry', checked);
}

export function clearProfileStopAtEntry(
  data: ProfileData,
): EntryChange<ProfileData> {
  return deleteConfigurationField(data, 'stopAtEntry');
}

export function updateProfileArgs(
  data: ProfileData,
  args: string[],
): EntryChange<ProfileData> {
  return updateOptionalArrayField(data, 'args', args);
}

export function updateConfigProfile(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
  const nextConfig =
    data.configuration === undefined ? undefined : { ...data.configuration };

  return {
    data: {
      ...data,
      profile: value,
      ...(nextConfig === undefined ? {} : { configuration: nextConfig }),
    },
    patches: createSetIfChangedPatch(['profile'], data.profile, value),
  };
}

export function updateConfigEnabled(
  data: ConfigData,
  checked: boolean,
): EntryChange<ConfigData> {
  const next = { ...data };
  if (checked) {
    delete next.excluded;
  } else {
    next.excluded = true;
  }

  return {
    data: next,
    patches: checked
      ? createDeleteIfPresentPatch(['excluded'], data, 'excluded')
      : createSetIfChangedPatch(['excluded'], data.excluded, true),
  };
}

export function updateConfigCwd(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
  return updateConfigurationString(data, 'cwd', value);
}

export function updateConfigStopAtEntry(
  data: ConfigData,
  checked: boolean,
): EntryChange<ConfigData> {
  return updateBooleanConfigurationField(data, 'stopAtEntry', checked);
}

export function clearConfigCwd(data: ConfigData): EntryChange<ConfigData> {
  return deleteConfigurationField(data, 'cwd');
}

export function clearConfigStopAtEntry(
  data: ConfigData,
): EntryChange<ConfigData> {
  return deleteConfigurationField(data, 'stopAtEntry');
}

export function updateConfigArgsFile(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
  return updateOptionalStringField(data, 'argsFile', value, {
    trimValue: true,
  });
}

export function updateConfigArgs(
  data: ConfigData,
  args: string[],
): EntryChange<ConfigData> {
  return updateOptionalArrayField(data, 'args', args);
}

function updateConfigurationString<T extends EntryWithConfiguration>(
  data: T,
  key: string,
  value: string,
  options: StringFieldOptions = {},
): EntryChange<T> {
  const nextConfiguration = { ...data.configuration };
  const patches = updateStringRecord(
    nextConfiguration,
    key,
    data.configuration?.[key],
    ['configuration', key],
    value,
    options,
  );

  return {
    data: withConfiguration(data, nextConfiguration),
    patches,
  };
}

function updateOptionalStringField<T extends object>(
  data: T,
  key: string,
  value: string,
  options: StringFieldOptions = {},
): EntryChange<T> {
  const next = { ...data } as Record<string, unknown>;
  const patches = updateStringRecord(next, key, next[key], [key], value, {
    ...options,
    deletePatchMode: 'property-present',
  });

  return {
    data: next as T,
    patches,
  };
}

function deleteConfigurationField<T extends EntryWithConfiguration>(
  data: T,
  key: string,
): EntryChange<T> {
  const nextConfiguration = { ...data.configuration };
  const hadKey = Object.hasOwn(nextConfiguration, key);
  delete nextConfiguration[key];

  return {
    data: withConfiguration(data, nextConfiguration),
    patches: hadKey
      ? [
          {
            type: 'delete',
            path: ['configuration', key],
          },
        ]
      : [],
  };
}

function updateBooleanConfigurationField<T extends EntryWithConfiguration>(
  data: T,
  key: string,
  checked: boolean,
): EntryChange<T> {
  const nextConfiguration = { ...data.configuration, [key]: checked };

  return {
    data: withConfiguration(data, nextConfiguration),
    patches: createSetIfChangedPatch(
      ['configuration', key],
      data.configuration?.[key],
      checked,
    ),
  };
}

function updateOptionalArrayField<T extends object>(
  data: T,
  key: string,
  value: string[],
): EntryChange<T> {
  const next = { ...data } as Record<string, unknown>;
  const current = next[key] as string[] | undefined;
  if (value.length === 0) {
    delete next[key];
  } else {
    next[key] = value;
  }

  return {
    data: next as T,
    patches: createOptionalArrayPatch([key], current, value),
  };
}

function updateStringRecord(
  holder: Record<string, unknown>,
  key: string,
  current: unknown,
  path: (string | number)[],
  value: string,
  {
    required = false,
    trimValue = false,
    deletePatchMode = 'value-present',
  }: StringFieldOptions = {},
): EntryPatchOperation[] {
  const hadKey = Object.hasOwn(holder, key);
  if (!required && value.trim() === '') {
    delete holder[key];
    const shouldDelete =
      deletePatchMode === 'property-present' ? hadKey : current !== undefined;
    return shouldDelete
      ? [
          {
            type: 'delete',
            path,
          },
        ]
      : [];
  }

  const next = trimValue ? value.trim() : value;
  holder[key] = next;
  return createSetIfChangedPatch(path, current, next);
}

function createSetIfChangedPatch(
  path: (string | number)[],
  current: unknown,
  next: unknown,
): EntryPatchOperation[] {
  return isEqualPatchValue(current, next)
    ? []
    : [
        {
          type: 'set',
          path,
          value: next,
        },
      ];
}

function createOptionalArrayPatch(
  path: (string | number)[],
  current: string[] | undefined,
  next: string[],
): EntryPatchOperation[] {
  if (next.length === 0) {
    return current === undefined
      ? []
      : [
          {
            type: 'delete',
            path,
          },
        ];
  }

  return createSetIfChangedPatch(path, current, next);
}

function createDeleteIfPresentPatch(
  path: (string | number)[],
  valueHolder: object | undefined,
  key: string,
): EntryPatchOperation[] {
  return valueHolder !== undefined && Object.hasOwn(valueHolder, key)
    ? [
        {
          type: 'delete',
          path,
        },
      ]
    : [];
}

function isEqualPatchValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((entry, index) => entry === right[index]);
  }

  return left === right;
}
