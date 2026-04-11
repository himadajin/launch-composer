import { buildLaunchConfig } from './merge.js';
import type {
  ConfigRef,
  ConfigFileData,
  GenerateInput,
  GenerateResult,
  LaunchConfig,
  ProfileData,
} from './types.js';
import { collectValidationState } from './validate.js';
import { resolveArgsFilePath } from './variables.js';

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const state = await collectValidationState(input);
  if (state.errors.length > 0) {
    return {
      success: false,
      errors: state.errors,
    };
  }

  const configurations: LaunchConfig[] = [];
  const fileEnabledByPath = new Map<string, boolean>(
    input.configs.map((fileData: ConfigFileData) => [
      fileData.file,
      fileData.enabled !== false,
    ]),
  );

  for (const configRef of state.configRefs) {
    if (fileEnabledByPath.get(configRef.file) === false) {
      continue;
    }

    if (configRef.data.enabled === false) {
      continue;
    }

    const profile = state.profileMap.get(configRef.data.profile)?.data;
    if (profile === undefined) {
      throw new Error(
        `Config profile was not resolved: ${configRef.data.profile}`,
      );
    }

    const argsFileArgs = await resolveArgsForConfig(
      configRef,
      profile,
      state.argsFileCache,
      input,
    );

    configurations.push(
      buildLaunchConfig(configRef.data, profile, argsFileArgs),
    );
  }

  return {
    success: true,
    launchJson: {
      version: '0.2.0',
      configurations,
    },
  };
}

async function resolveArgsForConfig(
  configRef: ConfigRef,
  profile: ProfileData,
  argsFileCache: Map<string, { args: string[] }>,
  input: GenerateInput,
): Promise<string[] | undefined> {
  if (profile.args !== undefined) {
    return undefined;
  }

  const rawArgsFile = configRef.data.argsFile;
  if (rawArgsFile === undefined) {
    return undefined;
  }

  const resolvedPath = resolveArgsFilePath(rawArgsFile, input.variables ?? {});
  if (!resolvedPath.ok) {
    throw new Error(resolvedPath.message);
  }

  const cached = argsFileCache.get(resolvedPath.value);
  if (cached !== undefined) {
    return cached.args;
  }

  if (input.readArgsFile === undefined) {
    throw new Error('argsFile reader is not configured.');
  }

  const result = await input.readArgsFile(resolvedPath.value);
  if (result.kind !== 'success' || !isStringArrayPayload(result.data)) {
    throw new Error(`Failed to load argsFile: ${resolvedPath.value}`);
  }

  argsFileCache.set(resolvedPath.value, { args: result.data.args });
  return result.data.args;
}

function isStringArrayPayload(value: unknown): value is {
  args: string[];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { args?: unknown }).args) &&
    (value as { args: unknown[] }).args.every(
      (entry) => typeof entry === 'string',
    )
  );
}
