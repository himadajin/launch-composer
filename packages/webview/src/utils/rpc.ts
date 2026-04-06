import { vscode } from './vscode.js';
import type { HostMessage, WebviewMessage } from '../types.js';

type RequestMessage = Extract<WebviewMessage, { requestId: string }>;
type WithoutRequestId<T> = T extends { requestId: string }
  ? Omit<T, 'requestId'>
  : never;
type RequestPayloadMessage = WithoutRequestId<RequestMessage>;

export class RpcClient {
  private readonly pending = new Map<string, (message: HostMessage) => void>();

  post(message: WebviewMessage): void {
    vscode.postMessage(message);
  }

  sendRequest(message: RequestPayloadMessage): Promise<HostMessage['payload']> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve) => {
      this.pending.set(requestId, (response) => {
        resolve(response.payload);
      });

      this.post({
        ...message,
        requestId,
      } as WebviewMessage);
    });
  }

  handle(message: HostMessage): boolean {
    const resolver = this.pending.get(message.requestId);
    if (resolver === undefined) {
      return false;
    }

    this.pending.delete(message.requestId);
    resolver(message);
    return true;
  }
}
