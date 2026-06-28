import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceStore } from '../src/io/workspaceStore.js';
import * as vscode from 'vscode';

import {
  configFileUri,
  readText,
  testVscode,
  workspaceUri,
  writeConfigFile,
  writeProfileFile,
} from './helpers.js';

test.beforeEach(() => {
  testVscode.__testing.reset();
});

const READY_TO_GENERATE = {
  ready: true,
  errors: [],
};

test('readAll returns empty data when Launch Composer directories do not exist', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/empty-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
    generateReadiness: READY_TO_GENERATE,
  });
});

test('readAll tolerates ENOENT-style missing directories', async () => {
  testVscode.__testing.setMissingPathErrorStyle('enoent');
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/enoent-empty-project'),
  );

  const data = await store.readAll();

  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
    generateReadiness: READY_TO_GENERATE,
  });
});

test('readAll skips files that disappear before they can be read', async () => {
  testVscode.__testing.setMissingPathErrorStyle('vscode-enoent');
  testVscode.__testing.createGhostFile(
    '/workspace/racy-project/.vscode/launch-composer/profiles/racy.json',
  );
  testVscode.__testing.createGhostFile(
    '/workspace/racy-project/.vscode/launch-composer/configs/racy.json',
  );
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/racy-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
    generateReadiness: READY_TO_GENERATE,
  });
});

test('readAll keeps valid files and reports invalid files as issues', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/invalid-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode(''),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/profiles/valid.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const data = await store.readAll();

  assert.deepEqual(data.profiles, [
    {
      file: 'valid.json',
      profiles: [{ name: 'cpp' }],
    },
  ]);
  assert.deepEqual(data.configs, []);
  assert.deepEqual(data.issues, [
    {
      kind: 'profile',
      file: 'profile.json',
      code: 'empty',
      message: 'profile.json is empty. Expected a JSON array such as [].',
    },
  ]);
  assert.deepEqual(data.generateReadiness, {
    ready: false,
    errors: [
      {
        file: 'profile.json',
        message: 'profile.json is empty. Expected a JSON array such as [].',
      },
    ],
  });
});

test('readAll returns ready generateReadiness for valid data', async () => {
  const workspace = workspaceUri('readiness-valid-project');
  const store = new WorkspaceStore(workspace);

  await writeProfileFile(
    workspace,
    'profile.json',
    '[\n  {\n    "name": "node",\n    "configuration": {\n      "type": "node",\n      "request": "launch"\n    }\n  }\n]\n',
  );
  await writeConfigFile(
    workspace,
    'config.json',
    '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "profile": "node"\n    }\n  ]\n}\n',
  );

  const data = await store.readAll();

  assert.deepEqual(data.generateReadiness, READY_TO_GENERATE);
});

test('readAll reports core validation errors in generateReadiness', async () => {
  const workspace = workspaceUri('readiness-invalid-profile-project');
  const store = new WorkspaceStore(workspace);

  await writeProfileFile(
    workspace,
    'profile.json',
    '[\n  {\n    "name": "node",\n    "configuration": {\n      "type": "",\n      "request": "launch"\n    }\n  }\n]\n',
  );

  const data = await store.readAll();

  assert.deepEqual(data.generateReadiness, {
    ready: false,
    errors: [
      {
        file: 'profile.json',
        field: 'configuration.type',
        message: 'Profile type is required.',
      },
    ],
  });
});

test('readAll reports missing argsFile in generateReadiness', async () => {
  const workspace = workspaceUri('readiness-missing-args-project');
  const store = new WorkspaceStore(workspace);

  await writeProfileFile(
    workspace,
    'profile.json',
    '[\n  {\n    "name": "node",\n    "configuration": {\n      "type": "node",\n      "request": "launch"\n    }\n  }\n]\n',
  );
  await writeConfigFile(
    workspace,
    'config.json',
    '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "profile": "node",\n      "argsFile": "${workspaceFolder}/missing-args.json"\n    }\n  ]\n}\n',
  );

  const data = await store.readAll();

  assert.equal(data.generateReadiness?.ready, false);
  assert.deepEqual(data.generateReadiness?.errors[0], {
    file: 'config.json',
    configName: 'Launch',
    field: 'argsFile',
    message:
      'argsFile does not exist: /workspace/readiness-missing-args-project/missing-args.json',
  });
});

