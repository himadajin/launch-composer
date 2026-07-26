import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigEditor } from '../src/components/ConfigEditor.js';
import { ProfileEditor } from '../src/components/ProfileEditor.js';
import type { EntryChange } from '../src/components/entryChanges.js';
import type { ConfigData, ProfileData } from '../src/types.js';

vi.mock('@himadajin/vscode-components', () => ({
  Button({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) {
    return (
      <button disabled={disabled} onClick={onClick} type="button">
        {children}
      </button>
    );
  },
  Checkbox({
    label,
    checked,
    disabled,
    onChange,
  }: {
    label?: string;
    checked?: boolean;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
  }) {
    return (
      <input
        aria-label={label}
        type="checkbox"
        checked={checked === true}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
    );
  },
  FormContainer({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  FormGroup({ children, helper }: { children: ReactNode; helper?: ReactNode }) {
    return (
      <div>
        {children}
        {helper}
      </div>
    );
  },
  FormHelper({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  ListEditor() {
    return <div />;
  },
  Select({ value }: { value: string }) {
    return <div data-testid="select">{value}</div>;
  },
  TextInput({
    value,
    placeholder,
    disabled,
    onChange,
  }: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
  }) {
    return (
      <input
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  },
}));

const profiles: ProfileData[] = [
  {
    name: 'cpp',
    configuration: {
      type: 'cppdbg',
      request: 'launch',
      cwd: '${workspaceFolder}/app',
      stopAtEntry: true,
    },
  },
];

function renderConfigEditor(data: ConfigData) {
  const onChange = vi.fn<(change: EntryChange<ConfigData>) => void>();
  render(
    <ConfigEditor
      data={data}
      sourceFile="config.json"
      profiles={profiles}
      autoSaveDelay={0}
      onBrowseFile={async () => null}
      onChange={onChange}
      onRename={async () => undefined}
      onOpenJson={() => undefined}
      onOpenProfile={() => undefined}
    />,
  );

  return { onChange };
}

function renderProfileEditor(data: ProfileData) {
  const onChange = vi.fn<(change: EntryChange<ProfileData>) => void>();
  render(
    <ProfileEditor
      data={data}
      sourceFile="profile.json"
      autoSaveDelay={0}
      onChange={onChange}
      onRename={async () => undefined}
      onOpenJson={() => undefined}
    />,
  );

  return { onChange };
}

// ConfigEditor renders the Working Directory override checkbox before the
// Stop At Entry one; both use the "Override" label.
function getConfigOverrideCheckboxes() {
  const checkboxes = screen.getAllByLabelText('Override');
  expect(checkboxes).toHaveLength(2);
  return { cwd: checkboxes[0]!, stopAtEntry: checkboxes[1]! };
}

afterEach(cleanup);

describe('ConfigEditor override fields', () => {
  it('shows inherited values while overrides are off', () => {
    renderConfigEditor({ name: 'Launch', profile: 'cpp' });

    const override = getConfigOverrideCheckboxes();
    expect((override.cwd as HTMLInputElement).checked).toBe(false);
    expect((override.stopAtEntry as HTMLInputElement).checked).toBe(false);

    const cwdInput = screen.getByPlaceholderText(
      '${workspaceFolder}/app',
    ) as HTMLInputElement;
    expect(cwdInput.disabled).toBe(true);
    expect(cwdInput.value).toBe('');

    const stopValue = screen.getByLabelText('Enabled') as HTMLInputElement;
    expect(stopValue.checked).toBe(true);
    expect(stopValue.disabled).toBe(true);

    expect(screen.getAllByText('Inherited from profile "cpp".')).toHaveLength(
      2,
    );
  });

  it('reports a missing inheritance source when the profile does not resolve', () => {
    renderConfigEditor({ name: 'Launch', profile: 'ghost' });

    expect(screen.getAllByText('No profile to inherit from.')).toHaveLength(2);
    expect(screen.queryByPlaceholderText('${workspaceFolder}/app')).toBeNull();
    expect(
      (screen.getByLabelText('Disabled') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('derives override state from key presence in the config JSON', () => {
    renderConfigEditor({
      name: 'Launch',
      profile: 'cpp',
      configuration: { cwd: '${workspaceFolder}/tools', stopAtEntry: false },
    });

    const override = getConfigOverrideCheckboxes();
    expect((override.cwd as HTMLInputElement).checked).toBe(true);
    expect((override.stopAtEntry as HTMLInputElement).checked).toBe(true);

    const stopValue = screen.getByLabelText('Disabled') as HTMLInputElement;
    expect(stopValue.checked).toBe(false);
    expect(stopValue.disabled).toBe(false);
  });

  it('writes the displayed effective value when Stop At Entry override turns on', () => {
    const { onChange } = renderConfigEditor({ name: 'Launch', profile: 'cpp' });

    fireEvent.click(getConfigOverrideCheckboxes().stopAtEntry);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].patches).toEqual([
      { type: 'set', path: ['configuration', 'stopAtEntry'], value: true },
    ]);
  });

  it('deletes the key when Stop At Entry override turns off', () => {
    const { onChange } = renderConfigEditor({
      name: 'Launch',
      profile: 'cpp',
      configuration: { stopAtEntry: false },
    });

    fireEvent.click(getConfigOverrideCheckboxes().stopAtEntry);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].patches).toEqual([
      { type: 'delete', path: ['configuration', 'stopAtEntry'] },
    ]);
  });

  it('starts editing from the inherited value without saving when Working Directory override turns on', () => {
    const { onChange } = renderConfigEditor({ name: 'Launch', profile: 'cpp' });

    fireEvent.click(getConfigOverrideCheckboxes().cwd);

    expect(onChange).not.toHaveBeenCalled();
    const cwdInput = screen.getByDisplayValue(
      '${workspaceFolder}/app',
    ) as HTMLInputElement;
    expect(cwdInput.disabled).toBe(false);
  });

  it('deletes the key when Working Directory override turns off', () => {
    const { onChange } = renderConfigEditor({
      name: 'Launch',
      profile: 'cpp',
      configuration: { cwd: '${workspaceFolder}/tools' },
    });

    fireEvent.click(getConfigOverrideCheckboxes().cwd);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].patches).toEqual([
      { type: 'delete', path: ['configuration', 'cwd'] },
    ]);
  });
});

describe('ProfileEditor Stop At Entry Set toggle', () => {
  it('shows the unset state with the adapter-default helper', () => {
    renderProfileEditor({
      name: 'cpp',
      configuration: { type: 'cppdbg', request: 'launch' },
    });

    const setToggle = screen.getByLabelText('Set') as HTMLInputElement;
    expect(setToggle.checked).toBe(false);

    const value = screen.getByLabelText('Disabled') as HTMLInputElement;
    expect(value.checked).toBe(false);
    expect(value.disabled).toBe(true);

    expect(
      screen.getByText('Not set. The debug adapter default applies.'),
    ).toBeDefined();
  });

  it('writes false when Set turns on', () => {
    const { onChange } = renderProfileEditor({
      name: 'cpp',
      configuration: { type: 'cppdbg', request: 'launch' },
    });

    fireEvent.click(screen.getByLabelText('Set'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].patches).toEqual([
      { type: 'set', path: ['configuration', 'stopAtEntry'], value: false },
    ]);
  });

  it('deletes the key when Set turns off', () => {
    const { onChange } = renderProfileEditor({
      name: 'cpp',
      configuration: { type: 'cppdbg', request: 'launch', stopAtEntry: true },
    });

    const setToggle = screen.getByLabelText('Set') as HTMLInputElement;
    expect(setToggle.checked).toBe(true);
    expect(
      (screen.getByLabelText('Enabled') as HTMLInputElement).disabled,
    ).toBe(false);

    fireEvent.click(setToggle);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].patches).toEqual([
      { type: 'delete', path: ['configuration', 'stopAtEntry'] },
    ]);
  });
});
