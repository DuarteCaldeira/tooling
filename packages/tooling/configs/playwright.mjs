export default {
  forbidOnly: Boolean(process.env.CI),
  retries: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'allow' },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
};