test('readProfilesWithIssues reads profile data without requiring config directories', async () => {
  const workspaceUri = vscode.Uri.file('/workspace/profiles-only-project');
  const store = new WorkspaceStore(workspaceUri);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(workspaceUri, '.vscode', 'launch-composer', 'profiles'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(
      workspaceUri,
      '.vscode',
      'launch-composer',
      'profiles',
      'profile.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const data = await store.readProfilesWithIssues();

  assert.deepEqual(data, {
    profiles: [
      {
        file: 'profile.json',
        profiles: [{ name: 'cpp' }],
      },
    ],
    issues: [],
  });
});

test('readConfigsWithIssues reads config data without requiring profile directories', async () => {
  const workspaceUri = vscode.Uri.file('/workspace/configs-only-project');
  const store = new WorkspaceStore(workspaceUri);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(workspaceUri, '.vscode', 'launch-composer', 'configs'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(
      workspaceUri,
      '.vscode',
      'launch-composer',
      'configs',
      'config.json',
    ),
    new TextEncoder().encode(
      '{\n  "configurations": [\n    {\n      "name": "Launch"\n    }\n  ]\n}\n',
    ),
  );

  const data = await store.readConfigsWithIssues();

  assert.deepEqual(data, {
    configs: [
      {
        file: 'config.json',
        configurations: [{ name: 'Launch' }],
      },
    ],
    issues: [],
  });
});

test('generateLaunchJson returns validation-style errors for invalid files', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/generate-invalid-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/generate-invalid-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/generate-invalid-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode('{'),
  );

  const result = await store.generateLaunchJson();

  assert.deepEqual(result, {
    success: false,
    errors: [
      {
        file: 'profile.json',
        message:
          'Invalid JSON in profile.json. Open the file and fix the syntax.',
      },
    ],
  });
});

test('addProfileEntry creates its backing file when it does not exist', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/profile-project'),
  );

  const target = await store.addProfileEntry('new-profile.json', 'cpp');

  assert.deepEqual(target, {
    kind: 'profile',
    file: 'new-profile.json',
    index: 0,
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/profile-project/.vscode/launch-composer/profiles/new-profile.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes).trim(),
    '[\n  {\n    "name": "cpp",\n    "configuration": {\n      "type": "",\n      "request": "launch"\n    }\n  }\n]',
  );
});

test('addConfigEntry creates its backing file when it does not exist', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-project'),
  );

  const target = await store.addConfigEntry(
    'new-config.json',
    'Basic Test',
    'cpp',
  );

  assert.deepEqual(target, {
    kind: 'config',
    file: 'new-config.json',
    index: 0,
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/config-project/.vscode/launch-composer/configs/new-config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes).trim(),
    '{\n  "configurations": [\n    {\n      "name": "Basic Test",\n      "profile": "cpp"\n    }\n  ]\n}',
  );
});

test('addConfigEntry creates included configs without exclusion state', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/new-config-file-project'),
  );

  await store.addConfigEntry('config.json', 'Launch', 'cpp');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/new-config-file-project/.vscode/launch-composer/configs/config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes),
    '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "profile": "cpp"\n    }\n  ]\n}\n',
  );
});

test('addProfileEntry preserves existing JSONC comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-add-profile-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-add-profile-project/.vscode/launch-composer/profiles/profile.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-add-profile-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '// profile file comment\n' +
        '[\n' +
        '  // keep profile comment\n' +
        '  {\n' +
        '    "name": "cpp",\n' +
        '    "configuration": {\n' +
        '      "type": "cppdbg",\n' +
        '      "request": "launch"\n' +
        '    }\n' +
        '  }\n' +
        ']\n',
    ),
  );

  await store.addProfileEntry('profile.json', 'node');

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ profile file comment/);
  assert.match(text, /\/\/ keep profile comment/);
  assert.match(text, /"name": "node"/);
});

test('addConfigEntry preserves existing JSONC comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-add-config-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-add-config-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-add-config-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n' +
        '  // keep file comment\n' +
        '  "configurations": [\n' +
        '    // keep config comment\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      "profile": "cpp"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.addConfigEntry('config.json', 'Attach', 'cpp');

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ keep file comment/);
  assert.match(text, /\/\/ keep config comment/);
  assert.match(text, /"name": "Attach"/);
});

test('deleteEntry preserves comments around remaining entries', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-delete-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-delete-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-delete-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Delete Me",\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch"\n' +
        '      }\n' +
        '    },\n' +
        '    {\n' +
        '      "name": "Keep Me",\n' +
        '      // keep surviving comment\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch"\n' +
        '      }\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.deleteEntry({
    kind: 'config',
    file: 'config.json',
    index: 0,
  });

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.doesNotMatch(text, /Delete Me/);
  assert.match(text, /\/\/ keep surviving comment/);
  assert.match(text, /Keep Me/);
});

