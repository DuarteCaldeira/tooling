export default {
  test: {
    coverage: { provider: 'v8', reporter: ['text-summary', 'html', 'lcov'] },
    clearMocks: false,
    restoreMocks: false,
  },
};
