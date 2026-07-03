import type { ProfileData } from '../types.js';
import {
  isInternalSelectValue,
  missingValueState,
  placeholderState,
  selectState,
  type SelectState,
} from './selectState.js';

const MISSING_PROFILE_OPTION = '__launch_composer_missing_profile__';
const NO_PROFILES_OPTION = '__launch_composer_no_profiles__';

export interface ConfigProfileSelectState extends SelectState {
  disabled: boolean;
}

export function isInternalProfileSelectValue(value: string): boolean {
  return isInternalSelectValue(value, [
    MISSING_PROFILE_OPTION,
    NO_PROFILES_OPTION,
  ]);
}

export function resolveConfigProfileSelectState(
  profiles: ProfileData[],
  profileValue: unknown,
): ConfigProfileSelectState {
  const profileNames = collectProfileNames(profiles);

  if (typeof profileValue !== 'string') {
    return profilePlaceholderState(
      profileNames,
      profileNames.length === 0
        ? 'This config has an invalid profile value in JSON, and no profiles are available.'
        : 'This config has an invalid profile value in JSON. Choose a profile to repair it.',
    );
  }

  if (profileValue === '') {
    return profilePlaceholderState(
      profileNames,
      profileNames.length === 0
        ? 'This config does not define a profile, and no profiles are available.'
        : 'This config does not define a profile. Choose one to make the config valid.',
    );
  }

  if (profileNames.includes(profileValue)) {
    return selectState({
      value: profileValue,
      options: profileNames,
      disabled: false,
    });
  }

  return missingValueState({
    value: profileValue,
    options: profileNames,
    label: `${profileValue} (missing)`,
    disabled: profileNames.length === 0,
    helperMessage:
      profileNames.length === 0
        ? `The config references missing profile "${profileValue}", and no profiles are available.`
        : `The config references missing profile "${profileValue}". Choose another profile to repair it.`,
  });
}

function profilePlaceholderState(
  profileNames: string[],
  helperMessage: string,
): ConfigProfileSelectState {
  return placeholderState({
    value:
      profileNames.length === 0 ? NO_PROFILES_OPTION : MISSING_PROFILE_OPTION,
    options: profileNames,
    label:
      profileNames.length === 0
        ? 'No profiles available'
        : 'Select a profile...',
    disabled: profileNames.length === 0,
    helperMessage,
  });
}

function collectProfileNames(profiles: ProfileData[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const profile of profiles) {
    if (typeof profile.name !== 'string' || profile.name === '') {
      continue;
    }

    if (seen.has(profile.name)) {
      continue;
    }

    seen.add(profile.name);
    names.push(profile.name);
  }

  return names;
}