test('toggle config exclusion preserves unrelated comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-toggle-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-toggle-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-toggle-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n' +
        '  // keep file comment\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      // keep entry comment\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch"\n' +
        '      }\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.toggleConfigExcluded('config.json', 0);

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ keep file comment/);
  assert.match(text, /\/\/ keep entry comment/);
  assert.match(text, /"excluded": true/);
});

test('setConfigFileExcluded excludes and includes all configs while preserving comments', async () => {
  const workspace = workspaceUri('bulk-config-project');
  const store = new WorkspaceStore(workspace);

  const fileUri = await writeConfigFile(
    workspace,
    'config.json',
    '{\n' +
      '  // keep file comment\n' +
      '  "configurations": [\n' +
      '    {\n' +
      '      "name": "Launch",\n' +
      '      // keep first comment\n' +
      '      "profile": "cpp"\n' +
      '    },\n' +
      '    {\n' +
      '      "name": "Skip",\n' +
      '      "excluded": true,\n' +
      '      // keep second comment\n' +
      '      "profile": "cpp"\n' +
      '    }\n' +
      '  ]\n' +
      '}\n',
  );

  await store.setConfigFileExcluded('config.json', true);

  let text = await readText(fileUri);
  assert.match(text, /\/\/ keep file comment/);
  assert.match(text, /\/\/ keep first comment/);
  assert.match(text, /\/\/ keep second comment/);
  assert.equal((text.match(/"excluded": true/g) ?? []).length, 2);

  await store.setConfigFileExcluded('config.json', false);

  text = await readText(fileUri);
  assert.match(text, /\/\/ keep file comment/);
  assert.match(text, /\/\/ keep first comment/);
  assert.match(text, /\/\/ keep second comment/);
  assert.doesNotMatch(text, /"excluded"/);
});

test('setConfigFileExcluded no-ops when config file has no entries to change', async () => {
  const workspace = workspaceUri('bulk-noop-project');
  const store = new WorkspaceStore(workspace);

  await writeConfigFile(
    workspace,
    'config.json',
    '{\n  "configurations": []\n}\n',
  );

  await store.setConfigFileExcluded('config.json', true);
  await store.setConfigFileExcluded('config.json', false);

  const text = await readText(configFileUri(workspace));
  assert.equal(text, '{\n  "configurations": []\n}\n');
});

test('createDataFile supports unicode file names without stat-ing the target path', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/unicode-project'),
  );

  const fileName = await store.createDataFile('profile', 'あ');

  assert.equal(fileName, 'あ.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/unicode-project/.vscode/launch-composer/profiles/あ.json',
    ),
  );

  assert.equal(new TextDecoder().decode(bytes), '[]\n');
});

test('deleteDataFile tolerates a file that has already been removed', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/delete-project'),
  );

  await store.deleteDataFile('config', 'missing.json');

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
});

test('renameDataFile moves the JSON file without changing its contents', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/rename-file-project'),
  );
  const sourceUri = vscode.Uri.file(
    '/workspace/rename-file-project/.vscode/launch-composer/profiles/profile.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-file-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    sourceUri,
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const renamed = await store.renameDataFile(
    'profile',
    'profile.json',
    'renamed-profile.json',
  );

  assert.equal(renamed, 'renamed-profile.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/rename-file-project/.vscode/launch-composer/profiles/renamed-profile.json',
    ),
  );
  await assert.rejects(async () => vscode.workspace.fs.readFile(sourceUri));

  assert.equal(
    new TextDecoder().decode(bytes),
    '[\n  {\n    "name": "cpp"\n  }\n]\n',
  );
});

test('renameEntry updates profile references in configs', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/rename-entry-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "excluded": true,\n      "profile": "cpp"\n    }\n  ]\n}\n',
    ),
  );

  await store.renameEntry(
    {
      kind: 'profile',
      file: 'profile.json',
      index: 0,
    },
    'cpp-renamed',
  );

  const [profileBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/rename-entry-project/.vscode/launch-composer/profiles/profile.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/rename-entry-project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(
    new TextDecoder().decode(profileBytes),
    '[\n  {\n    "name": "cpp-renamed"\n  }\n]\n',
  );
  assert.equal(
    new TextDecoder().decode(configBytes),
    '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "excluded": true,\n      "profile": "cpp-renamed"\n    }\n  ]\n}\n',
  );
});

