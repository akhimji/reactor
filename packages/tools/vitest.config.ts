import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tools',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
