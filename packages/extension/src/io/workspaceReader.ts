import type { ConfigFileData, ProfileFileData } from '@launch-composer/core';
import * as vscode from 'vscode';

import type { ComposerDataIssue, EditorTarget } from '../messages.js';
import type { DataFileIo } from './dataFileIo.js';
import { parseConfigDocument, parseProfileDocument } from './dataFileParser.js';
import type { DataFileKind, WorkspaceLayout } from './workspaceLayout.js';

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

type FileReadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'missing' }
  | { status: 'invalid'; issue: ComposerDataIssue };

export class WorkspaceReader {
  constructor(
    private readonly layout: WorkspaceLayout,
    private readonly io: DataFileIo,
  ) {}

  async readAllData(): Promise<WorkspaceDataWithoutReadiness> {
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
    const entries = await this.listFiles('profile');
    const result = await this.readExistingFiles(entries, (file) =>
      this.readProfileFileResult(file),
    );
    return {
      profiles: result.data,
      issues: result.issues,
    };
  }

  async readConfigsWithIssues(): Promise<ConfigWorkspaceData> {
    const entries = await this.listFiles('config');
    const result = await this.readExistingFiles(entries, (file) =>
      this.readConfigFileResult(file),
    );
    return {
      configs: result.data,
      issues: result.issues,
    };
  }

  async listProfileNames(): Promise<string[]> {
    const data = await this.readProfilesWithIssues();
    return data.profiles.flatMap((fileData) =>
      fileData.profiles.map((profile) => profile.name),
    );
  }

  /**
   * Resolves a profile name to its editor target: files are scanned in
   * ascending file-name order, entries in array order, and the first
   * exact name match wins. Invalid files are not scanned.
   */
  async findProfileTarget(name: string): Promise<EditorTarget | undefined> {
    const data = await this.readProfilesWithIssues();
    for (const fileData of data.profiles) {
      const index = fileData.profiles.findIndex(
        (profile) => profile.name === name,
      );
      if (index >= 0) {
        return { kind: 'profile', file: fileData.file, index };
      }
    }

    return undefined;
  }

  async listFiles(kind: DataFileKind): Promise<string[]> {
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

  private async readProfileFileResult(
    file: string,
  ): Promise<FileReadResult<ProfileFileData>> {
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
  ): Promise<FileReadResult<ConfigFileData>> {
    const result = await this.io.readTextFile(
      this.layout.getDataFileUri('config', file),
    );
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

  private async readExistingFiles<T>(
    files: string[],
    readFile: (file: string) => Promise<FileReadResult<T>>,
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
}
