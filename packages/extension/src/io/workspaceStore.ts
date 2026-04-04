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
import { findArrayEntryOffset, parseJsonc, stringifyJsonFile } from './json.js';

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
  '// Add config entries to this array.\n' +
  '// Use "extends" to reference a template when needed.\n' +
  '[]\n';

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

  async readAll(): Promise<{
    templates: TemplateFileData[];
    configs: ConfigFileData[];
  }> {
    const [templates, configs] = await Promise.all([
      this.readTemplateFiles(),
      this.readConfigFiles(),
    ]);

    return { templates, configs };
  }

  async listTemplateNames(): Promise<string[]> {
    const data = await this.readTemplateFiles();
    return data.flatMap((fileData) =>
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
    await this.ensureInitialized();

    const fileName = normalizeFileName(rawFileName);
    const targetDir =
      kind === 'template' ? this.getTemplatesDirUri() : this.getConfigsDirUri();
    const uri = vscode.Uri.joinPath(targetDir, fileName);

    if (await this.hasDataFile(kind, fileName)) {
      throw new Error(`File already exists: ${fileName}`);
    }

    await vscode.workspace.fs.writeFile(uri, encodeText('[]\n'));
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
      type: '',
      request: '',
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
    await this.ensureArrayDataFile('config', file);
    const fileData = await this.readConfigFile(file);
    const data: ConfigData = {
      name,
      enabled: true,
    };

    if (extendsName !== undefined) {
      data.extends = extendsName;
    } else {
      data.type = '';
      data.request = '';
    }

    fileData.configs.push(data);
    await this.writeConfigFile(fileData);

    return {
      kind: 'config',
      file,
      index: fileData.configs.length - 1,
    };
  }

  async updateTemplate(
    file: string,
    index: number,
    data: TemplateData,
  ): Promise<void> {
    const fileData = await this.readTemplateFile(file);
    assertIndex(fileData.templates, index, file);
    fileData.templates[index] = data;
    await this.writeTemplateFile(fileData);
  }

  async updateConfig(
    file: string,
    index: number,
    data: ConfigData,
  ): Promise<void> {
    const fileData = await this.readConfigFile(file);
    assertIndex(fileData.configs, index, file);
    fileData.configs[index] = data;
    await this.writeConfigFile(fileData);
  }

  async toggleConfigEnabled(file: string, index: number): Promise<void> {
    const fileData = await this.readConfigFile(file);
    assertIndex(fileData.configs, index, file);
    const current = fileData.configs[index]!;
    fileData.configs[index] = {
      ...current,
      enabled: current.enabled !== true,
    };
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
    assertIndex(configFile.configs, target.index, target.file);
    configFile.configs.splice(target.index, 1);
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
    assertIndex(configFile.configs, target.index, target.file);
    const current = configFile.configs[target.index]!;
    if (current.name === nextName) {
      return;
    }

    configFile.configs[target.index] = {
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
    const offset = findArrayEntryOffset(text, target.index) ?? 0;
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
    try {
      if (target.kind === 'template') {
        const fileData = await this.readTemplateFile(target.file);
        return target.index >= 0 && target.index < fileData.templates.length;
      }

      const fileData = await this.readConfigFile(target.file);
      return target.index >= 0 && target.index < fileData.configs.length;
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return false;
      }

      throw error;
    }
  }

  isComposerDataFile(uri: vscode.Uri): boolean {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return (
      relativePath.startsWith(`${TEMPLATES_DIR}/`) ||
      relativePath.startsWith(`${CONFIGS_DIR}/`)
    );
  }

  async generateLaunchJson(): Promise<GenerateResult> {
    const { templates, configs } = await this.readAll();

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

  private async readTemplateFiles(): Promise<TemplateFileData[]> {
    const entries = await this.listFiles('template');
    return this.readExistingFiles(entries, (file) =>
      this.readTemplateFile(file),
    );
  }

  private async readConfigFiles(): Promise<ConfigFileData[]> {
    const entries = await this.listFiles('config');
    return this.readExistingFiles(entries, (file) => this.readConfigFile(file));
  }

  private async readTemplateFile(file: string): Promise<TemplateFileData> {
    const data = await this.readArrayFile<TemplateData>(
      this.getDataFileUri('template', file),
      file,
    );
    return { file, templates: data };
  }

  private async readConfigFile(file: string): Promise<ConfigFileData> {
    const data = await this.readArrayFile<ConfigData>(
      this.getDataFileUri('config', file),
      file,
    );
    return { file, configs: data };
  }

  private async readArrayFile<T>(uri: vscode.Uri, label: string): Promise<T[]> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const value = parseJsonc<unknown>(decodeText(bytes), label);
    if (!Array.isArray(value)) {
      throw new Error(`${label} must contain a JSON array.`);
    }

    return value as T[];
  }

  private async writeTemplateFile(fileData: TemplateFileData): Promise<void> {
    await this.ensureInitialized();
    const uri = this.getDataFileUri('template', fileData.file);
    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(stringifyJsonFile(fileData.templates)),
    );
  }

  private async writeConfigFile(fileData: ConfigFileData): Promise<void> {
    await this.ensureInitialized();
    const uri = this.getDataFileUri('config', fileData.file);
    await vscode.workspace.fs.writeFile(
      uri,
      encodeText(stringifyJsonFile(fileData.configs)),
    );
  }

  private async findConfigReferences(templateName: string): Promise<string[]> {
    const configFiles = await this.readConfigFiles();
    const references: string[] = [];

    for (const fileData of configFiles) {
      fileData.configs.forEach((config) => {
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
    readFile: (file: string) => Promise<T>,
  ): Promise<T[]> {
    const results: T[] = [];

    for (const file of files) {
      try {
        results.push(await readFile(file));
      } catch (error) {
        if (isMissingFileSystemError(error)) {
          continue;
        }

        throw error;
      }
    }

    return results;
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
      fileData.configs.forEach((entry, index) => {
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
      configFiles.map(async (fileData) => {
        let changed = false;
        const nextConfigs = fileData.configs.map((config) => {
          if (config.extends !== currentName) {
            return config;
          }

          changed = true;
          return {
            ...config,
            extends: nextName,
          };
        });

        if (!changed) {
          return;
        }

        await this.writeConfigFile({
          ...fileData,
          configs: nextConfigs,
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
    await this.ensureInitialized();

    const fileName = normalizeFileName(file);
    if (await this.hasDataFile(kind, fileName)) {
      return;
    }

    const uri = this.getDataFileUri(kind, fileName);
    await vscode.workspace.fs.writeFile(uri, encodeText('[]\n'));
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
