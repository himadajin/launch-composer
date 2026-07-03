import { DEBUG_REQUEST_OPTIONS } from './editorUtils.js';
import {
  isInternalSelectValue,
  missingValueState,
  placeholderState,
  selectState,
  type SelectState,
} from './selectState.js';

const MISSING_REQUEST_OPTION = '__launch_composer_missing_request__';

export type ProfileRequestSelectState = SelectState;

export function isDebugRequestOption(
  value: string,
): value is (typeof DEBUG_REQUEST_OPTIONS)[number] {
  return DEBUG_REQUEST_OPTIONS.some((entry) => entry === value);
}

export function isInternalProfileRequestSelectValue(value: string): boolean {
  return isInternalSelectValue(value, [MISSING_REQUEST_OPTION]);
}

export function resolveProfileRequestSelectState(
  requestValue: unknown,
): ProfileRequestSelectState {
  if (isDebugRequestOptionValue(requestValue)) {
    return selectState({
      value: requestValue,
      options: DEBUG_REQUEST_OPTIONS,
    });
  }

  if (requestValue === undefined || requestValue === '') {
    return requestPlaceholderState(
      'Profile request is required for Generate. Choose launch or attach.',
    );
  }

  if (typeof requestValue === 'string') {
    return missingValueState({
      value: requestValue,
      options: DEBUG_REQUEST_OPTIONS,
      label: `${requestValue} (invalid)`,
      helperMessage: `Profile request "${requestValue}" is invalid. Choose launch or attach.`,
    });
  }

  return requestPlaceholderState(
    'This profile has an invalid request value in JSON. Choose launch or attach to repair it.',
  );
}

function requestPlaceholderState(
  helperMessage: string,
): ProfileRequestSelectState {
  return placeholderState({
    value: MISSING_REQUEST_OPTION,
    options: DEBUG_REQUEST_OPTIONS,
    label: 'Select a request...',
    helperMessage,
  });
}

function isDebugRequestOptionValue(
  value: unknown,
): value is (typeof DEBUG_REQUEST_OPTIONS)[number] {
  return typeof value === 'string' && isDebugRequestOption(value);
}
