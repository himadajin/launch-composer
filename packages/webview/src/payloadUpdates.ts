import type { ConfigData, InitialDataPayload, ProfileData } from './types.js';

export function updatePayload(
  payload: InitialDataPayload,
  editor: InitialDataPayload['editor'],
  nextData: ProfileData | ConfigData,
): InitialDataPayload {
  return editor.kind === 'profile'
    ? {
        ...payload,
        profiles: payload.profiles.map((fileData) =>
          fileData.file !== editor.file
            ? fileData
            : {
                ...fileData,
                profiles: fileData.profiles.map((profile, index) =>
                  index === editor.index ? (nextData as ProfileData) : profile,
                ),
              },
        ),
      }
    : {
        ...payload,
        configs: payload.configs.map((fileData) =>
          fileData.file !== editor.file
            ? fileData
            : {
                ...fileData,
                configurations: fileData.configurations.map((config, index) =>
                  index === editor.index ? (nextData as ConfigData) : config,
                ),
              },
        ),
      };
}

export function createPlaceholderProfile(file: string): ProfileData {
  return {
    name: file,
    configuration: { type: '', request: 'launch' },
  };
}

export function createPlaceholderConfig(file: string): ConfigData {
  return {
    name: file,
    profile: '',
  };
}
