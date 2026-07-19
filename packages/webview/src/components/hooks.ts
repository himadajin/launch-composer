import { useEffect, useRef, useState } from 'react';

export function useDebouncedCommit(
  value: string,
  delay: number,
  onCommit: (value: string) => void,
) {
  // Keep onCommit in a ref so the timer always calls the latest version
  // without needing it in the effect's dependency array. This mirrors
  // VS Code's "register handler after value is set" pattern: programmatic
  // value updates (useEffect syncs from data props) don't restart the timer.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onCommitRef.current(value);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
    // onCommit is intentionally excluded — always current via ref above
  }, [delay, value]);
}

/**
 * Editable text field state that debounce-commits user edits.
 *
 * Distinguishes user input from external data syncs the way VS Code's
 * settings editor does ("clear handler → set value → re-register
 * handler"): external syncs reset the changed-by-user flag, so opening
 * an editor or receiving a workspace update never causes a file write.
 */
export function useEditableField(
  externalValue: string,
  autoSaveDelay: number,
  commit: (value: string) => void,
  options?: { disabled?: boolean },
): { value: string; onChange: (value: string) => void } {
  const [value, setValue] = useState(externalValue);
  const changedByUserRef = useRef(false);
  const disabled = options?.disabled === true;

  useEffect(() => {
    if (!disabled && changedByUserRef.current) {
      return;
    }

    changedByUserRef.current = false;
    setValue(externalValue);
  }, [disabled, externalValue]);

  useDebouncedCommit(value, autoSaveDelay, (nextValue) => {
    if (disabled || !changedByUserRef.current) {
      return;
    }

    changedByUserRef.current = false;
    commit(nextValue);
  });

  const onChange = (nextValue: string) => {
    if (disabled) {
      return;
    }

    changedByUserRef.current = true;
    setValue(nextValue);
  };

  return { value, onChange };
}
