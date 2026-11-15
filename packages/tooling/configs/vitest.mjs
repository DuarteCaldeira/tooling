import { configDefaults } from 'vitest/config';

export default {
  test: {
    exclude: [...configDefaults.exclude, '**/.tooling/**'],
    reporters: ['default', 'json'],
    outputFile: { json: `${process.env.TOOLING_UNIT_OUTPUT_DIR ?? 'test-results'}/vitest.json` },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      reportsDirectory: `${process.env.TOOLING_UNIT_OUTPUT_DIR ?? 'test-results'}/coverage`,
    },
    clearMocks: false,
    restoreMocks: false,
  },
};
