import type { ConfigData, EntryPatchOperation, ProfileData } from '../types.js';
import {
  updateOptionalString,
  updateRequiredString,
  withConfiguration,
} from './editorUtils.js';

export interface EntryChange<T> {
  data: T;
  patches: EntryPatchOperation[];
}

export function updateProfileType(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return {
    data: {
      ...data,
      configuration: updateRequiredString(
        { ...data.configuration },
        'type',
        value,
      ),
    },
    patches: createSetIfChangedPatch(
      ['configuration', 'type'],
      data.configuration?.type,
      value,
    ),
  };
}

export function updateProfileRequest(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return {
    data: {
      ...data,
      configuration: updateRequiredString(
        { ...data.configuration },
        'request',
        value,
      ),
    },
    patches: createSetIfChangedPatch(
      ['configuration', 'request'],
      data.configuration?.request,
      value,
    ),
  };
}

export function updateProfileProgram(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return {
    data: withConfiguration(
      data,
      updateOptionalString({ ...data.configuration }, 'program', value),
    ),
    patches: createOptionalStringPatch(
      ['configuration', 'program'],
      data.configuration?.program,
      value,
    ),
  };
}

export function updateProfileCwd(
  data: ProfileData,
  value: string,
): EntryChange<ProfileData> {
  return {
    data: withConfiguration(
      data,
      updateOptionalString({ ...data.configuration }, 'cwd', value),
    ),
    patches: createOptionalStringPatch(
      ['configuration', 'cwd'],
      data.configuration?.cwd,
      value,
    ),
  };
}

export function updateProfileStopAtEntry(
  data: ProfileData,
  checked: boolean,
): EntryChange<ProfileData> {
  return {
    data: {
      ...data,
      configuration: { ...data.configuration, stopAtEntry: checked },
    },
    patches: createSetIfChangedPatch(
      ['configuration', 'stopAtEntry'],
      data.configuration?.stopAtEntry,
      checked,
    ),
  };
}

export function updateProfileArgs(
  data: ProfileData,
  args: string[],
): EntryChange<ProfileData> {
  const next = { ...data };
  if (args.length === 0) {
    delete next.args;
  } else {
    next.args = args;
  }

  return {
    data: next,
    patches: createOptionalArrayPatch(['args'], data.args, args),
  };
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
  return {
    data: {
      ...data,
      enabled: checked,
    },
    patches: createSetIfChangedPatch(['enabled'], data.enabled, checked),
  };
}

export function updateConfigCwd(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
  return {
    data: withConfiguration(
      data,
      updateOptionalString({ ...data.configuration }, 'cwd', value),
    ),
    patches: createOptionalStringPatch(
      ['configuration', 'cwd'],
      data.configuration?.cwd,
      value,
    ),
  };
}

export function updateConfigStopAtEntry(
  data: ConfigData,
  checked: boolean,
): EntryChange<ConfigData> {
  return {
    data: {
      ...data,
      configuration: { ...data.configuration, stopAtEntry: checked },
    },
    patches: createSetIfChangedPatch(
      ['configuration', 'stopAtEntry'],
      data.configuration?.stopAtEntry,
      checked,
    ),
  };
}

export function updateConfigArgsFile(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
  const trimmed = value.trim();

  if (trimmed === '') {
    const next = { ...data };
    delete next.argsFile;
    return {
      data: next,
      patches: createDeleteIfPresentPatch(['argsFile'], data, 'argsFile'),
    };
  }

  return {
    data: {
      ...data,
      argsFile: trimmed,
    },
    patches: createSetIfChangedPatch(['argsFile'], data.argsFile, trimmed),
  };
}

export function updateConfigArgs(
  data: ConfigData,
  args: string[],
): EntryChange<ConfigData> {
  const next = { ...data };
  if (args.length === 0) {
    delete next.args;
  } else {
    next.args = args;
  }

  return {
    data: next,
    patches: createOptionalArrayPatch(['args'], data.args, args),
  };
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

function createOptionalStringPatch(
  path: (string | number)[],
  current: unknown,
  value: string,
): EntryPatchOperation[] {
  if (value.trim() === '') {
    return current === undefined
      ? []
      : [
          {
            type: 'delete',
            path,
          },
        ];
  }

  return createSetIfChangedPatch(path, current, value);
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
): EntryPatchOperation[];
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
