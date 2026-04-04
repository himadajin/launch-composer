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
    ensured: string[];
  }> {
    const targets = [
      [COMPOSER_DIR, this.getComposerDirUri()],
      [TEMPLATES_DIR, this.getTemplatesDirUri()],
      [CONFIGS_DIR, this.getConfigsDirUri()],
    ] as const;

    const ensured: string[] = [];

    for (const [label, uri] of targets) {
      await vscode.workspace.fs.createDirectory(uri);
      ensured.push(label);
    }

    return { ensured };
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

  async deleteDataFile(
    kind: 'template' | 'config',
    file: string,
  ): Promise<void> {
    const uri = this.getDataFileUri(kind, file);
    await vscode.workspace.fs.delete(uri);
  }

  async addTemplateEntry(file: string, name: string): Promise<EditorTarget> {
    await this.ensureArrayDataFile('template', file);
    const fileData = await this.readTemplateFile(file);
    fileData.templates.push({ name });
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
      enabled: false,
    };

    if (extendsName !== undefined) {
      data.extends = extendsName;
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
    return this.readExistingFiles(entries, (file) => this.readTemplateFile(file));
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
}

function normalizeFileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error('File name is required.');
  }

  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
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
