import { useEffect, useRef } from 'react';

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
