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
  findArrayEntryOffset,
  parseJsonc,
  type JsonObjectPatchOperation,
  stringifyJsonFile,
} from './json.js';
import { DataFileIo } from './dataFileIo.js';
import { WorkspaceLayout } from './workspaceLayout.js';
import {
  WorkspaceMutations,
  type EntryPatchResult,
} from './workspaceMutations.js';
import {
  WorkspaceReader,
  type ConfigWorkspaceData,
  type ProfileWorkspaceData,
  type WorkspaceDataWithoutReadiness,
} from './workspaceReader.js';

export type { ComposerDataIssue } from '../messages.js';
export type { EntryPatchResult } from './workspaceMutations.js';
export type {
  ConfigWorkspaceData,
  ProfileWorkspaceData,
  WorkspaceDataWithoutReadiness,
} from './workspaceReader.js';

export interface WorkspaceDataSnapshot {
  profiles: ProfileFileData[];
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
  generateReadiness: GenerateReadiness;
}

export type WorkspaceGenerateResult =
  | GenerateSuccess
  | {
      success: false;
      issueCount: number;
    };

export class WorkspaceStore {
  private readonly layout: WorkspaceLayout;
  private readonly io: DataFileIo;
  private readonly reader: WorkspaceReader;
  private readonly mutations: WorkspaceMutations;

  constructor(workspaceRoot: vscode.Uri) {
    this.layout = new WorkspaceLayout(workspaceRoot);
    this.io = new DataFileIo(this.layout);
    this.reader = new WorkspaceReader(this.layout, this.io);
    this.mutations = new WorkspaceMutations(this.layout, this.io, this.reader);
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
    return this.withGenerateReadiness(await this.reader.readAllData());
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
    return this.reader.readProfilesWithIssues();
  }

  async readConfigsWithIssues(): Promise<ConfigWorkspaceData> {
    return this.reader.readConfigsWithIssues();
  }

  async listProfileNames(): Promise<string[]> {
    return this.reader.listProfileNames();
  }

  async listFiles(kind: 'profile' | 'config'): Promise<string[]> {
    return this.reader.listFiles(kind);
  }

  async ensureInitialized(): Promise<{
    ensuredDirectories: string[];
    ensuredFiles: string[];
  }> {
    return this.mutations.ensureInitialized();
  }

  async createDataFile(
    kind: 'profile' | 'config',
    rawFileName: string,
  ): Promise<string> {
    return this.mutations.createDataFile(kind, rawFileName);
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
    return this.mutations.renameDataFile(kind, file, rawFileName);
  }

  async deleteDataFile(
    kind: 'profile' | 'config',
    file: string,
  ): Promise<void> {
    return this.mutations.deleteDataFile(kind, file);
  }

  async addProfileEntry(file: string, name: string): Promise<EditorTarget> {
    return this.mutations.addProfileEntry(file, name);
  }

  async addConfigEntry(
    file: string,
    name: string,
    profileName: string,
  ): Promise<EditorTarget> {
    return this.mutations.addConfigEntry(file, name, profileName);
  }

  async patchProfileEntry(
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    return this.mutations.patchArrayEntry(
      'profile',
      file,
      index,
      baseRevision,
      patches,
    );
  }

  async patchConfigEntry(
    file: string,
    index: number,
    baseRevision: string | null,
    patches: JsonObjectPatchOperation[],
  ): Promise<EntryPatchResult> {
    return this.mutations.patchArrayEntry(
      'config',
      file,
      index,
      baseRevision,
      patches,
    );
  }

  async toggleConfigExcluded(file: string, index: number): Promise<void> {
    return this.mutations.toggleConfigExcluded(file, index);
  }

  async setConfigExcluded(
    file: string,
    index: number,
    excluded: boolean,
  ): Promise<void> {
    return this.mutations.setConfigExcluded(file, index, excluded);
  }

  async setConfigFileExcluded(file: string, excluded: boolean): Promise<void> {
    return this.mutations.setConfigFileExcluded(file, excluded);
  }

  async deleteEntry(target: EditorTarget): Promise<void> {
    return this.mutations.deleteEntry(target);
  }

  async renameEntry(target: EditorTarget, rawName: string): Promise<void> {
    return this.mutations.renameEntry(target, rawName);
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
    return this.reader.hasEntry(target);
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