test('renameEntry preserves profile and config comments while updating profile', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-rename-entry-project'),
  );
  const profileUri = vscode.Uri.file(
    '/workspace/comment-rename-entry-project/.vscode/launch-composer/profiles/profile.json',
  );
  const configUri = vscode.Uri.file(
    '/workspace/comment-rename-entry-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-rename-entry-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-rename-entry-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    profileUri,
    new TextEncoder().encode(
      '[\n' +
        '  {\n' +
        '    // keep profile name comment\n' +
        '    "name": "cpp",\n' +
        '    "configuration": {\n' +
        '      "type": "cppdbg",\n' +
        '      "request": "launch"\n' +
        '    }\n' +
        '  }\n' +
        ']\n',
    ),
  );
  await vscode.workspace.fs.writeFile(
    configUri,
    new TextEncoder().encode(
      '{\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      // keep profile comment\n' +
        '      "profile": "cpp"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.renameEntry(
    {
      kind: 'profile',
      file: 'profile.json',
      index: 0,
    },
    'cpp-renamed',
  );

  const profileText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(profileUri),
  );
  const configText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(configUri),
  );

  assert.match(profileText, /\/\/ keep profile name comment/);
  assert.match(configText, /\/\/ keep profile comment/);
  assert.match(profileText, /"name": "cpp-renamed"/);
  assert.match(configText, /"profile": "cpp-renamed"/);
});

test('patch entry updates preserve comments around edited fields', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-patch-project'),
  );
  const profileUri = vscode.Uri.file(
    '/workspace/comment-patch-project/.vscode/launch-composer/profiles/profile.json',
  );
  const configUri = vscode.Uri.file(
    '/workspace/comment-patch-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-patch-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-patch-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    profileUri,
    new TextEncoder().encode(
      '[\n' +
        '  {\n' +
        '    "name": "node",\n' +
        '    "configuration": {\n' +
        '      "type": "node",\n' +
        '      "request": "launch",\n' +
        '      // keep profile program comment\n' +
        '      "program": "${workspaceFolder}/old.js"\n' +
        '    }\n' +
        '  }\n' +
        ']\n',
    ),
  );
  await vscode.workspace.fs.writeFile(
    configUri,
    new TextEncoder().encode(
      '{\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch",\n' +
        '        // keep config cwd comment\n' +
        '        "cwd": "${workspaceFolder}"\n' +
        '      }\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  const profileRevision = await store.getDataFileRevision(
    'profile',
    'profile.json',
  );
  const configRevision = await store.getDataFileRevision(
    'config',
    'config.json',
  );

  await store.patchProfileEntry('profile.json', 0, profileRevision, [
    {
      type: 'set',
      path: ['configuration', 'program'],
      value: '${workspaceFolder}/server.js',
    },
  ]);
  await store.patchConfigEntry('config.json', 0, configRevision, [
    {
      type: 'set',
      path: ['configuration', 'cwd'],
      value: '${workspaceFolder}/dist',
    },
  ]);

  const profileText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(profileUri),
  );
  const configText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(configUri),
  );

  assert.match(profileText, /\/\/ keep profile program comment/);
  assert.match(configText, /\/\/ keep config cwd comment/);
  assert.match(profileText, /"program": "\$\{workspaceFolder\}\/server\.js"/);
  assert.match(configText, /"cwd": "\$\{workspaceFolder\}\/dist"/);
});

test('patchProfileEntry rejects name updates', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/patch-profile-name-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/patch-profile-name-project/.vscode/launch-composer/profiles/profile.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/patch-profile-name-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '[\n  {\n    "name": "cpp",\n    "type": "cppdbg",\n    "request": "launch"\n  }\n]\n',
    ),
  );

  const revision = await store.getDataFileRevision('profile', 'profile.json');

  await assert.rejects(
    async () =>
      store.patchProfileEntry('profile.json', 0, revision, [
        {
          type: 'set',
          path: ['name'],
          value: 'cpp-renamed',
        },
      ]),
    /Entry name changes must use the rename entry flow\./,
  );

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  assert.equal(
    new TextDecoder().decode(bytes),
    '[\n  {\n    "name": "cpp",\n    "type": "cppdbg",\n    "request": "launch"\n  }\n]\n',
  );
});

test('patchConfigEntry rejects name updates', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/patch-config-name-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/patch-config-name-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/patch-config-name-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "configuration": {\n        "type": "cppdbg",\n        "request": "launch"\n      }\n    }\n  ]\n}\n',
    ),
  );

  const revision = await store.getDataFileRevision('config', 'config.json');

  await assert.rejects(
    async () =>
      store.patchConfigEntry('config.json', 0, revision, [
        {
          type: 'set',
          path: ['name'],
          value: 'Launch Renamed',
        },
      ]),
    /Entry name changes must use the rename entry flow\./,
  );

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  assert.equal(
    new TextDecoder().decode(bytes),
    '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "configuration": {\n        "type": "cppdbg",\n        "request": "launch"\n      }\n    }\n  ]\n}\n',
  );
});
