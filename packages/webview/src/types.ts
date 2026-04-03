export interface TemplateData {
  name: string;
  args?: string[];
  [key: string]: unknown;
}

export interface ConfigData {
  name: string;
  extends?: string;
  enabled?: boolean;
  argsFile?: string;
  args?: string[];
  [key: string]: unknown;
}

export interface TemplateFileData {
  file: string;
  templates: TemplateData[];
}

export interface ConfigFileData {
  file: string;
  configs: ConfigData[];
}

export interface ValidationError {
  file: string;
  configName?: string;
  field?: string;
  message: string;
}

export interface EditorTarget {
  kind: 'template' | 'config';
  file: string;
  index: number;
}

export interface InitialDataPayload {
  templates: TemplateFileData[];
  configs: ConfigFileData[];
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
  | { type: 'open-json'; payload: EditorTarget };

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
