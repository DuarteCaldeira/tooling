export default {
  outputDir: process.env.TOOLING_TEST_OUTPUT_DIR ?? 'test-results',
  forbidOnly: Boolean(process.env.CI),
  retries: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    [
      'json',
      { outputFile: `${process.env.TOOLING_TEST_OUTPUT_DIR ?? 'test-results'}/results.json` },
    ],
  ],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'allow' },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
};
