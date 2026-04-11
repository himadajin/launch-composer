import type { ConfigData, LaunchConfig, ProfileData } from './types.js';

export function buildLaunchConfig(
  config: ConfigData,
  profile: ProfileData,
  argsFileArgs?: string[],
): LaunchConfig {
  const merged: LaunchConfig = {
    ...(profile.configuration ?? {}),
    ...(config.configuration ?? {}),
    name: config.name,
  };

  const args = buildLaunchArgs(profile.args, argsFileArgs, config.args);
  if (args !== undefined) {
    merged.args = args;
  }

  merged.type = ensureRequiredLaunchField(merged.type);
  merged.request = requireDebugRequest(merged.request);

  return merged;
}

export function buildLaunchArgs(
  profileArgs?: string[],
  argsFileArgs?: string[],
  configArgs?: string[],
): string[] | undefined {
  if (profileArgs !== undefined && argsFileArgs !== undefined) {
    throw new Error('profile.args and argsFile cannot be used together.');
  }

  if (profileArgs === undefined && argsFileArgs === undefined) {
    return configArgs;
  }

  if (profileArgs !== undefined) {
    return configArgs === undefined
      ? [...profileArgs]
      : [...profileArgs, ...configArgs];
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
