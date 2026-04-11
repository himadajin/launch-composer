export interface ProfileEntry {
  [key: string]: unknown;
}

export interface ProfileData {
  name: string;
  args?: string[];
  configuration?: ProfileEntry;
}

export interface ConfigEntry {
  [key: string]: unknown;
}

export interface ConfigData {
  name: string;
  enabled?: boolean;
  profile: string;
  argsFile?: string;
  args?: string[];
  configuration?: ConfigEntry;
}

export interface ProfileFileData {
  file: string;
  profiles: ProfileData[];
}

export interface ConfigFileData {
  file: string;
  enabled?: boolean;
  configurations: ConfigData[];
}

export interface ArgsFileData {
  args: string[];
  [key: string]: unknown;
}

export interface ValidationError {
  file: string;
  configName?: string;
  field?: string;
  message: string;
}

export interface LaunchConfig {
  name: string;
  args?: string[];
  [key: string]: unknown;
}

export interface LaunchJson {
  version: '0.2.0';
  configurations: LaunchConfig[];
}

export type MaybePromise<T> = T | Promise<T>;

export type ArgsFileLoadResult =
  | { kind: 'success'; data: unknown }
  | { kind: 'not-found' }
  | { kind: 'error'; message?: string };

export type ArgsFileReader = (
  resolvedPath: string,
) => MaybePromise<ArgsFileLoadResult>;

export interface GenerateInput {
  profiles: ProfileFileData[];
  configs: ConfigFileData[];
  variables?: Record<string, string>;
  readArgsFile?: ArgsFileReader;
}

export interface GenerateSuccess {
  success: true;
  launchJson: LaunchJson;
}

export interface GenerateFailure {
  success: false;
  errors: ValidationError[];
}

export type GenerateResult = GenerateSuccess | GenerateFailure;

export interface ProfileRef {
  file: string;
  index: number;
  data: ProfileData;
}

export interface ConfigRef {
  file: string;
  index: number;
  data: ConfigData;
}

export interface ValidationState {
  errors: ValidationError[];
  profileRefs: ProfileRef[];
  configRefs: ConfigRef[];
  profileMap: Map<string, ProfileRef>;
  argsFileCache: Map<string, ArgsFileData>;
}
