import type { GenerateSuccess } from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import {
  LaunchJsonService,
  type WorkspaceDataSnapshot,
  type WorkspaceGenerateResult,
} from '../generate/launchJsonService.js';
import { JsonEditorOpener } from '../ui/jsonEditorOpener.js';
import type { JsonObjectPatchOperation } from './json.js';
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
export type {
  WorkspaceDataSnapshot,
  WorkspaceGenerateResult,
} from '../generate/launchJsonService.js';
export type { EntryPatchResult } from './workspaceMutations.js';
export type {
  ConfigWorkspaceData,
  ProfileWorkspaceData,
  WorkspaceDataWithoutReadiness,
} from './workspaceReader.js';

export class WorkspaceStore {
  private readonly layout: WorkspaceLayout;
  private readonly io: DataFileIo;
  private readonly reader: WorkspaceReader;
  private readonly mutations: WorkspaceMutations;
  private readonly launchJson: LaunchJsonService;
  private readonly jsonEditorOpener: JsonEditorOpener;

  constructor(workspaceRoot: vscode.Uri) {
    this.layout = new WorkspaceLayout(workspaceRoot);
    this.io = new DataFileIo(this.layout);
    this.reader = new WorkspaceReader(this.layout, this.io);
    this.mutations = new WorkspaceMutations(this.layout, this.io, this.reader);
    this.launchJson = new LaunchJsonService(this.layout, this.io, this.reader);
    this.jsonEditorOpener = new JsonEditorOpener(this.layout);
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
    return this.launchJson.withGenerateReadiness(
      await this.reader.readAllData(),
    );
  }

  async withGenerateReadiness(
    snapshot: WorkspaceDataWithoutReadiness,
  ): Promise<WorkspaceDataSnapshot> {
    return this.launchJson.withGenerateReadiness(snapshot);
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
    return this.jsonEditorOpener.openDataFileAsJson(kind, file);
  }

  getDataFileUriForTreeItem(
    kind: 'profile' | 'config',
    file: string,
  ): vscode.Uri {
    return this.layout.getDataFileUri(kind, file);
  }

  async openEntryAsJson(target: EditorTarget): Promise<void> {
    return this.jsonEditorOpener.openEntryAsJson(target);
  }

  async hasEntry(target: EditorTarget): Promise<boolean> {
    return this.reader.hasEntry(target);
  }

  async generateLaunchJson(): Promise<WorkspaceGenerateResult> {
    return this.launchJson.generateLaunchJson();
  }

  async writeLaunchJson(result: GenerateSuccess): Promise<void> {
    return this.launchJson.writeLaunchJson(result);
  }

  async launchJsonExists(): Promise<boolean> {
    return this.launchJson.launchJsonExists();
  }
}
