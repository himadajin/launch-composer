import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type { EntryPatchOperation, InitialDataPayload } from '../types.js';
import type { RpcClient } from '../utils/rpc.js';

/**
 * Serializes entry updates against the host and tracks the editor file
 * revision for optimistic-concurrency conflict detection. A conflict
 * triggers a full payload refresh instead of applying the stale result.
 */
export function useEntryUpdateQueue(options: {
  rpc: RpcClient;
  editorRevision: string | null;
  editorKey: string;
  setPayload: Dispatch<SetStateAction<InitialDataPayload | null>>;
  requestLatestPayload: () => Promise<void>;
}): {
  enqueueUpdate: (
    kind: 'profile' | 'config',
    file: string,
    index: number,
    patches: EntryPatchOperation[],
  ) => void;
  renameEntry: (
    kind: 'profile' | 'config',
    file: string,
    index: number,
    name: string,
  ) => Promise<void>;
} {
  const { rpc, editorRevision, editorKey, setPayload, requestLatestPayload } =
    options;
  const updateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef<string | null>(editorRevision);

  useEffect(() => {
    revisionRef.current = editorRevision;
  }, [editorRevision, editorKey]);

  useEffect(() => {
    updateQueueRef.current = Promise.resolve();
  }, [editorKey]);

  const renameEntry = useCallback(
    async (
      kind: 'profile' | 'config',
      file: string,
      index: number,
      name: string,
    ) => {
      await rpc.sendRequest({
        type: 'rename-entry',
        payload: {
          kind,
          file,
          index,
          name,
        },
      });

      await requestLatestPayload();
    },
    [rpc, requestLatestPayload],
  );

  const enqueueUpdate = useCallback(
    (
      kind: 'profile' | 'config',
      file: string,
      index: number,
      patches: EntryPatchOperation[],
    ) => {
      if (patches.length === 0) {
        return;
      }

      updateQueueRef.current = updateQueueRef.current
        .then(async () => {
          const baseRevision = revisionRef.current;
          const result = await rpc.sendRequest(
            kind === 'profile'
              ? {
                  type: 'update-profile',
                  payload: {
                    file,
                    index,
                    baseRevision,
                    patches,
                  },
                }
              : {
                  type: 'update-config',
                  payload: {
                    file,
                    index,
                    baseRevision,
                    patches,
                  },
                },
          );

          if (result.success !== true) {
            if (result.conflict === true) {
              await requestLatestPayload();
            }
            return;
          }

          revisionRef.current = result.revision ?? baseRevision;
          setPayload((currentPayload) => {
            if (currentPayload === null) {
              return currentPayload;
            }

            return {
              ...currentPayload,
              editorRevision: result.revision ?? currentPayload.editorRevision,
              generateReadiness: result.generateReadiness,
            };
          });
        })
        .catch(() => undefined);
    },
    [rpc, requestLatestPayload, setPayload],
  );

  return { enqueueUpdate, renameEntry };
}
