import { vscode } from './vscode.js';
import type { HostMessage, WebviewMessage } from '../types.js';

type RequestMessage = Extract<WebviewMessage, { requestId: string }>;
type RequestType = RequestMessage['type'];
type WithoutRequestId<T> = T extends { requestId: string }
  ? Omit<T, 'requestId'>
  : never;
type RequestPayloadMessage = {
  [Type in RequestType]: WithoutRequestId<
    Extract<RequestMessage, { type: Type }>
  >;
}[RequestType];

type ResponseTypeByRequest = {
  'update-profile': 'update-result';
  'update-config': 'update-result';
  'rename-entry': 'rename-result';
  'delete-profile': 'delete-result';
  'delete-config': 'delete-result';
  'request-initial-data': 'initial-data';
  generate: 'generate-result';
  'browse-file': 'file-selected';
  'open-profile': 'open-profile-result';
};

type ResponsePayloadByRequest = {
  [Type in RequestType]: Extract<
    HostMessage,
    { type: ResponseTypeByRequest[Type] }
  >['payload'];
};

type ResponsePayloadFor<T extends RequestType> = ResponsePayloadByRequest[T];

interface RpcTransport {
  postMessage(message: WebviewMessage): void;
}

interface PendingRequest {
  expectedResponseType: HostMessage['type'];
  timeout: ReturnType<typeof setTimeout>;
  resolve(payload: unknown): void;
  reject(error: Error): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const RESPONSE_TYPE_BY_REQUEST: ResponseTypeByRequest = {
  'update-profile': 'update-result',
  'update-config': 'update-result',
  'rename-entry': 'rename-result',
  'delete-profile': 'delete-result',
  'delete-config': 'delete-result',
  'request-initial-data': 'initial-data',
  generate: 'generate-result',
  'browse-file': 'file-selected',
  'open-profile': 'open-profile-result',
};

export class RpcClient {
  private readonly pending = new Map<string, PendingRequest>();

  private readonly timeoutMs: number;

  private readonly transport: RpcTransport;

  constructor({
    timeoutMs = DEFAULT_TIMEOUT_MS,
    transport = vscode,
  }: {
    timeoutMs?: number;
    transport?: RpcTransport;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.transport = transport;
  }

  post(message: WebviewMessage): void {
    this.transport.postMessage(message);
  }

  sendRequest<T extends RequestPayloadMessage>(
    message: T,
  ): Promise<ResponsePayloadFor<T['type']>> {
    const requestId = crypto.randomUUID();
    const expectedResponseType = RESPONSE_TYPE_BY_REQUEST[message.type];

    return new Promise<ResponsePayloadFor<T['type']>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(`Timed out waiting for ${expectedResponseType} response.`),
        );
      }, this.timeoutMs);

      this.pending.set(requestId, {
        expectedResponseType,
        timeout,
        resolve(payload) {
          resolve(payload as ResponsePayloadFor<T['type']>);
        },
        reject,
      });

      this.post({
        ...message,
        requestId,
      } as RequestMessage);
    });
  }

  handle(message: HostMessage): boolean {
    const pending = this.pending.get(message.requestId);
    if (pending === undefined) {
      return false;
    }

    this.pending.delete(message.requestId);
    clearTimeout(pending.timeout);

    if (message.type !== pending.expectedResponseType) {
      pending.reject(
        new Error(
          `Unexpected response type ${message.type} for request ${message.requestId}.`,
        ),
      );
      return true;
    }

    pending.resolve(message.payload);
    return true;
  }
}
