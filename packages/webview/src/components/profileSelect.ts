import type { ProfileData } from '../types.js';

const MISSING_PROFILE_OPTION = '__launch_composer_missing_profile__';
const NO_PROFILES_OPTION = '__launch_composer_no_profiles__';

export interface ConfigProfileSelectState {
  value: string;
  options: string[];
  optionLabels: string[];
  disabled: boolean;
  helperMessage?: string;
}

export function isInternalProfileSelectValue(value: string): boolean {
  return value === MISSING_PROFILE_OPTION || value === NO_PROFILES_OPTION;
}

export function resolveConfigProfileSelectState(
  profiles: ProfileData[],
  profileValue: unknown,
): ConfigProfileSelectState {
  const profileNames = collectProfileNames(profiles);

  if (typeof profileValue !== 'string') {
    return profileNames.length === 0
      ? {
          value: NO_PROFILES_OPTION,
          options: [NO_PROFILES_OPTION],
          optionLabels: ['No profiles available'],
          disabled: true,
          helperMessage:
            'This config has an invalid profile value in JSON, and no profiles are available.',
        }
      : {
          value: MISSING_PROFILE_OPTION,
          options: [MISSING_PROFILE_OPTION, ...profileNames],
          optionLabels: ['Select a profile...', ...profileNames],
          disabled: false,
          helperMessage:
            'This config has an invalid profile value in JSON. Choose a profile to repair it.',
        };
  }

  if (profileValue === '') {
    return profileNames.length === 0
      ? {
          value: NO_PROFILES_OPTION,
          options: [NO_PROFILES_OPTION],
          optionLabels: ['No profiles available'],
          disabled: true,
          helperMessage:
            'This config does not define a profile, and no profiles are available.',
        }
      : {
          value: MISSING_PROFILE_OPTION,
          options: [MISSING_PROFILE_OPTION, ...profileNames],
          optionLabels: ['Select a profile...', ...profileNames],
          disabled: false,
          helperMessage:
            'This config does not define a profile. Choose one to make the config valid.',
        };
  }

  if (profileNames.includes(profileValue)) {
    return {
      value: profileValue,
      options: profileNames,
      optionLabels: profileNames,
      disabled: false,
    };
  }

  return profileNames.length === 0
    ? {
        value: profileValue,
        options: [profileValue],
        optionLabels: [`${profileValue} (missing)`],
        disabled: true,
        helperMessage: `The config references missing profile "${profileValue}", and no profiles are available.`,
      }
    : {
        value: profileValue,
        options: [...profileNames, profileValue],
        optionLabels: [...profileNames, `${profileValue} (missing)`],
        disabled: false,
        helperMessage: `The config references missing profile "${profileValue}". Choose another profile to repair it.`,
      };
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
