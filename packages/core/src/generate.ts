import { buildLaunchConfig } from './merge.js';
import type {
  ArgsFileData,
  ConfigRef,
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

  // From this point on, validation has resolved every argsFile and populated
  // argsFileCache for successful entries.
  const configurations: LaunchConfig[] = [];

  for (const configRef of state.configRefs) {
    if (configRef.data.excluded === true) {
      continue;
    }

    const profile = state.profileMap.get(configRef.data.profile)?.data;
    if (profile === undefined) {
      throw new Error(
        `Config profile was not resolved: ${configRef.data.profile}`,
      );
    }

    const argsFileArgs = resolveArgsForConfig(
      configRef,
      profile,
      state.argsFileCache,
      input.variables,
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

function resolveArgsForConfig(
  configRef: ConfigRef,
  profile: ProfileData,
  argsFileCache: Map<string, ArgsFileData>,
  variables: GenerateInput['variables'],
): string[] | undefined {
  if (profile.args !== undefined) {
    return undefined;
  }

  const rawArgsFile = configRef.data.argsFile;
  if (rawArgsFile === undefined) {
    return undefined;
  }

  const resolvedPath = resolveArgsFilePath(rawArgsFile, variables ?? {});
  if (!resolvedPath.ok) {
    throw new Error(
      `Invariant violation: argsFile was not validated successfully. ${resolvedPath.message}`,
    );
  }

  const cached = argsFileCache.get(resolvedPath.value);
  if (cached === undefined) {
    throw new Error(
      `Invariant violation: argsFile was not cached after validation: ${resolvedPath.value}`,
    );
  }

  return cached.args;
}
