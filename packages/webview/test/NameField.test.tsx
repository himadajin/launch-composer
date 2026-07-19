import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { KeyboardEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NameField } from '../src/components/NameField.js';

vi.mock('@himadajin/vscode-components', () => ({
  FormGroup({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  TextInput({
    disabled,
    onBlur,
    onChange,
    onKeyDown,
    value,
  }: {
    disabled: boolean;
    onBlur: () => void;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    value: string;
  }) {
    return (
      <input
        aria-label="Entry name"
        disabled={disabled}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    );
  },
}));

const defaultProps = {
  label: 'Config: Name',
  description: 'Entry name',
  externalName: 'Original',
  readOnly: false,
  helper: undefined,
};

afterEach(cleanup);

describe('NameField', () => {
  it('restores the external name after a rejected rename result', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<NameField {...defaultProps} onRename={onRename} />);
    const input = screen.getByRole('textbox', { name: 'Entry name' });

    fireEvent.change(input, { target: { value: 'Duplicate' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('Duplicate');
      expect((input as HTMLInputElement).value).toBe('Original');
    });
  });

  it('reflects the normalized name from the refreshed snapshot', async () => {
    let finishRename: (() => void) | undefined;
    const onRename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRename = resolve;
        }),
    );
    const { rerender } = render(
      <NameField {...defaultProps} onRename={onRename} />,
    );
    const input = screen.getByRole('textbox', { name: 'Entry name' });

    fireEvent.change(input, { target: { value: '  Normalized  ' } });
    fireEvent.blur(input);

    rerender(
      <NameField
        {...defaultProps}
        externalName="Normalized"
        onRename={onRename}
      />,
    );
    finishRename?.();

    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('Normalized'),
    );
  });

  it('commits on Enter by blurring the input', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<NameField {...defaultProps} onRename={onRename} />);
    const input = screen.getByRole('textbox', { name: 'Entry name' });

    fireEvent.change(input, { target: { value: 'Renamed' } });
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Renamed'));
  });
});
