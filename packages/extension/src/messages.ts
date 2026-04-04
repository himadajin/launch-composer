import type {
  ConfigData,
  ConfigFileData,
  TemplateData,
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
  autoSaveDelay: number;
}

export type WebviewMessage =
  | {
      type: 'update-template';
      payload: { file: string; index: number; data: TemplateData };
    }
  | {
      type: 'update-config';
      payload: { file: string; index: number; data: ConfigData };
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
  | { type: 'open-json'; payload: EditorTarget }
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
