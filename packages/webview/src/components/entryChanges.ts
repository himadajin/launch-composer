import type {
  ConfigData,
  EntryPatchOperation,
  TemplateData,
} from '../types.js';
import {
  stringOrEmpty,
  updateOptionalString,
  updateRequiredString,
  withConfiguration,
} from './editorUtils.js';

export interface EntryChange<T> {
  data: T;
  patches: EntryPatchOperation[];
}

export function updateTemplateType(
  data: TemplateData,
  value: string,
): EntryChange<TemplateData> {
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

export function updateTemplateRequest(
  data: TemplateData,
  value: string,
): EntryChange<TemplateData> {
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

export function updateTemplateProgram(
  data: TemplateData,
  value: string,
): EntryChange<TemplateData> {
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

export function updateTemplateCwd(
  data: TemplateData,
  value: string,
): EntryChange<TemplateData> {
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

export function updateTemplateStopAtEntry(
  data: TemplateData,
  checked: boolean,
): EntryChange<TemplateData> {
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

export function updateTemplateArgs(
  data: TemplateData,
  args: string[],
): EntryChange<TemplateData> {
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

export function updateConfigExtends(
  data: ConfigData,
  value: string | undefined,
): EntryChange<ConfigData> {
  if (value === undefined) {
    const nextConfig = { ...data.configuration };
    nextConfig.type = stringOrEmpty(nextConfig.type);
    nextConfig.request = 'launch';

    const next = { ...data, configuration: nextConfig };
    delete next.extends;

    return {
      data: next,
      patches: [
        ...createDeleteIfPresentPatch(['extends'], data, 'extends'),
        ...createSetIfChangedPatch(
          ['configuration', 'type'],
          data.configuration?.type,
          nextConfig.type,
        ),
        ...createSetIfChangedPatch(
          ['configuration', 'request'],
          data.configuration?.request,
          'launch',
        ),
      ],
    };
  }

  const nextConfig =
    data.configuration === undefined ? undefined : { ...data.configuration };
  if (nextConfig !== undefined) {
    delete nextConfig.type;
    delete nextConfig.request;
  }

  return {
    data: {
      ...data,
      extends: value,
      ...(nextConfig === undefined ? {} : { configuration: nextConfig }),
    },
    patches: [
      ...createSetIfChangedPatch(['extends'], data.extends, value),
      ...createDeleteIfPresentPatch(
        ['configuration', 'type'],
        data.configuration,
        'type',
      ),
      ...createDeleteIfPresentPatch(
        ['configuration', 'request'],
        data.configuration,
        'request',
      ),
    ],
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

export function updateConfigType(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
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

export function updateConfigRequest(
  data: ConfigData,
  value: string,
): EntryChange<ConfigData> {
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
