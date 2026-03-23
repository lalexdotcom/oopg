import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: {
    entry: { index: './index.ts' },
  },
  lib: [
    {
      format: 'esm',
      syntax: ['node 18'],
      dts: true,
    },
  ],
});
