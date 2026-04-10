import {
  generate,
  type ConfigData,
  type ConfigFileData,
  type GenerateResult,
  type TemplateData,
  type TemplateFileData,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import {
  applyArrayObjectPatch,
  createTextRevision,
  findArrayEntryOffset,
  parseJsonc,
  parseJsoncDocument,
  type JsonObjectPatchOperation,
  type JsonParseIssue,
  stringifyJsonFile,
} from './json.js';

const COMPOSER_DIR = '.vscode/launch-composer';
const TEMPLATES_DIR = `${COMPOSER_DIR}/templates`;
const CONFIGS_DIR = `${COMPOSER_DIR}/configs`;
const LAUNCH_FILE = '.vscode/launch.json';
const DEFAULT_TEMPLATE_FILE = 'template.json';
const DEFAULT_CONFIG_FILE = 'config.json';
const DEFAULT_TEMPLATE_CONTENT =
  '// Add template entries to this array.\n' +
  '// Each template should have a unique "name".\n' +
  '[]\n';
const DEFAULT_CONFIG_CONTENT =
  '// Configure this file and add entries to "configurations".\n' +
  '// Use "extends" to reference a template when needed.\n' +
  '{\n' +
  '  "enabled": true,\n' +
  '  "configurations": []\n' +
  '}\n';

export interface ComposerDataIssue {
  kind: 'template' | 'config';
  file: string;
  code: 'empty' | 'invalid-json' | 'invalid-shape';
  message: string;
  details?: string;
}

export interface WorkspaceDataSnapshot {
  templates: TemplateFileData[];
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
}

export interface TemplateWorkspaceData {
  templates: TemplateFileData[];
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

  getRelativeTemplatePattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${TEMPLATES_DIR}/**/*.json`,
    );
  }

  getRelativeConfigPattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${CONFIGS_DIR}/**/*.json`,
    );
  }

  async readAll(): Promise<WorkspaceDataSnapshot> {
    const [templatesResult, configsResult] = await Promise.all([
      this.readTemplatesWithIssues(),
      this.readConfigsWithIssues(),
    ]);

    return {
      templates: templatesResult.templates,
      configs: configsResult.configs,
      issues: [...templatesResult.issues, ...configsResult.issues],
    };
  }

  async readTemplatesWithIssues(): Promise<TemplateWorkspaceData> {
    const result = await this.readTemplateFiles();
    return {
      templates: result.data,
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

  async listTemplateNames(): Promise<string[]> {
    const data = await this.readTemplateFiles();
    return data.data.flatMap((fileData) =>
      fileData.templates.map((template) => template.name),
    );
  }

  async listFiles(kind: 'template' | 'config'): Promise<string[]> {
    const directory =
      kind === 'template' ? this.getTemplatesDirUri() : this.getConfigsDirUri();
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
      [TEMPLATES_DIR, this.getTemplatesDirUri()],
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
        'template',
        DEFAULT_TEMPLATE_FILE,
        DEFAULT_TEMPLATE_CONTENT,
      )
    ) {
      ensuredFiles.push(`${TEMPLATES_DIR}/${DEFAULT_TEMPLATE_FILE}`);
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
    kind: 'template' | 'config',
    rawFileName: string,
  ): Promise<string> {
    await this.ensureInitializedDirectory(kind);

    const fileName = normalizeFileName(rawFileName);
    const targetDir =
      kind === 'template' ? this.getTemplatesDirUri() : this.getConfigsDirUri();
    const uri = vscode.Uri.joinPath(targetDir, fileName);

    if (await this.hasDataFile(kind, fileName)) {
      throw new Error(`File already exists: ${fileName}`);
    }

    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(
        kind === 'template'
          ? '[]\n'
          : stringifyJsonFile(createEmptyConfigFile(fileName)),
      ),
    );
    return fileName;
  }

  getDataFilePath(kind: 'template' | 'config', file: string): string {
    return this.getDataFileUri(kind, file).fsPath;
  }

  getDataFileRelativePath(kind: 'template' | 'config', file: string): string {
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
    kind: 'template' | 'config',
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
    kind: 'template' | 'config',
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
    kind: 'template' | 'config',
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

  async addTemplateEntry(file: string, name: string): Promise<EditorTarget> {
    await this.ensureArrayDataFile('template', file);
    const fileData = await this.readTemplateFile(file);
    fileData.templates.push({
      name,
      configuration: { type: '', request: 'launch' },
    });
    await this.writeTemplateFile(fileData);

    return {
      kind: 'template',
      file,
      index: fileData.templates.length - 1,
    };
  }

  async addConfigEntry(
    file: string,
    name: string,
    extendsName: string | undefined,
  ): Promise<EditorTarget> {
    await this.ensureConfigDataFile(file);
    const fileData = await this.readConfigFile(file);
    const data: ConfigData =
      extendsName !== undefined
        ? { name, enabled: true, extends: extendsName }
        : {
            name,
            enabled: true,
            configuration: { type: '', request: 'launch' },
          };

    fileData.configurations.push(data);
    await this.writeConfigFile(fileData);

    return {
      kind: 'config',
      file,
      index: fileData.configurations.length - 1,
    };
  }

  async patchTemplateEntry(
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    return this.patchArrayEntry('template', file, index, baseRevision, patches);
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
    const fileData = await this.readConfigFile(file);
    assertIndex(fileData.configurations, index, file);
    const current = fileData.configurations[index]!;
    fileData.configurations[index] = {
      ...current,
      enabled: current.enabled === false,
    };
    await this.writeConfigFile(fileData);
  }

  async toggleConfigFileEnabled(file: string): Promise<void> {
    const fileData = await this.readConfigFile(file);
    fileData.enabled = fileData.enabled === false;
    await this.writeConfigFile(fileData);
  }

  async deleteEntry(target: EditorTarget): Promise<void> {
    if (target.kind === 'template') {
      const templateFile = await this.readTemplateFile(target.file);
      assertIndex(templateFile.templates, target.index, target.file);
      const template = templateFile.templates[target.index]!;
      const references = await this.findConfigReferences(template.name);

      if (references.length > 0) {
        throw new Error(
          `Cannot delete template "${template.name}" because it is referenced by: ${references.join(', ')}`,
        );
      }

      templateFile.templates.splice(target.index, 1);
      await this.writeTemplateFile(templateFile);
      return;
    }

    const configFile = await this.readConfigFile(target.file);
    assertIndex(configFile.configurations, target.index, target.file);
    configFile.configurations.splice(target.index, 1);
    await this.writeConfigFile(configFile);
  }

  async renameEntry(target: EditorTarget, rawName: string): Promise<void> {
    const nextName = normalizeEntryName(rawName);
    await this.assertUniqueEntryName(nextName, target);

    if (target.kind === 'template') {
      const templateFile = await this.readTemplateFile(target.file);
      assertIndex(templateFile.templates, target.index, target.file);
      const current = templateFile.templates[target.index]!;
      if (current.name === nextName) {
        return;
      }

      templateFile.templates[target.index] = {
        ...current,
        name: nextName,
      };
      await this.writeTemplateFile(templateFile);
      await this.updateTemplateReferences(current.name, nextName);
      return;
    }

    const configFile = await this.readConfigFile(target.file);
    assertIndex(configFile.configurations, target.index, target.file);
    const current = configFile.configurations[target.index]!;
    if (current.name === nextName) {
      return;
    }

    configFile.configurations[target.index] = {
      ...current,
      name: nextName,
    };
    await this.writeConfigFile(configFile);
  }

  async openDataFileAsJson(
    kind: 'template' | 'config',
    file: string,
  ): Promise<void> {
    const uri = this.getDataFileUri(kind, file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: false,
    });
  }

  getDataFileUriForTreeItem(
    kind: 'template' | 'config',
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
        target.kind === 'template'
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
    if (target.kind === 'template') {
      const result = await this.readTemplateFileResult(target.file);
      if (result.status !== 'ok') {
        return false;
      }

      return target.index >= 0 && target.index < result.data.templates.length;
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
      relativePath.startsWith(`${TEMPLATES_DIR}/`) ||
      relativePath.startsWith(`${CONFIGS_DIR}/`)
    );
  }

  async generateLaunchJson(): Promise<GenerateResult> {
    const { templates, configs, issues } = await this.readAll();
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
      templates,
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

  private async readTemplateFiles(): Promise<{
    data: TemplateFileData[];
    issues: ComposerDataIssue[];
  }> {
    const entries = await this.listFiles('template');
    return this.readExistingFiles(entries, (file) =>
      this.readTemplateFileResult(file),
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

  private async readTemplateFile(file: string): Promise<TemplateFileData> {
    const result = await this.readTemplateFileResult(file);
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

  private async readTemplateFileResult(
    file: string,
  ): Promise<
    | { status: 'ok'; data: TemplateFileData }
    | { status: 'missing' }
    | { status: 'invalid'; issue: ComposerDataIssue }
  > {
    const result = await this.readArrayFile<TemplateData>('template', file);
    if (result.status !== 'ok') {
      return result;
    }

    return {
      status: 'ok',
      data: { file, templates: result.data },
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

  private async readArrayFile<T>(
    kind: 'template' | 'config',
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

  private async patchArrayEntry(
    kind: 'template' | 'config',
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    if (patches.some((patch) => patch.key === 'name')) {
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

    const parsed = parseJsoncDocument<unknown>(text);
    if (parsed.issues.length > 0) {
      throw new Error(
        this.createParseIssue(kind, file, text, parsed.issues).message,
      );
    }

    const entryPath = kind === 'template' ? [index] : ['configurations', index];
    const entries =
      kind === 'template'
        ? Array.isArray(parsed.value)
          ? parsed.value
          : undefined
        : isRecord(parsed.value) && Array.isArray(parsed.value.configurations)
          ? parsed.value.configurations
          : undefined;
    if (entries === undefined) {
      throw new Error(
        kind === 'template'
          ? `${file} must contain a JSON array.`
          : `${file} must contain an object with a "configurations" array.`,
      );
    }

    assertIndex(entries, index, file);
    const entry = entries[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Entry index ${index} in ${file} must be a JSON object.`);
    }

    const nextText = applyArrayObjectPatch(text, entryPath, patches);
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

  private async writeTemplateFile(fileData: TemplateFileData): Promise<void> {
    await this.ensureInitializedDirectory('template');
    const uri = this.getDataFileUri('template', fileData.file);
    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(stringifyJsonFile(fileData.templates)),
    );
  }

  private async writeConfigFile(fileData: ConfigFileData): Promise<void> {
    await this.ensureInitializedDirectory('config');
    const uri = this.getDataFileUri('config', fileData.file);
    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(
        stringifyJsonFile({
          enabled: fileData.enabled ?? true,
          configurations: fileData.configurations,
        }),
      ),
    );
  }

  private async findConfigReferences(templateName: string): Promise<string[]> {
    const configFiles = await this.readConfigFiles();
    const references: string[] = [];

    for (const fileData of configFiles.data) {
      fileData.configurations.forEach((config) => {
        if (config.extends === templateName) {
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
    const { templates, configs } = await this.readAll();

    for (const fileData of templates) {
      fileData.templates.forEach((entry, index) => {
        if (
          target.kind === 'template' &&
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

  private async updateTemplateReferences(
    currentName: string,
    nextName: string,
  ): Promise<void> {
    if (currentName === nextName) {
      return;
    }

    const configFiles = await this.readConfigFiles();

    await Promise.all(
      configFiles.data.map(async (fileData) => {
        let changed = false;
        const nextConfigurations = fileData.configurations.map((config) => {
          if (config.extends !== currentName) {
            return config;
          }

          changed = true;
          return { ...config, extends: nextName };
        });

        if (!changed) {
          return;
        }

        await this.writeConfigFile({
          ...fileData,
          configurations: nextConfigurations,
        });
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

  private getTemplatesDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, TEMPLATES_DIR);
  }

  private getConfigsDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, CONFIGS_DIR);
  }

  private getLaunchJsonUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, LAUNCH_FILE);
  }

  private async ensureArrayDataFile(
    kind: 'template' | 'config',
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
      encodeText(stringifyJsonFile(createEmptyConfigFile(fileName))),
    );
  }

  private async ensureDefaultDataFile(
    kind: 'template' | 'config',
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
    kind: 'template' | 'config',
    file: string,
  ): Promise<boolean> {
    const fileName = normalizeFileName(file);
    const directory =
      kind === 'template' ? this.getTemplatesDirUri() : this.getConfigsDirUri();
    const entries = await this.readDirectory(directory);

    return entries.some(
      ([entryName, fileType]) =>
        entryName === fileName && fileType === vscode.FileType.File,
    );
  }

  private getDataFileUri(
    kind: 'template' | 'config',
    file: string,
  ): vscode.Uri {
    const fileName = normalizeFileName(file);
    return kind === 'template'
      ? vscode.Uri.joinPath(this.getTemplatesDirUri(), fileName)
      : vscode.Uri.joinPath(this.getConfigsDirUri(), fileName);
  }

  private async ensureInitializedDirectory(
    kind: 'template' | 'config',
  ): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.getComposerDirUri());
    await vscode.workspace.fs.createDirectory(
      kind === 'template' ? this.getTemplatesDirUri() : this.getConfigsDirUri(),
    );
  }

  private createParseIssue(
    kind: 'template' | 'config',
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
          kind === 'template'
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

function createEmptyConfigFile(file: string): ConfigFileData {
  return {
    file,
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
