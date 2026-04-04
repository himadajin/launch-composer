import type { ConfigData, LaunchConfig, TemplateData } from './types.js';

const TEMPLATE_SPECIAL_KEYS = new Set(['name', 'args']);
const CONFIG_SPECIAL_KEYS = new Set([
  'name',
  'extends',
  'enabled',
  'argsFile',
  'args',
]);

export function buildLaunchConfig(
  config: ConfigData,
  template?: TemplateData,
  argsFileArgs?: string[],
): LaunchConfig {
  const merged: LaunchConfig = {
    ...omitKeys(template, TEMPLATE_SPECIAL_KEYS),
    ...omitKeys(config, CONFIG_SPECIAL_KEYS),
    name: config.name,
  };

  const args = buildLaunchArgs(template?.args, argsFileArgs, config.args);
  if (args !== undefined) {
    merged.args = args;
  }

  merged.type = ensureRequiredLaunchField(merged.type);
  merged.request = ensureRequiredLaunchField(merged.request);

  return merged;
}

export function buildLaunchArgs(
  templateArgs?: string[],
  argsFileArgs?: string[],
  configArgs?: string[],
): string[] | undefined {
  if (templateArgs !== undefined && argsFileArgs !== undefined) {
    throw new Error('template.args and argsFile cannot be used together.');
  }

  if (templateArgs === undefined && argsFileArgs === undefined) {
    return configArgs;
  }

  if (templateArgs !== undefined) {
    return configArgs === undefined
      ? [...templateArgs]
      : [...templateArgs, ...configArgs];
  }

  return configArgs === undefined
    ? [...(argsFileArgs ?? [])]
    : [...(argsFileArgs ?? []), ...configArgs];
}

function omitKeys(
  value: Record<string, unknown> | undefined,
  keys: Set<string>,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (!keys.has(key)) {
      result[key] = entryValue;
    }
  }

  return result;
}

function ensureRequiredLaunchField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
