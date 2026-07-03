export interface SelectState {
  value: string;
  options: string[];
  optionLabels: string[];
  helperMessage?: string;
  disabled?: boolean;
}

interface SelectStateOptions {
  value: string;
  options: readonly string[];
  optionLabels?: readonly string[];
  helperMessage?: string;
  disabled?: boolean;
}

interface PlaceholderStateOptions {
  value: string;
  label: string;
  options: readonly string[];
  helperMessage?: string;
  disabled?: boolean;
}

type DisabledSelectState = SelectState & { disabled: boolean };

export function selectState(
  options: SelectStateOptions & { disabled: boolean },
): DisabledSelectState;
export function selectState(options: SelectStateOptions): SelectState;
export function selectState({
  value,
  options,
  optionLabels = options,
  helperMessage,
  disabled,
}: SelectStateOptions): SelectState {
  const state: SelectState = {
    value,
    options: [...options],
    optionLabels: [...optionLabels],
  };

  if (helperMessage !== undefined) {
    state.helperMessage = helperMessage;
  }

  if (disabled !== undefined) {
    state.disabled = disabled;
  }

  return state;
}

export function placeholderState(
  options: PlaceholderStateOptions & { disabled: boolean },
): DisabledSelectState;
export function placeholderState(options: PlaceholderStateOptions): SelectState;
export function placeholderState({
  value,
  label,
  options,
  helperMessage,
  disabled,
}: PlaceholderStateOptions): SelectState {
  const stateOptions: SelectStateOptions = {
    value,
    options: [value, ...options],
    optionLabels: [label, ...options],
  };

  if (helperMessage !== undefined) {
    stateOptions.helperMessage = helperMessage;
  }

  if (disabled !== undefined) {
    stateOptions.disabled = disabled;
  }

  return selectState(stateOptions);
}

export function missingValueState(
  options: PlaceholderStateOptions & { disabled: boolean },
): DisabledSelectState;
export function missingValueState(
  options: PlaceholderStateOptions,
): SelectState;
export function missingValueState({
  value,
  label,
  options,
  helperMessage,
  disabled,
}: PlaceholderStateOptions): SelectState {
  const stateOptions: SelectStateOptions = {
    value,
    options: [...options, value],
    optionLabels: [...options, label],
  };

  if (helperMessage !== undefined) {
    stateOptions.helperMessage = helperMessage;
  }

  if (disabled !== undefined) {
    stateOptions.disabled = disabled;
  }

  return selectState(stateOptions);
}

export function isInternalSelectValue(
  value: string,
  internalValues: readonly string[],
): boolean {
  return internalValues.includes(value);
}
