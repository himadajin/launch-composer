import {
  startTransition,
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { mergeWorkspaceUpdatePayload } from '../components/generateReadiness.js';
import type { HostMessage, InitialDataPayload } from '../types.js';
import type { RpcClient } from '../utils/rpc.js';
import { vscode } from '../utils/vscode.js';

/**
 * Owns the editor payload state: hydration from persisted webview state,
 * the host message listener, payload persistence, and on-demand refresh.
 */
export function useComposerPayload(rpc: RpcClient): {
  payload: InitialDataPayload | null;
  setPayload: Dispatch<SetStateAction<InitialDataPayload | null>>;
  requestLatestPayload: () => Promise<void>;
} {
  const [payload, setPayload] = useState<InitialDataPayload | null>(() => {
    return vscode.getState<InitialDataPayload>() ?? null;
  });

  const requestLatestPayload = useCallback(async () => {
    const result = await rpc.sendRequest({ type: 'request-initial-data' });

    startTransition(() => {
      setPayload(result);
    });
  }, [rpc]);

  useEffect(() => {
    function onMessage(event: MessageEvent<HostMessage>) {
      if (rpc.handle(event.data)) {
        return;
      }

      const message = event.data;
      if (message.type === 'initial-data') {
        startTransition(() => {
          setPayload(message.payload);
        });
        return;
      }

      if (message.type !== 'workspace-update') {
        return;
      }

      startTransition(() => {
        setPayload((currentPayload) =>
          mergeWorkspaceUpdatePayload(currentPayload, message.payload),
        );
      });
    }

    window.addEventListener('message', onMessage as EventListener);
    void requestLatestPayload().catch(() => undefined);

    return () => {
      window.removeEventListener('message', onMessage as EventListener);
    };
  }, [rpc, requestLatestPayload]);

  useEffect(() => {
    if (payload !== null) {
      vscode.setState(payload);
    }
  }, [payload]);

  return { payload, setPayload, requestLatestPayload };
}
