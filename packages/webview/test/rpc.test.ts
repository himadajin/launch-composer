import assert from 'node:assert/strict';
import test from 'node:test';

import { RpcClient } from '../src/utils/rpc.js';
import type { WebviewMessage } from '../src/types.js';

test('sendRequest posts request ids and resolves matching response payloads', async () => {
  const posted: WebviewMessage[] = [];
  const rpc = new RpcClient({
    timeoutMs: 1000,
    transport: {
      postMessage(message) {
        posted.push(message);
      },
    },
  });

  const resultPromise = rpc.sendRequest({ type: 'browse-file' });

  assert.equal(posted.length, 1);
  const request = posted[0];
  assert.ok(request !== undefined);
  assert.equal(request.type, 'browse-file');
  assert.ok('requestId' in request);

  assert.equal(
    rpc.handle({
      type: 'file-selected',
      requestId: request.requestId,
      payload: { path: '/tmp/args.json' },
    }),
    true,
  );
  assert.deepEqual(await resultPromise, { path: '/tmp/args.json' });
});

test('handle rejects unexpected response types and clears the request', async () => {
  const posted: WebviewMessage[] = [];
  const rpc = new RpcClient({
    timeoutMs: 1000,
    transport: {
      postMessage(message) {
        posted.push(message);
      },
    },
  });

  const resultPromise = rpc.sendRequest({ type: 'browse-file' });
  const request = posted[0];
  assert.ok(request !== undefined);
  assert.ok('requestId' in request);

  assert.equal(
    rpc.handle({
      type: 'generate-result',
      requestId: request.requestId,
      payload: { success: true },
    }),
    true,
  );
  await assert.rejects(resultPromise, /Unexpected response type/);
  assert.equal(
    rpc.handle({
      type: 'file-selected',
      requestId: request.requestId,
      payload: { path: '/tmp/args.json' },
    }),
    false,
  );
});

test('sendRequest rejects and clears pending requests on timeout', async () => {
  const posted: WebviewMessage[] = [];
  const rpc = new RpcClient({
    timeoutMs: 5,
    transport: {
      postMessage(message) {
        posted.push(message);
      },
    },
  });

  const resultPromise = rpc.sendRequest({ type: 'generate' });
  const request = posted[0];
  assert.ok(request !== undefined);
  assert.ok('requestId' in request);

  await assert.rejects(
    resultPromise,
    /Timed out waiting for generate-result response/,
  );
  assert.equal(
    rpc.handle({
      type: 'generate-result',
      requestId: request.requestId,
      payload: { success: true },
    }),
    false,
  );
});

test('open-profile requests resolve open-profile-result payloads', async () => {
  const posted: WebviewMessage[] = [];
  const rpc = new RpcClient({
    timeoutMs: 1000,
    transport: {
      postMessage(message) {
        posted.push(message);
      },
    },
  });

  const resultPromise = rpc.sendRequest({
    type: 'open-profile',
    payload: { profileName: 'cpp' },
  });

  const request = posted[0];
  assert.ok(request !== undefined);
  assert.equal(request.type, 'open-profile');
  assert.ok('requestId' in request);
  assert.deepEqual(request.payload, { profileName: 'cpp' });

  assert.equal(
    rpc.handle({
      type: 'open-profile-result',
      requestId: request.requestId,
      payload: { success: true },
    }),
    true,
  );
  assert.deepEqual(await resultPromise, { success: true });
});
