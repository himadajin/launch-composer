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
  options?: { readOnly?: boolean },
): { value: string; onChange: (value: string) => void } {
  const [value, setValue] = useState(externalValue);
  const changedByUserRef = useRef(false);
  const readOnly = options?.readOnly === true;

  useEffect(() => {
    changedByUserRef.current = false;
    setValue(externalValue);
  }, [externalValue]);

  useDebouncedCommit(value, autoSaveDelay, (nextValue) => {
    if (readOnly || !changedByUserRef.current) {
      return;
    }

    commit(nextValue);
  });

  const onChange = (nextValue: string) => {
    changedByUserRef.current = true;
    setValue(nextValue);
  };

  return { value, onChange };
}
