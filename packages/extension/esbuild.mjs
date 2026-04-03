import { context } from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  sourcemap: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('[watch] extension build started');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
