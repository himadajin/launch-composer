import type {
  ConfigFileData,
  TemplateFileData,
  ValidationError,
} from '@launch-composer/core';
import type { ComposerDataIssue } from './io/workspaceStore.js';

export interface EditorTarget {
  kind: 'template' | 'config';
  file: string;
  index: number;
}

export interface InitialDataPayload {
  templates: TemplateFileData[];
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
  editor: EditorTarget;
  editorRevision: string | null;
  autoSaveDelay: number;
}

export type EntryPatchOperation =
  | {
      type: 'set';
      key: string;
      value: unknown;
    }
  | {
      type: 'delete';
      key: string;
    };

export type WebviewMessage =
  | {
      type: 'update-template';
      requestId: string;
      payload: {
        file: string;
        index: number;
        baseRevision: string | null;
        patches: EntryPatchOperation[];
      };
    }
  | {
      type: 'update-config';
      requestId: string;
      payload: {
        file: string;
        index: number;
        baseRevision: string | null;
        patches: EntryPatchOperation[];
      };
    }
  | {
      type: 'rename-entry';
      requestId: string;
      payload: {
        kind: 'template' | 'config';
        file: string;
        index: number;
        name: string;
      };
    }
  | {
      type: 'delete-template';
      requestId: string;
      payload: { file: string; index: number };
    }
  | {
      type: 'delete-config';
      requestId: string;
      payload: { file: string; index: number };
    }
  | { type: 'request-initial-data'; requestId: string }
  | { type: 'generate'; requestId: string }
  | { type: 'browse-file'; requestId: string }
  | {
      type: 'open-file-json';
      payload: { kind: 'template' | 'config'; file: string };
    };

export type HostMessage =
  | {
      type: 'initial-data';
      requestId: string;
      payload: InitialDataPayload;
    }
  | {
      type: 'update-result';
      requestId: string;
      payload: {
        success: boolean;
        conflict?: boolean;
        revision?: string | null;
        error?: string;
      };
    }
  | {
      type: 'rename-result';
      requestId: string;
      payload: {
        success: boolean;
        error?: string;
      };
    }
  | {
      type: 'delete-result';
      requestId: string;
      payload: { success: boolean; error?: string };
    }
  | {
      type: 'generate-result';
      requestId: string;
      payload: { success: boolean; errors?: ValidationError[] };
    }
  | {
      type: 'file-selected';
      requestId: string;
      payload: { path: string | null };
    };
