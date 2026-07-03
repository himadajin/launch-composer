import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { rewriteWebviewHtml } from '../src/webview/webviewHtml.js';

test('rewriteWebviewHtml rewrites Vite script and stylesheet assets', async () => {
  const html = await readFile(
    path.resolve(__dirname, '..', 'test', 'fixtures', 'webview-index.html'),
    'utf8',
  );

  const rewritten = rewriteWebviewHtml(
    html,
    (assetPath) => `vscode-resource://extension/dist/webview/${assetPath}`,
  );

  assert.match(
    rewritten,
    /<script type="module" src="vscode-resource:\/\/extension\/dist\/webview\/\.\/assets\/index-Dt5jbPL1\.js"><\/script>/,
  );
  assert.match(
    rewritten,
    /<link rel="stylesheet" href="vscode-resource:\/\/extension\/dist\/webview\/\.\/assets\/index-aiNYwxCO\.css">/,
  );
  assert.doesNotMatch(rewritten, /crossorigin/);
});

test('rewriteWebviewHtml leaves unrelated HTML unchanged', () => {
  const html = '<!doctype html><html><body><div id="root"></div></body></html>';

  assert.equal(
    rewriteWebviewHtml(html, () => {
      throw new Error('unexpected asset rewrite');
    }),
    html,
  );
});
