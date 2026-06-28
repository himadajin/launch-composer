import { DEBUG_REQUEST_OPTIONS } from './editorUtils.js';

const MISSING_REQUEST_OPTION = '__launch_composer_missing_request__';

export interface ProfileRequestSelectState {
  value: string;
  options: string[];
  optionLabels: string[];
  helperMessage?: string;
}

export function isDebugRequestOption(
  value: string,
): value is (typeof DEBUG_REQUEST_OPTIONS)[number] {
  return DEBUG_REQUEST_OPTIONS.some((entry) => entry === value);
}

export function isInternalProfileRequestSelectValue(value: string): boolean {
  return value === MISSING_REQUEST_OPTION;
}

export function resolveProfileRequestSelectState(
  requestValue: unknown,
): ProfileRequestSelectState {
  if (isDebugRequestOptionValue(requestValue)) {
    return {
      value: requestValue,
      options: [...DEBUG_REQUEST_OPTIONS],
      optionLabels: [...DEBUG_REQUEST_OPTIONS],
    };
  }

  if (requestValue === undefined || requestValue === '') {
    return {
      value: MISSING_REQUEST_OPTION,
      options: [MISSING_REQUEST_OPTION, ...DEBUG_REQUEST_OPTIONS],
      optionLabels: ['Select a request...', ...DEBUG_REQUEST_OPTIONS],
      helperMessage:
        'Profile request is required for Generate. Choose launch or attach.',
    };
  }

  if (typeof requestValue === 'string') {
    return {
      value: requestValue,
      options: [...DEBUG_REQUEST_OPTIONS, requestValue],
      optionLabels: [...DEBUG_REQUEST_OPTIONS, `${requestValue} (invalid)`],
      helperMessage: `Profile request "${requestValue}" is invalid. Choose launch or attach.`,
    };
  }

  return {
    value: MISSING_REQUEST_OPTION,
    options: [MISSING_REQUEST_OPTION, ...DEBUG_REQUEST_OPTIONS],
    optionLabels: ['Select a request...', ...DEBUG_REQUEST_OPTIONS],
    helperMessage:
      'This profile has an invalid request value in JSON. Choose launch or attach to repair it.',
  };
}

function isDebugRequestOptionValue(
  value: unknown,
): value is (typeof DEBUG_REQUEST_OPTIONS)[number] {
  return typeof value === 'string' && isDebugRequestOption(value);
}
