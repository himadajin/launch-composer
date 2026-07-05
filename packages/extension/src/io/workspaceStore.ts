import {
  generate,
  validateGenerateInput,
  type ArgsFileLoadResult,
  type ConfigData,
  type ConfigFileData,
  type GenerateInput,
  type GenerateSuccess,
  type ProfileData,
  type ProfileFileData,
  type ValidationError,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type {
  ComposerDataIssue,
  EditorTarget,
  GenerateDiagnostic,
  GenerateReadiness,
} from '../messages.js';
import {
  appendJsonArrayValue,
  applyJsonDocumentPatches,
  createTextRevision,
  findArrayEntryOffset,
  joinJsonPatchPath,
  parseJsonc,
  type JsonObjectPatchOperation,
  stringifyJsonFile,
} from './json.js';
import { DataFileIo } from './dataFileIo.js';
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
  WorkspaceLayout,
} from './workspaceLayout.js';

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

export type { ComposerDataIssue } from '../messages.js';

export interface WorkspaceDataSnapshot {
  profiles: ProfileFileData[];
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
  generateReadiness: GenerateReadiness;
}

export interface WorkspaceDataWithoutReadiness {
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

export type WorkspaceGenerateResult =
  | GenerateSuccess
  | {
      success: false;
      issueCount: number;
    };

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
  private readonly layout: WorkspaceLayout;
  private readonly io: DataFileIo;

  constructor(workspaceRoot: vscode.Uri) {
    this.layout = new WorkspaceLayout(workspaceRoot);
    this.io = new DataFileIo(this.layout);
  }

  getWorkspaceRootPath(): string {
    return this.layout.getWorkspaceRootPath();
  }

  getRelativeProfilePattern(): vscode.RelativePattern {
    return this.layout.getRelativeProfilePattern();
  }

  getRelativeConfigPattern(): vscode.RelativePattern {
    return this.layout.getRelativeConfigPattern();
  }

  async readAll(): Promise<WorkspaceDataSnapshot> {
    const [profilesResult, configsResult] = await Promise.all([
      this.readProfilesWithIssues(),
      this.readConfigsWithIssues(),
    ]);

    return this.withGenerateReadiness({
      profiles: profilesResult.profiles,
      configs: configsResult.configs,
      issues: [...profilesResult.issues, ...configsResult.issues],
    });
  }

  async withGenerateReadiness(
    snapshot: WorkspaceDataWithoutReadiness,
  ): Promise<WorkspaceDataSnapshot> {
    return {
      ...snapshot,
      generateReadiness: await this.getGenerateReadiness(snapshot),
    };
  }

  private async getGenerateReadiness(
    snapshot: WorkspaceDataWithoutReadiness,
  ): Promise<GenerateReadiness> {
    if (snapshot.issues.length > 0) {
      return {
        diagnostics: snapshot.issues.map((issue) =>
          this.createInvalidFileDiagnostic(issue),
        ),
      };
    }

    const errors = await validateGenerateInput(
      this.createGenerateInput(snapshot),
    );

    return {
      diagnostics: errors.map((error) =>
        this.createCoreValidationDiagnostic(error, snapshot),
      ),
    };
  }

  private createInvalidFileDiagnostic(
    issue: ComposerDataIssue,
  ): GenerateDiagnostic {
    return {
      source: 'invalid-file',
      file: issue.file,
      message: issue.message,
      target: { kind: 'file' },
    };
  }

  private createCoreValidationDiagnostic(
    error: ValidationError,
    snapshot: WorkspaceDataWithoutReadiness,
  ): GenerateDiagnostic {
    if (error.target.kind === 'profile') {
      const profile = findProfileEntry(
        snapshot.profiles,
        error.file,
        error.target.index,
      );
      const target: GenerateDiagnostic['target'] = {
        kind: 'profile',
      };
      if (error.target.index !== undefined) {
        target.index = error.target.index;
      }
      if (profile?.name !== undefined) {
        target.name = profile.name;
      }
      if (error.field !== undefined) {
        target.field = error.field;
      }
      return {
        source: 'core-validation',
        file: error.file,
        message: error.message,
        target,
      };
    }

    if (error.target.kind === 'config') {
      const config = findConfigEntry(
        snapshot.configs,
        error.file,
        error.target.index,
      );
      const target: GenerateDiagnostic['target'] = {
        kind: 'config',
      };
      if (error.target.index !== undefined) {
        target.index = error.target.index;
      }
      const name = config?.data.name ?? error.configName;
      if (name !== undefined) {
        target.name = name;
      }
      if (error.field !== undefined) {
        target.field = error.field;
      }
      return {
        source: 'core-validation',
        file: error.file,
        message: error.message,
        target,
      };
    }

    const target: GenerateDiagnostic['target'] = {
      kind: 'file',
    };
    if (error.field !== undefined) {
      target.field = error.field;
    }

    return {
      source: 'core-validation',
      file: error.file,
      message: error.message,
      target,
    };
  }

  private createGenerateInput(
    snapshot: Pick<WorkspaceDataSnapshot, 'profiles' | 'configs'>,
  ): GenerateInput {
    return {
      profiles: snapshot.profiles,
      configs: snapshot.configs,
      variables: {
        workspaceFolder: this.layout.getWorkspaceRootPath(),
      },
      readArgsFile: (resolvedPath) => this.readArgsFile(resolvedPath),
    };
  }

