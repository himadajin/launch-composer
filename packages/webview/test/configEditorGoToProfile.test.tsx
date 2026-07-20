import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigEditor } from '../src/components/ConfigEditor.js';
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
  Checkbox({ label }: { label?: string }) {
    return <input aria-label={label} type="checkbox" readOnly />;
  },
  FormContainer({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  FormGroup({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  FormHelper({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  },
  ListEditor() {
    return <div />;
  },
  Select({ value }: { value: string }) {
    return <div data-testid="profile-select">{value}</div>;
  },
  TextInput({ value }: { value?: string }) {
    return <input value={value ?? ''} readOnly />;
  },
}));

const profiles: ProfileData[] = [
  {
    name: 'cpp',
    configuration: { request: 'launch', type: 'cppdbg' },
  },
];

function createConfig(profile: string): ConfigData {
  return {
    name: 'Launch',
    profile,
  };
}

function renderConfigEditor({
  data,
  onOpenProfile = () => undefined,
  readOnlyIssue,
}: {
  data: ConfigData;
  onOpenProfile?: (profileName: string) => void;
  readOnlyIssue?: {
    kind: 'config';
    file: string;
    code: 'invalid-json';
    message: string;
  };
}) {
  return render(
    <ConfigEditor
      data={data}
      sourceFile="config.json"
      profiles={profiles}
      autoSaveDelay={0}
      onBrowseFile={async () => null}
      onChange={() => undefined}
      onRename={async () => undefined}
      onOpenJson={() => undefined}
      onOpenProfile={onOpenProfile}
      readOnlyIssue={readOnlyIssue}
    />,
  );
}

afterEach(cleanup);

describe('ConfigEditor Go to Profile button', () => {
  it('opens the referenced profile when the reference resolves', () => {
    const onOpenProfile = vi.fn();
    renderConfigEditor({ data: createConfig('cpp'), onOpenProfile });

    const button = screen.getByRole('button', { name: 'Go to Profile' });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(onOpenProfile).toHaveBeenCalledWith('cpp');
  });

  it('is disabled when the config does not reference a profile', () => {
    const onOpenProfile = vi.fn();
    renderConfigEditor({ data: createConfig(''), onOpenProfile });

    const button = screen.getByRole('button', { name: 'Go to Profile' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onOpenProfile).not.toHaveBeenCalled();
  });

  it('is disabled when the referenced profile is missing', () => {
    const onOpenProfile = vi.fn();
    renderConfigEditor({ data: createConfig('ghost'), onOpenProfile });

    const button = screen.getByRole('button', { name: 'Go to Profile' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onOpenProfile).not.toHaveBeenCalled();
  });

  it('is disabled while the editor is read-only', () => {
    const onOpenProfile = vi.fn();
    renderConfigEditor({
      data: createConfig('cpp'),
      onOpenProfile,
      readOnlyIssue: {
        kind: 'config',
        file: 'config.json',
        code: 'invalid-json',
        message: 'Invalid JSON in config.json.',
      },
    });

    const button = screen.getByRole('button', { name: 'Go to Profile' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onOpenProfile).not.toHaveBeenCalled();
  });
});
