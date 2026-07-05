// Shared build settings. Keep the esbuild target aligned with the
// engines.node requirement in the root package.json.
export const nodeTarget = 'node24';

// Prefer ESM entry points when bundling for node. jsonc-parser's "main"
// points at a UMD loader whose lazy require() calls break inside an
// esbuild bundle, so resolution must pick "module" first.
export const nodeMainFields = ['module', 'main'];