  private async readArgsFile(
    resolvedPath: string,
  ): Promise<ArgsFileLoadResult> {
    try {
      const result = await this.io.readTextFile(vscode.Uri.file(resolvedPath));
      if (result.status === 'missing') {
        return { kind: 'not-found' };
      }

      const value = parseJsonc<unknown>(result.text, resolvedPath);
      return { kind: 'success', data: value };
    } catch (error) {
      return {
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to read argsFile.',
      };
    }
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
    const entries = await this.io.readDirectory(
      this.layout.getDataDirUri(kind),
    );

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
    kind: 'profile' | 'config',
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

  getDataFilePath(kind: 'profile' | 'config', file: string): string {
    return this.layout.getDataFilePath(kind, file);
  }

  getDataFileRelativePath(kind: 'profile' | 'config', file: string): string {
    return this.layout.getDataFileRelativePath(kind, file);
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
    return this.io.getDataFileRevision(kind, file);
  }

  async renameDataFile(
    kind: 'profile' | 'config',
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

  async deleteDataFile(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<void> {
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

  async openDataFileAsJson(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<void> {
    const uri = this.layout.getDataFileUri(kind, file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: false,
    });
  }

  getDataFileUriForTreeItem(
    kind: 'profile' | 'config',
    file: string,
  ): vscode.Uri {
    return this.layout.getDataFileUri(kind, file);
  }

  async openEntryAsJson(target: EditorTarget): Promise<void> {
    const uri = this.layout.getDataFileUri(target.kind, target.file);
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

  async generateLaunchJson(): Promise<WorkspaceGenerateResult> {
    const snapshot = await this.readAll();
    const readiness = snapshot.generateReadiness;
    if (readiness.diagnostics.length > 0) {
      return {
        success: false,
        issueCount: readiness.diagnostics.length,
      };
    }

    const result = await generate(this.createGenerateInput(snapshot));
    if (!result.success) {
      return {
        success: false,
        issueCount: result.errors.length,
      };
    }

    return result;
  }

  async writeLaunchJson(result: GenerateSuccess): Promise<void> {
    const content =
      '// This file is auto-generated by Launch Composer.\n' +
      '// Do not edit manually. Changes will be overwritten.\n' +
      stringifyJsonFile(result.launchJson);

    await this.io.createDirectory(
      vscode.Uri.joinPath(this.layout.workspaceRoot, '.vscode'),
    );
    await this.io.writeTextFile(this.layout.getLaunchJsonUri(), content);
  }

  async launchJsonExists(): Promise<boolean> {
    return this.io.exists(this.layout.getLaunchJsonUri());
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

  private async readProfileFileResult(
    file: string,
  ): Promise<
    | { status: 'ok'; data: ProfileFileData }
    | { status: 'missing' }
    | { status: 'invalid'; issue: ComposerDataIssue }
  > {
    const result = await this.io.readTextFile(
      this.layout.getDataFileUri('profile', file),
    );
    if (result.status === 'missing') {
      return { status: 'missing' };
    }

    const parsed = parseProfileDocument(file, result.text);
    if (parsed.status === 'invalid') {
      return parsed;
    }

    return {
      status: 'ok',
      data: { file, profiles: parsed.data },
    };
  }

  private async readConfigFileResult(
    file: string,
  ): Promise<ConfigFileReadResult> {
    const uri = this.layout.getDataFileUri('config', file);
    const result = await this.io.readTextFile(uri);
    if (result.status === 'missing') {
      return { status: 'missing' };
    }

    const parsed = parseConfigDocument(file, result.text);
    if (parsed.status === 'invalid') {
      return parsed;
    }

    return {
      status: 'ok',
      data: {
        file,
        configurations: parsed.data.configurations,
      },
    };
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
    kind: 'profile' | 'config',
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
    kind: 'profile' | 'config',
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

  private async hasDataFile(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<boolean> {
    const fileName = normalizeFileName(file);
    const entries = await this.io.readDirectory(
      this.layout.getDataDirUri(kind),
    );

    return entries.some(
      ([entryName, fileType]) =>
        entryName === fileName && fileType === vscode.FileType.File,
    );
  }

  private async ensureInitializedDirectory(
    kind: 'profile' | 'config',
  ): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.layout.getComposerDirUri());
    await vscode.workspace.fs.createDirectory(this.layout.getDataDirUri(kind));
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

function findProfileEntry(
  files: ProfileFileData[],
  file: string,
  index: number | undefined,
): ProfileData | undefined {
  if (index === undefined) {
    return undefined;
  }

  return files.find((fileData) => fileData.file === file)?.profiles[index];
}

function findConfigEntry(
  files: ConfigFileData[],
  file: string,
  index: number | undefined,
): { index: number; data: ConfigData } | undefined {
  if (index === undefined) {
    return undefined;
  }

  const data = files.find((fileData) => fileData.file === file)?.configurations[
    index
  ];
  return data === undefined ? undefined : { index, data };
}

function createEmptyConfigFile(): Omit<ConfigFileData, 'file'> {
  return {
    configurations: [],
  };
}
