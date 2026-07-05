import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // node --test owns test/*.test.ts; vitest owns DOM-dependent *.test.tsx.
    include: ['test/**/*.test.tsx'],
  },
});
