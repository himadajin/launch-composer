import {
  generate,
  type ConfigData,
  type ConfigFileData,
  type GenerateResult,
  type ProfileData,
  type ProfileFileData,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import {
  appendJsonArrayValue,
  applyJsonDocumentPatches,
  createTextRevision,
  findArrayEntryOffset,
  joinJsonPatchPath,
  parseJsonc,
  parseJsoncDocument,
  type JsonObjectPatchOperation,
  type JsonParseIssue,
  stringifyJsonFile,
} from './json.js';

const COMPOSER_DIR = '.vscode/launch-composer';
const PROFILES_DIR = `${COMPOSER_DIR}/profiles`;
const CONFIGS_DIR = `${COMPOSER_DIR}/configs`;
const LAUNCH_FILE = '.vscode/launch.json';
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
  '  "enabled": true,\n' +
  '  "configurations": []\n' +
  '}\n';

export interface ComposerDataIssue {
  kind: 'profile' | 'config';
  file: string;
  code: 'empty' | 'invalid-json' | 'invalid-shape';
  message: string;
  details?: string;
}

export interface WorkspaceDataSnapshot {
  profiles: ProfileFileData[];
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
}

export interface ProfileWorkspaceData {
  profiles: ProfileFileData[];
  issues: ComposerDataIssue[];
}

export interface ConfigWorkspaceData {
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
}

type ArrayFileReadResult<T> =
  | { status: 'ok'; data: T[] }
  | { status: 'missing' }
  | { status: 'invalid'; issue: ComposerDataIssue };

type ConfigFileReadResult =
  | { status: 'ok'; data: ConfigFileData }
  | { status: 'missing' }
  | { status: 'invalid'; issue: ComposerDataIssue };

export type EntryPatchResult =
  | {
      status: 'ok';
      revision: string | null;
    }
  | {
      status: 'conflict';
      revision: string | null;
    };

export class WorkspaceStore {
  constructor(private readonly workspaceRoot: vscode.Uri) {}

  getWorkspaceRootPath(): string {
    return this.workspaceRoot.fsPath;
  }

  getRelativeComposerPattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${COMPOSER_DIR}/**/*.json`,
    );
  }

  getRelativeProfilePattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${PROFILES_DIR}/**/*.json`,
    );
  }

  getRelativeConfigPattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${CONFIGS_DIR}/**/*.json`,
    );
  }

  async readAll(): Promise<WorkspaceDataSnapshot> {
    const [profilesResult, configsResult] = await Promise.all([
      this.readProfilesWithIssues(),
      this.readConfigsWithIssues(),
    ]);

    return {
      profiles: profilesResult.profiles,
      configs: configsResult.configs,
      issues: [...profilesResult.issues, ...configsResult.issues],
    };
  }

  async readProfilesWithIssues(): Promise<ProfileWorkspaceData> {
    const result = await this.readProfileFiles();
    return {
      profiles: result.data,
      issues: result.issues,
    };
  }

  async readConfigsWithIssues(): Promise<ConfigWorkspaceData> {
    const result = await this.readConfigFiles();
    return {
      configs: result.data,
      issues: result.issues,
    };
  }

  async listProfileNames(): Promise<string[]> {
    const data = await this.readProfileFiles();
    return data.data.flatMap((fileData) =>
      fileData.profiles.map((profile) => profile.name),
    );
  }

  async listFiles(kind: 'profile' | 'config'): Promise<string[]> {
    const directory =
      kind === 'profile' ? this.getProfilesDirUri() : this.getConfigsDirUri();
    const entries = await this.readDirectory(directory);

    return entries
      .filter(
        ([name, fileType]) =>
          fileType === vscode.FileType.File && name.endsWith('.json'),
      )
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));
  }

  async ensureInitialized(): Promise<{
    ensuredDirectories: string[];
    ensuredFiles: string[];
  }> {
    const targets = [
      [COMPOSER_DIR, this.getComposerDirUri()],
      [PROFILES_DIR, this.getProfilesDirUri()],
      [CONFIGS_DIR, this.getConfigsDirUri()],
    ] as const;

    const ensuredDirectories: string[] = [];

    for (const [label, uri] of targets) {
      await vscode.workspace.fs.createDirectory(uri);
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
    kind: 'profile' | 'config',
    rawFileName: string,
  ): Promise<string> {
    await this.ensureInitializedDirectory(kind);

    const fileName = normalizeFileName(rawFileName);
    const targetDir =
      kind === 'profile' ? this.getProfilesDirUri() : this.getConfigsDirUri();
    const uri = vscode.Uri.joinPath(targetDir, fileName);

    if (await this.hasDataFile(kind, fileName)) {
      throw new Error(`File already exists: ${fileName}`);
    }

    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(
        kind === 'profile'
          ? '[]\n'
          : stringifyJsonFile(createEmptyConfigFile()),
      ),
    );
    return fileName;
  }

  getDataFilePath(kind: 'profile' | 'config', file: string): string {
    return this.getDataFileUri(kind, file).fsPath;
  }

  getDataFileRelativePath(kind: 'profile' | 'config', file: string): string {
    return vscode.workspace.asRelativePath(
      this.getDataFileUri(kind, file),
      false,
    );
  }

  getEntryFilePath(target: EditorTarget): string {
    return this.getDataFilePath(target.kind, target.file);
  }

  getEntryFileRelativePath(target: EditorTarget): string {
    return this.getDataFileRelativePath(target.kind, target.file);
  }

  async getDataFileRevision(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<string | null> {
    const uri = this.getDataFileUri(kind, file);
    let bytes: Uint8Array;

    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return null;
      }

      throw error;
    }

    return createTextRevision(decodeText(bytes));
  }

  async renameDataFile(
    kind: 'profile' | 'config',
    file: string,
    rawFileName: string,
  ): Promise<string> {
    await this.ensureInitializedDirectory(kind);

    const currentFileName = normalizeFileName(file);
    const nextFileName = normalizeFileName(rawFileName);
    if (currentFileName === nextFileName) {
      return currentFileName;
    }

    if (await this.hasDataFile(kind, nextFileName)) {
      throw new Error(`File already exists: ${nextFileName}`);
    }

    const sourceUri = this.getDataFileUri(kind, currentFileName);
    const destinationUri = this.getDataFileUri(kind, nextFileName);
    const bytes = await vscode.workspace.fs.readFile(sourceUri);

    await vscode.workspace.fs.writeFile(destinationUri, bytes);
    await vscode.workspace.fs.delete(sourceUri);

    return nextFileName;
  }

  async deleteDataFile(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<void> {
    const uri = this.getDataFileUri(kind, file);
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
    const text = await this.readRequiredDataFileText('profile', file);
    const entries = this.parseProfileEntries(file, text);
    const nextText = appendJsonArrayValue(text, [], {
      name,
      configuration: { type: '', request: 'launch' },
    });
    await this.writeDataFileText('profile', file, nextText);

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
    const text = await this.readRequiredDataFileText('config', file);
    const configFile = this.parseConfigFileContent(file, text);
    const data: ConfigData = { name, enabled: true, profile: profileName };

    const nextText = appendJsonArrayValue(text, ['configurations'], data);
    await this.writeDataFileText('config', file, nextText);

    return {
      kind: 'config',
      file,
      index: configFile.configurations.length,
    };
  }

  async patchProfileEntry(
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    return this.patchArrayEntry('profile', file, index, baseRevision, patches);
  }

  async patchConfigEntry(
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    return this.patchArrayEntry('config', file, index, baseRevision, patches);
  }

  async toggleConfigEnabled(file: string, index: number): Promise<void> {
    const text = await this.readRequiredDataFileText('config', file);
    const fileData = this.parseConfigFileContent(file, text);
    assertIndex(fileData.configurations, index, file);
    const current = fileData.configurations[index]!;
    const nextText = applyJsonDocumentPatches(text, [
      {
        type: 'set',
        path: ['configurations', index, 'enabled'],
        value: current.enabled === false,
      },
    ]);
    await this.writeDataFileText('config', file, nextText);
  }

  async toggleConfigFileEnabled(file: string): Promise<void> {
    const text = await this.readRequiredDataFileText('config', file);
    const fileData = this.parseConfigFileContent(file, text);
    const nextText = applyJsonDocumentPatches(text, [
      {
        type: 'set',
        path: ['enabled'],
        value: fileData.enabled === false,
      },
    ]);
    await this.writeDataFileText('config', file, nextText);
  }

  async deleteEntry(target: EditorTarget): Promise<void> {
    if (target.kind === 'profile') {
      const text = await this.readRequiredDataFileText('profile', target.file);
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
      await this.writeDataFileText('profile', target.file, nextText);
      return;
    }

    const text = await this.readRequiredDataFileText('config', target.file);
    const fileData = this.parseConfigFileContent(target.file, text);
    assertIndex(fileData.configurations, target.index, target.file);
    const nextText = applyJsonDocumentPatches(text, [
      {
        type: 'delete',
        path: ['configurations', target.index],
      },
    ]);
    await this.writeDataFileText('config', target.file, nextText);
  }

  async renameEntry(target: EditorTarget, rawName: string): Promise<void> {
    const nextName = normalizeEntryName(rawName);
    await this.assertUniqueEntryName(nextName, target);

    if (target.kind === 'profile') {
      const text = await this.readRequiredDataFileText('profile', target.file);
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
      await this.writeDataFileText('profile', target.file, nextText);
      await this.updateProfileReferences(current.name, nextName);
      return;
    }

    const text = await this.readRequiredDataFileText('config', target.file);
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
    await this.writeDataFileText('config', target.file, nextText);
  }

  async openDataFileAsJson(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<void> {
    const uri = this.getDataFileUri(kind, file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: false,
    });
  }

  getDataFileUriForTreeItem(
    kind: 'profile' | 'config',
    file: string,
  ): vscode.Uri {
    return this.getDataFileUri(kind, file);
  }

  async openEntryAsJson(target: EditorTarget): Promise<void> {
    const uri = this.getDataFileUri(target.kind, target.file);
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const offset =
      findArrayEntryOffset(
        text,
        target.kind === 'profile'
          ? [target.index]
          : ['configurations', target.index],
      ) ?? 0;
    const position = document.positionAt(offset);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
    editor.selection = new vscode.Selection(position, position);
  }

  async hasEntry(target: EditorTarget): Promise<boolean> {
    if (target.kind === 'profile') {
      const result = await this.readProfileFileResult(target.file);
      if (result.status !== 'ok') {
        return false;
      }

      return target.index >= 0 && target.index < result.data.profiles.length;
    }

    const result = await this.readConfigFileResult(target.file);
    if (result.status !== 'ok') {
      return false;
    }

    return (
      target.index >= 0 && target.index < result.data.configurations.length
    );
  }

  isComposerDataFile(uri: vscode.Uri): boolean {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return (
      relativePath.startsWith(`${PROFILES_DIR}/`) ||
      relativePath.startsWith(`${CONFIGS_DIR}/`)
    );
  }

  async generateLaunchJson(): Promise<GenerateResult> {
    const { profiles, configs, issues } = await this.readAll();
    if (issues.length > 0) {
      return {
        success: false,
        errors: issues.map((issue) => ({
          file: issue.file,
          message: issue.message,
        })),
      };
    }

    return generate({
      profiles,
      configs,
      variables: {
        workspaceFolder: this.workspaceRoot.fsPath,
      },
      readArgsFile: async (resolvedPath) => {
        try {
          const uri = vscode.Uri.file(resolvedPath);
          const bytes = await vscode.workspace.fs.readFile(uri);
          const value = parseJsonc<unknown>(decodeText(bytes), resolvedPath);
          return { kind: 'success' as const, data: value };
        } catch (error) {
          if (isMissingFileSystemError(error)) {
            return { kind: 'not-found' as const };
          }

          return {
            kind: 'error' as const,
            message:
              error instanceof Error
                ? error.message
                : 'Failed to read argsFile.',
          };
        }
      },
    });
  }

  async writeLaunchJson(
    result: Exclude<GenerateResult, { success: false }>,
  ): Promise<void> {
    const content =
      '// This file is auto-generated by Launch Composer.\n' +
      '// Do not edit manually. Changes will be overwritten.\n' +
      stringifyJsonFile(result.launchJson);

    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(this.workspaceRoot, '.vscode'),
    );
    await vscode.workspace.fs.writeFile(
      this.getLaunchJsonUri(),
      encodeText(content),
    );
  }

  async launchJsonExists(): Promise<boolean> {
    return this.exists(this.getLaunchJsonUri());
  }

  private async readProfileFiles(): Promise<{
    data: ProfileFileData[];
    issues: ComposerDataIssue[];
  }> {
    const entries = await this.listFiles('profile');
    return this.readExistingFiles(entries, (file) =>
      this.readProfileFileResult(file),
    );
  }

  private async readConfigFiles(): Promise<{
    data: ConfigFileData[];
    issues: ComposerDataIssue[];
  }> {
    const entries = await this.listFiles('config');
    return this.readExistingFiles(entries, (file) =>
      this.readConfigFileResult(file),
    );
  }

  private async readProfileFile(file: string): Promise<ProfileFileData> {
    const result = await this.readProfileFileResult(file);
    if (result.status === 'ok') {
      return result.data;
    }

    throw new Error(
      result.status === 'missing'
        ? `File not found: ${file}`
        : result.issue.message,
    );
  }

  private async readConfigFile(file: string): Promise<ConfigFileData> {
    const result = await this.readConfigFileResult(file);
    if (result.status === 'ok') {
      return result.data;
    }

    throw new Error(
      result.status === 'missing'
        ? `File not found: ${file}`
        : result.issue.message,
    );
  }

  private async readProfileFileResult(
    file: string,
  ): Promise<
    | { status: 'ok'; data: ProfileFileData }
    | { status: 'missing' }
    | { status: 'invalid'; issue: ComposerDataIssue }
  > {
    const result = await this.readArrayFile<ProfileData>('profile', file);
    if (result.status !== 'ok') {
      return result;
    }

    return {
      status: 'ok',
      data: { file, profiles: result.data },
    };
  }

  private async readConfigFileResult(
    file: string,
  ): Promise<ConfigFileReadResult> {
    const uri = this.getDataFileUri('config', file);
    let bytes: Uint8Array;

    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return { status: 'missing' };
      }

      throw error;
    }

    const text = decodeText(bytes);
    const parsed = parseJsoncDocument<unknown>(text);
    if (parsed.issues.length > 0) {
      return {
        status: 'invalid',
        issue: this.createParseIssue('config', file, text, parsed.issues),
      };
    }

    if (
      !isRecord(parsed.value) ||
      !Array.isArray(parsed.value.configurations)
    ) {
      return {
        status: 'invalid',
        issue: {
          kind: 'config',
          file,
          code: 'invalid-shape',
          message: `${file} must contain an object with a "configurations" array.`,
        },
      };
    }

    return {
      status: 'ok',
      data: {
        file,
        ...(Object.hasOwn(parsed.value, 'enabled')
          ? {
              enabled: parsed.value.enabled as boolean,
            }
          : {}),
        configurations: parsed.value.configurations as ConfigData[],
      },
    };
  }

  private parseProfileEntries(file: string, text: string): ProfileData[] {
    const parsed = parseJsoncDocument<unknown>(text);
    if (parsed.issues.length > 0) {
      throw new Error(
        this.createParseIssue('profile', file, text, parsed.issues).message,
      );
    }

    if (!Array.isArray(parsed.value)) {
      throw new Error(`${file} must contain a JSON array.`);
    }

    return parsed.value as ProfileData[];
  }

  private parseConfigFileContent(
    file: string,
    text: string,
  ): Omit<ConfigFileData, 'file'> {
    const parsed = parseJsoncDocument<unknown>(text);
    if (parsed.issues.length > 0) {
      throw new Error(
        this.createParseIssue('config', file, text, parsed.issues).message,
      );
    }

    if (
      !isRecord(parsed.value) ||
      !Array.isArray(parsed.value.configurations)
    ) {
      throw new Error(
        `${file} must contain an object with a "configurations" array.`,
      );
    }

    return {
      ...(Object.hasOwn(parsed.value, 'enabled')
        ? {
            enabled: parsed.value.enabled as boolean,
          }
        : {}),
      configurations: parsed.value.configurations as ConfigData[],
    };
  }

  private async readArrayFile<T>(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<ArrayFileReadResult<T>> {
    const uri = this.getDataFileUri(kind, file);
    let bytes: Uint8Array;

    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return { status: 'missing' };
      }

      throw error;
    }

    const text = decodeText(bytes);
    const parsed = parseJsoncDocument<unknown>(text);
    if (parsed.issues.length > 0) {
      return {
        status: 'invalid',
        issue: this.createParseIssue(kind, file, text, parsed.issues),
      };
    }

    if (!Array.isArray(parsed.value)) {
      return {
        status: 'invalid',
        issue: {
          kind,
          file,
          code: 'invalid-shape',
          message: `${file} must contain a JSON array.`,
        },
      };
    }

    return { status: 'ok', data: parsed.value as T[] };
  }

  private async readRequiredDataFileText(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<string> {
    const uri = this.getDataFileUri(kind, file);

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return decodeText(bytes);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        throw new Error(`File not found: ${file}`);
      }

      throw error;
    }
  }

  private async writeDataFileText(
    kind: 'profile' | 'config',
    file: string,
    text: string,
  ): Promise<void> {
    await this.ensureInitializedDirectory(kind);
    const uri = this.getDataFileUri(kind, file);
    await vscode.workspace.fs.writeFile(uri, encodeText(text));
  }

  private async patchArrayEntry(
    kind: 'profile' | 'config',
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    if (patches.some((patch) => patch.path[0] === 'name')) {
      throw new Error('Entry name changes must use the rename entry flow.');
    }

    if (patches.length === 0) {
      const revision = await this.getDataFileRevision(kind, file);
      return {
        status: 'ok',
        revision,
      };
    }

    const uri = this.getDataFileUri(kind, file);
    let bytes: Uint8Array;

    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        throw new Error(`File not found: ${file}`);
      }

      throw error;
    }

    const text = decodeText(bytes);
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

    await vscode.workspace.fs.writeFile(uri, encodeText(nextText));
    return {
      status: 'ok',
      revision: createTextRevision(nextText),
    };
  }

  private async findConfigReferences(profileName: string): Promise<string[]> {
    const configFiles = await this.readConfigFiles();
    const references: string[] = [];

    for (const fileData of configFiles.data) {
      fileData.configurations.forEach((config) => {
        if (config.profile === profileName) {
          references.push(`${fileData.file}:${config.name}`);
        }
      });
    }

    return references;
  }

  private async readDirectory(
    uri: vscode.Uri,
  ): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(uri);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async readExistingFiles<T>(
    files: string[],
    readFile: (
      file: string,
    ) => Promise<
      | { status: 'ok'; data: T }
      | { status: 'missing' }
      | { status: 'invalid'; issue: ComposerDataIssue }
    >,
  ): Promise<{ data: T[]; issues: ComposerDataIssue[] }> {
    const results: T[] = [];
    const issues: ComposerDataIssue[] = [];

    for (const file of files) {
      const result = await readFile(file);
      if (result.status === 'ok') {
        results.push(result.data);
        continue;
      }

      if (result.status === 'invalid') {
        issues.push(result.issue);
      }
    }

    return { data: results, issues };
  }

  private async assertUniqueEntryName(
    name: string,
    target: EditorTarget,
  ): Promise<void> {
    const { profiles, configs } = await this.readAll();

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

    const configFiles = await this.readConfigFiles();

    await Promise.all(
      configFiles.data.map(async (fileData) => {
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

        const text = await this.readRequiredDataFileText(
          'config',
          fileData.file,
        );
        const nextText = applyJsonDocumentPatches(text, patches);
        await this.writeDataFileText('config', fileData.file, nextText);
      }),
    );
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return false;
      }

      throw error;
    }
  }

  private getComposerDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, COMPOSER_DIR);
  }

  private getProfilesDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, PROFILES_DIR);
  }

  private getConfigsDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, CONFIGS_DIR);
  }

  private getLaunchJsonUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, LAUNCH_FILE);
  }

  private async ensureArrayDataFile(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<void> {
    await this.ensureInitializedDirectory(kind);

    const fileName = normalizeFileName(file);
    if (await this.hasDataFile(kind, fileName)) {
      return;
    }

    const uri = this.getDataFileUri(kind, fileName);
    await vscode.workspace.fs.writeFile(uri, encodeText('[]\n'));
  }

  private async ensureConfigDataFile(file: string): Promise<void> {
    await this.ensureInitializedDirectory('config');

    const fileName = normalizeFileName(file);
    if (await this.hasDataFile('config', fileName)) {
      return;
    }

    const uri = this.getDataFileUri('config', fileName);
    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(stringifyJsonFile(createEmptyConfigFile())),
    );
  }

  private async ensureDefaultDataFile(
    kind: 'profile' | 'config',
    file: string,
    content: string,
  ): Promise<boolean> {
    await this.ensureInitializedDirectory(kind);

    const fileName = normalizeFileName(file);
    if (await this.hasDataFile(kind, fileName)) {
      return false;
    }

    const uri = this.getDataFileUri(kind, fileName);
    await vscode.workspace.fs.writeFile(uri, encodeText(content));
    return true;
  }

  private async hasDataFile(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<boolean> {
    const fileName = normalizeFileName(file);
    const directory =
      kind === 'profile' ? this.getProfilesDirUri() : this.getConfigsDirUri();
    const entries = await this.readDirectory(directory);

    return entries.some(
      ([entryName, fileType]) =>
        entryName === fileName && fileType === vscode.FileType.File,
    );
  }

  private getDataFileUri(kind: 'profile' | 'config', file: string): vscode.Uri {
    const fileName = normalizeFileName(file);
    return kind === 'profile'
      ? vscode.Uri.joinPath(this.getProfilesDirUri(), fileName)
      : vscode.Uri.joinPath(this.getConfigsDirUri(), fileName);
  }

  private async ensureInitializedDirectory(
    kind: 'profile' | 'config',
  ): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.getComposerDirUri());
    await vscode.workspace.fs.createDirectory(
      kind === 'profile' ? this.getProfilesDirUri() : this.getConfigsDirUri(),
    );
  }

  private createParseIssue(
    kind: 'profile' | 'config',
    file: string,
    text: string,
    issues: JsonParseIssue[],
  ): ComposerDataIssue {
    if (text.trim() === '') {
      return {
        kind,
        file,
        code: 'empty',
        message:
          kind === 'profile'
            ? `${file} is empty. Expected a JSON array such as [].`
            : `${file} is empty. Expected an object with a "configurations" array.`,
      };
    }

    return {
      kind,
      file,
      code: 'invalid-json',
      message: `Invalid JSON in ${file}. Open the file and fix the syntax.`,
      details: issues
        .map((issue) => `${issue.code} at ${issue.offset}`)
        .join(', '),
    };
  }
}

function normalizeFileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error('File name is required.');
  }

  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
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

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createEmptyConfigFile(): Omit<ConfigFileData, 'file'> {
  return {
    enabled: true,
    configurations: [],
  };
}

function isMissingFileSystemError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: unknown; name?: unknown };
  return (
    (error instanceof vscode.FileSystemError &&
      /ENOENT|FileNotFound/i.test(error.message)) ||
    errorWithCode.code === 'ENOENT' ||
    (typeof errorWithCode.name === 'string' &&
      /FileNotFound/i.test(errorWithCode.name)) ||
    /ENOENT|FileNotFound/i.test(error.message)
  );
}
