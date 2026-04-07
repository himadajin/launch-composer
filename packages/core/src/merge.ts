import type { ConfigData, LaunchConfig, TemplateData } from './types.js';

export function buildLaunchConfig(
  config: ConfigData,
  template?: TemplateData,
  argsFileArgs?: string[],
): LaunchConfig {
  const merged: LaunchConfig = {
    ...(template?.configuration ?? {}),
    ...(config.configuration ?? {}),
    name: config.name,
  };

  const args = buildLaunchArgs(template?.args, argsFileArgs, config.args);
  if (args !== undefined) {
    merged.args = args;
  }

  merged.type = ensureRequiredLaunchField(merged.type);
  merged.request = requireDebugRequest(merged.request);

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

function ensureRequiredLaunchField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requireDebugRequest(value: unknown): 'launch' | 'attach' {
  if (value === 'launch' || value === 'attach') {
    return value;
  }

  throw new Error('Debug request must be "launch" or "attach".');
}
