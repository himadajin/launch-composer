import { vscode } from './vscode.js';
import type { HostMessage, WebviewMessage } from '../types.js';

export class RpcClient {
  private readonly pending = new Map<string, (message: HostMessage) => void>();

  post(message: WebviewMessage): void {
    vscode.postMessage(message);
  }

  sendRequest(
    message: Omit<WebviewMessage, 'requestId'>,
  ): Promise<HostMessage['payload']> {
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
