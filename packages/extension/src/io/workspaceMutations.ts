import type {
  ConfigData,
  ConfigFileData,
  ProfileData,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import {
  appendJsonArrayValue,
  applyJsonDocumentPatches,
  createTextRevision,
  joinJsonPatchPath,
  type JsonObjectPatchOperation,
  stringifyJsonFile,
} from './json.js';
import type { DataFileIo } from './dataFileIo.js';
import {
  parseConfigDocument,
  parseProfileDocument,
  unwrapParsedDocument,
} from './dataFileParser.js';
import {
  COMPOSER_DIR,
  CONFIGS_DIR,
  normalizeFileName,
  PROFILES_DIR,
  type DataFileKind,
  type WorkspaceLayout,
} from './workspaceLayout.js';
import type { WorkspaceReader } from './workspaceReader.js';

const DEFAULT_PROFILE_FILE = 'profile.json';
const DEFAULT_CONFIG_FILE = 'config.json';
const DEFAULT_PROFILE_CONTENT =
  '// Add profile entries to this array.\n' +
  '// Each profile should have a unique "name".\n' +
  '[]\n';
const DEFAULT_CONFIG_CONTENT =
  '// Configure this file and add entries to "configurations".\n' +
  '// Set "profile" to reference a profile.\n' +
  '{\n' +
  '  "configurations": []\n' +
  '}\n';

export type EntryPatchResult =
  | {
      status: 'ok';
      revision: string | null;
    }
  | {
      status: 'conflict';
      revision: string | null;
    };

export class WorkspaceMutations {
  constructor(
    private readonly layout: WorkspaceLayout,
    private readonly io: DataFileIo,
    private readonly reader: WorkspaceReader,
  ) {}

  async ensureInitialized(): Promise<{
    ensuredDirectories: string[];
    ensuredFiles: string[];
  }> {
    const targets = [
      [COMPOSER_DIR, this.layout.getComposerDirUri()],
      [PROFILES_DIR, this.layout.getDataDirUri('profile')],
      [CONFIGS_DIR, this.layout.getDataDirUri('config')],
    ] as const;

    const ensuredDirectories: string[] = [];

    for (const [label, uri] of targets) {
      await this.io.createDirectory(uri);
      ensuredDirectories.push(label);
    }

    const ensuredFiles: string[] = [];
    if (
      await this.ensureDefaultDataFile(
        'profile',
        DEFAULT_PROFILE_FILE,
        DEFAULT_PROFILE_CONTENT,
      )
    ) {
      ensuredFiles.push(`${PROFILES_DIR}/${DEFAULT_PROFILE_FILE}`);
    }

    if (
      await this.ensureDefaultDataFile(
        'config',
        DEFAULT_CONFIG_FILE,
        DEFAULT_CONFIG_CONTENT,
      )
    ) {
      ensuredFiles.push(`${CONFIGS_DIR}/${DEFAULT_CONFIG_FILE}`);
    }

    return { ensuredDirectories, ensuredFiles };
  }

  async createDataFile(
    kind: DataFileKind,
    rawFileName: string,
  ): Promise<string> {
    await this.io.ensureDataDirectory(kind);

    const fileName = normalizeFileName(rawFileName);
    const uri = this.layout.getDataFileUri(kind, fileName);

    if (await this.io.hasDataFile(kind, fileName)) {
      throw new Error(`File already exists: ${fileName}`);
    }

    await this.io.writeTextFile(
      uri,
      kind === 'profile' ? '[]\n' : stringifyJsonFile(createEmptyConfigFile()),
    );
    return fileName;
  }

  async renameDataFile(
    kind: DataFileKind,
    file: string,
    rawFileName: string,
  ): Promise<string> {
    await this.io.ensureDataDirectory(kind);

    const currentFileName = normalizeFileName(file);
    const nextFileName = normalizeFileName(rawFileName);
    if (currentFileName === nextFileName) {
      return currentFileName;
    }

    if (await this.io.hasDataFile(kind, nextFileName)) {
      throw new Error(`File already exists: ${nextFileName}`);
    }

    const sourceUri = this.layout.getDataFileUri(kind, currentFileName);
    const destinationUri = this.layout.getDataFileUri(kind, nextFileName);
    const bytes = await vscode.workspace.fs.readFile(sourceUri);

    await vscode.workspace.fs.writeFile(destinationUri, bytes);
    await vscode.workspace.fs.delete(sourceUri);

    return nextFileName;
  }

  async deleteDataFile(kind: DataFileKind, file: string): Promise<void> {
    const uri = this.layout.getDataFileUri(kind, file);
    const edit = new vscode.WorkspaceEdit();
    edit.deleteFile(uri, {
      ignoreIfNotExists: true,
      recursive: false,
    });

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(`Failed to delete ${normalizeFileName(file)}.`);
    }
  }

  async addProfileEntry(file: string, name: string): Promise<EditorTarget> {
    await this.ensureArrayDataFile('profile', file);
    const text = await this.io.readRequiredDataFileText('profile', file);
    const entries = this.parseProfileEntries(file, text);
    const nextText = appendJsonArrayValue(text, [], {
      name,
      configuration: { type: '', request: 'launch' },
    });
    await this.io.writeDataFileText('profile', file, nextText);

    return {
      kind: 'profile',
      file,
      index: entries.length,
    };
  }

  async addConfigEntry(
    file: string,
    name: string,
    profileName: string,
  ): Promise<EditorTarget> {
    await this.ensureConfigDataFile(file);
    const text = await this.io.readRequiredDataFileText('config', file);
    const configFile = this.parseConfigFileContent(file, text);
    const data: ConfigData = { name, profile: profileName };

    const nextText = appendJsonArrayValue(text, ['configurations'], data);
    await this.io.writeDataFileText('config', file, nextText);

    return {
      kind: 'config',
      file,
      index: configFile.configurations.length,
    };
  }

  async patchArrayEntry(
    kind: DataFileKind,
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    if (patches.some((patch) => patch.path[0] === 'name')) {
      throw new Error('Entry name changes must use the rename entry flow.');
    }

    if (patches.length === 0) {
      const revision = await this.io.getDataFileRevision(kind, file);
      return {
        status: 'ok',
        revision,
      };
    }

    const uri = this.layout.getDataFileUri(kind, file);
    const result = await this.io.readTextFile(uri);
    if (result.status === 'missing') {
      throw new Error(`File not found: ${file}`);
    }

    const text = result.text;
    const currentRevision = createTextRevision(text);
    if (baseRevision !== currentRevision) {
      return {
        status: 'conflict',
        revision: currentRevision,
      };
    }

    const entries =
      kind === 'profile'
        ? this.parseProfileEntries(file, text)
        : this.parseConfigFileContent(file, text).configurations;

    assertIndex(entries, index, file);
    const entry = entries[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Entry index ${index} in ${file} must be a JSON object.`);
    }

    const entryPath = kind === 'profile' ? [index] : ['configurations', index];
    const nextText = applyJsonDocumentPatches(
      text,
      joinJsonPatchPath(entryPath, patches),
    );
    if (nextText === text) {
      return {
        status: 'ok',
        revision: currentRevision,
      };
    }

    await this.io.writeTextFile(uri, nextText);
    return {
      status: 'ok',
      revision: createTextRevision(nextText),
    };
  }

  async toggleConfigExcluded(file: string, index: number): Promise<void> {
    const text = await this.io.readRequiredDataFileText('config', file);
    const fileData = this.parseConfigFileContent(file, text);
    assertIndex(fileData.configurations, index, file);
    const current = fileData.configurations[index]!;
    const nextText = applyJsonDocumentPatches(
      text,
      current.excluded === true
        ? [
            {
              type: 'delete',
              path: ['configurations', index, 'excluded'],
            },
          ]
        : [
            {
              type: 'set',
              path: ['configurations', index, 'excluded'],
              value: true,
            },
          ],
    );
    await this.io.writeDataFileText('config', file, nextText);
  }

  async setConfigExcluded(
    file: string,
    index: number,
    excluded: boolean,
  ): Promise<void> {
    const text = await this.io.readRequiredDataFileText('config', file);
    const fileData = this.parseConfigFileContent(file, text);
    assertIndex(fileData.configurations, index, file);
    const current = fileData.configurations[index]!;
    if ((current.excluded === true) === excluded) {
      return;
    }

    const nextText = applyJsonDocumentPatches(
      text,
      excluded
        ? [
            {
              type: 'set',
              path: ['configurations', index, 'excluded'],
              value: true,
            },
          ]
        : [
            {
              type: 'delete',
              path: ['configurations', index, 'excluded'],
            },
          ],
    );
    await this.io.writeDataFileText('config', file, nextText);
  }

  async setConfigFileExcluded(file: string, excluded: boolean): Promise<void> {
    const text = await this.io.readRequiredDataFileText('config', file);
    const fileData = this.parseConfigFileContent(file, text);
    const patches: JsonObjectPatchOperation[] = [];

    fileData.configurations.forEach((config, index) => {
      if (excluded) {
        if (config.excluded !== true) {
          patches.push({
            type: 'set',
            path: ['configurations', index, 'excluded'],
            value: true,
          });
        }
        return;
      }

      if (Object.hasOwn(config, 'excluded')) {
        patches.push({
          type: 'delete',
          path: ['configurations', index, 'excluded'],
        });
      }
    });

    if (patches.length === 0) {
      return;
    }

    const nextText = applyJsonDocumentPatches(text, patches);
    await this.io.writeDataFileText('config', file, nextText);
  }

  async deleteEntry(target: EditorTarget): Promise<void> {
    if (target.kind === 'profile') {
      const text = await this.io.readRequiredDataFileText(
        'profile',
        target.file,
      );
      const profiles = this.parseProfileEntries(target.file, text);
      assertIndex(profiles, target.index, target.file);
      const profile = profiles[target.index]!;
      const references = await this.findConfigReferences(profile.name);

      if (references.length > 0) {
        throw new Error(
          `Cannot delete profile "${profile.name}" because it is referenced by: ${references.join(', ')}`,
        );
      }

      const nextText = applyJsonDocumentPatches(text, [
        {
          type: 'delete',
          path: [target.index],
        },
      ]);
      await this.io.writeDataFileText('profile', target.file, nextText);
      return;
    }

    const text = await this.io.readRequiredDataFileText('config', target.file);
    const fileData = this.parseConfigFileContent(target.file, text);
    assertIndex(fileData.configurations, target.index, target.file);
    const nextText = applyJsonDocumentPatches(text, [
      {
        type: 'delete',
        path: ['configurations', target.index],
      },
    ]);
    await this.io.writeDataFileText('config', target.file, nextText);
  }

  async renameEntry(target: EditorTarget, rawName: string): Promise<void> {
    const nextName = normalizeEntryName(rawName);
    await this.assertUniqueEntryName(nextName, target);

    if (target.kind === 'profile') {
      const text = await this.io.readRequiredDataFileText(
        'profile',
        target.file,
      );
      const profiles = this.parseProfileEntries(target.file, text);
      assertIndex(profiles, target.index, target.file);
      const current = profiles[target.index]!;
      if (current.name === nextName) {
        return;
      }

      const nextText = applyJsonDocumentPatches(text, [
        {
          type: 'set',
          path: [target.index, 'name'],
          value: nextName,
        },
      ]);
      await this.io.writeDataFileText('profile', target.file, nextText);
      await this.updateProfileReferences(current.name, nextName);
      return;
    }

    const text = await this.io.readRequiredDataFileText('config', target.file);
    const fileData = this.parseConfigFileContent(target.file, text);
    assertIndex(fileData.configurations, target.index, target.file);
    const current = fileData.configurations[target.index]!;
    if (current.name === nextName) {
      return;
    }

    const nextText = applyJsonDocumentPatches(text, [
      {
        type: 'set',
        path: ['configurations', target.index, 'name'],
        value: nextName,
      },
    ]);
    await this.io.writeDataFileText('config', target.file, nextText);
  }

  private parseProfileEntries(file: string, text: string): ProfileData[] {
    return unwrapParsedDocument(parseProfileDocument(file, text));
  }

  private parseConfigFileContent(
    file: string,
    text: string,
  ): Omit<ConfigFileData, 'file'> {
    return unwrapParsedDocument(parseConfigDocument(file, text));
  }

  private async findConfigReferences(profileName: string): Promise<string[]> {
    const configFiles = await this.reader.readConfigsWithIssues();
    const references: string[] = [];

    for (const fileData of configFiles.configs) {
      fileData.configurations.forEach((config) => {
        if (config.profile === profileName) {
          references.push(`${fileData.file}:${config.name}`);
        }
      });
    }

    return references;
  }

  private async assertUniqueEntryName(
    name: string,
    target: EditorTarget,
  ): Promise<void> {
    const { profiles, configs } = await this.reader.readAllData();

    for (const fileData of profiles) {
      fileData.profiles.forEach((entry, index) => {
        if (
          target.kind === 'profile' &&
          fileData.file === target.file &&
          index === target.index
        ) {
          return;
        }

        if (entry.name === name) {
          throw new Error(`Name "${name}" is already in use.`);
        }
      });
    }

    for (const fileData of configs) {
      fileData.configurations.forEach((entry, index) => {
        if (
          target.kind === 'config' &&
          fileData.file === target.file &&
          index === target.index
        ) {
          return;
        }

        if (entry.name === name) {
          throw new Error(`Name "${name}" is already in use.`);
        }
      });
    }
  }

  private async updateProfileReferences(
    currentName: string,
    nextName: string,
  ): Promise<void> {
    if (currentName === nextName) {
      return;
    }

    const configFiles = await this.reader.readConfigsWithIssues();

    await Promise.all(
      configFiles.configs.map(async (fileData) => {
        const patches = fileData.configurations.flatMap((config, index) =>
          config.profile === currentName
            ? ([
                {
                  type: 'set',
                  path: ['configurations', index, 'profile'],
                  value: nextName,
                },
              ] satisfies JsonObjectPatchOperation[])
            : [],
        );

        if (patches.length === 0) {
          return;
        }

        const text = await this.io.readRequiredDataFileText(
          'config',
          fileData.file,
        );
        const nextText = applyJsonDocumentPatches(text, patches);
        await this.io.writeDataFileText('config', fileData.file, nextText);
      }),
    );
  }

  private async ensureArrayDataFile(
    kind: DataFileKind,
    file: string,
  ): Promise<void> {
    await this.io.ensureDataDirectory(kind);

    const fileName = normalizeFileName(file);
    if (await this.io.hasDataFile(kind, fileName)) {
      return;
    }

    const uri = this.layout.getDataFileUri(kind, fileName);
    await this.io.writeTextFile(uri, '[]\n');
  }

  private async ensureConfigDataFile(file: string): Promise<void> {
    await this.io.ensureDataDirectory('config');

    const fileName = normalizeFileName(file);
    if (await this.io.hasDataFile('config', fileName)) {
      return;
    }

    const uri = this.layout.getDataFileUri('config', fileName);
    await this.io.writeTextFile(
      uri,
      stringifyJsonFile(createEmptyConfigFile()),
    );
  }

  private async ensureDefaultDataFile(
    kind: DataFileKind,
    file: string,
    content: string,
  ): Promise<boolean> {
    await this.io.ensureDataDirectory(kind);

    const fileName = normalizeFileName(file);
    if (await this.io.hasDataFile(kind, fileName)) {
      return false;
    }

    const uri = this.layout.getDataFileUri(kind, fileName);
    await this.io.writeTextFile(uri, content);
    return true;
  }
}

function normalizeEntryName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error('Name is required.');
  }

  return trimmed;
}

function assertIndex(entries: unknown[], index: number, file: string): void {
  if (index < 0 || index >= entries.length) {
    throw new Error(`Entry index ${index} is out of bounds for ${file}.`);
  }
}

function createEmptyConfigFile(): Omit<ConfigFileData, 'file'> {
  return {
    configurations: [],
  };
}
