import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConfigData,
  InitialDataPayload,
  ProfileData,
  WebviewMessage,
} from '../src/types.js';

const webviewState = vi.hoisted(() => ({
  payload: null as InitialDataPayload | null,
  posted: [] as WebviewMessage[],
}));

vi.mock('../src/utils/vscode.js', () => ({
  vscode: {
    getState: () => webviewState.payload ?? undefined,
    postMessage: (message: WebviewMessage) => {
      webviewState.posted.push(message);
    },
    setState: (payload: InitialDataPayload) => {
      webviewState.payload = payload;
    },
  },
}));

vi.mock('../src/components/ProfileEditor.js', async () => {
  const { updateProfileProgram } =
    await import('../src/components/entryChanges.js');
  const { useEditableField } = await import('../src/components/hooks.js');

  return {
    ProfileEditor({
      autoSaveDelay,
      data,
      onChange,
    }: {
      autoSaveDelay: number;
      data: ProfileData;
      onChange: (change: ReturnType<typeof updateProfileProgram>) => void;
    }) {
      const field = useEditableField(
        typeof data.configuration?.program === 'string'
          ? data.configuration.program
          : '',
        autoSaveDelay,
        (value) => onChange(updateProfileProgram(data, value)),
      );

      return (
        <input
          aria-label="Profile program"
          value={field.value}
          onChange={(event) => field.onChange(event.currentTarget.value)}
        />
      );
    },
  };
});

vi.mock('../src/components/ConfigEditor.js', async () => {
  const { updateConfigArgsFile } =
    await import('../src/components/entryChanges.js');
  const { useEditableField } = await import('../src/components/hooks.js');

  return {
    ConfigEditor({
      autoSaveDelay,
      data,
      onChange,
      profiles,
    }: {
      autoSaveDelay: number;
      data: ConfigData;
      onChange: (change: ReturnType<typeof updateConfigArgsFile>) => void;
      profiles: ProfileData[];
    }) {
      const selectedProfile = profiles.find(
        (profile) => profile.name === data.profile,
      );
      const disabled = selectedProfile?.args !== undefined;
      const field = useEditableField(
        typeof data.argsFile === 'string' ? data.argsFile : '',
        autoSaveDelay,
        (value) => onChange(updateConfigArgsFile(data, value)),
        { disabled },
      );

      return (
        <input
          aria-label="Config args file"
          disabled={disabled}
          value={field.value}
          onChange={(event) => field.onChange(event.currentTarget.value)}
        />
      );
    },
  };
});

import { App } from '../src/App.js';

const profiles: ProfileData[] = [
  {
    name: 'Plain',
    configuration: { request: 'launch', type: 'node' },
  },
  {
    name: 'With Args',
    args: ['--inspect'],
    configuration: { request: 'launch', type: 'node' },
  },
];

function createPayload(
  editor: InitialDataPayload['editor'],
  overrides: Partial<InitialDataPayload> = {},
): InitialDataPayload {
  return {
    profiles: [{ file: 'profiles.json', profiles }],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          { name: 'Config A', profile: 'Plain' },
          { name: 'Config B', profile: 'Plain' },
        ],
      },
    ],
    issues: [],
    generateReadiness: { diagnostics: [] },
    editor,
    editorRevision: 'revision-1',
    autoSaveDelay: 300,
    ...overrides,
  };
}

function sendPayload(payload: InitialDataPayload) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'initial-data',
          requestId: crypto.randomUUID(),
          payload,
        },
      }),
    );
  });
}

function postedUpdates(type: 'update-profile' | 'update-config') {
  return webviewState.posted.filter((message) => message.type === type);
}

describe('editor state isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    webviewState.posted = [];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('discards a profile draft when switching entries in the same file', () => {
    webviewState.payload = createPayload({
      kind: 'profile',
      file: 'profiles.json',
      index: 0,
    });
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Profile program' });

    fireEvent.change(input, { target: { value: 'old-entry.js' } });
    sendPayload(
      createPayload({
        kind: 'profile',
        file: 'profiles.json',
        index: 1,
      }),
    );

    expect(
      (
        screen.getByRole('textbox', {
          name: 'Profile program',
        }) as HTMLInputElement
      ).value,
    ).toBe('');

    act(() => vi.advanceTimersByTime(600));
    expect(postedUpdates('update-profile')).toHaveLength(0);
  });

  it('discards a config draft when switching entries in the same file', () => {
    webviewState.payload = createPayload({
      kind: 'config',
      file: 'configs.json',
      index: 0,
    });
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Config args file' });

    fireEvent.change(input, { target: { value: 'old-entry.args' } });
    sendPayload(
      createPayload({
        kind: 'config',
        file: 'configs.json',
        index: 1,
      }),
    );

    expect(
      (
        screen.getByRole('textbox', {
          name: 'Config args file',
        }) as HTMLInputElement
      ).value,
    ).toBe('');

    act(() => vi.advanceTimersByTime(600));
    expect(postedUpdates('update-config')).toHaveLength(0);
  });

  it('discards an Args File draft when the selected profile disables it', () => {
    const editor = {
      kind: 'config' as const,
      file: 'configs.json',
      index: 0,
    };
    webviewState.payload = createPayload(editor);
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Config args file' });

    fireEvent.change(input, { target: { value: 'pending.args' } });
    sendPayload(
      createPayload(editor, {
        configs: [
          {
            file: 'configs.json',
            configurations: [
              { name: 'Config A', profile: 'With Args' },
              { name: 'Config B', profile: 'Plain' },
            ],
          },
        ],
        editorRevision: 'revision-2',
      }),
    );

    const disabledInput = screen.getByRole('textbox', {
      name: 'Config args file',
    }) as HTMLInputElement;
    expect(disabledInput.disabled).toBe(true);
    expect(disabledInput.value).toBe('');

    act(() => vi.advanceTimersByTime(600));
    expect(postedUpdates('update-config')).toHaveLength(0);
  });
});
