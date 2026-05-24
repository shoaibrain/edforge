/**
 * Jest configuration for @aibrains/pdf-renderer
 *
 * Sprint C.0.2 — core/ unit specs only (format helpers, i18n, theme).
 * PDF-rendering snapshot tests (Devanagari shaping etc.) land with C.0.3
 * primitives once @react-pdf/renderer is wired.
 *
 * Run: `npx jest --config packages/pdf-renderer/jest.config.cjs`
 * or   `npm --workspace @aibrains/pdf-renderer run test`
 */
module.exports = {
  rootDir: './src',
  testRegex: '.*\\.spec\\.(ts|tsx)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.test.json' }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // yoga-layout (a transitive @react-pdf/renderer dep) ships TS source under
  // node_modules/yoga-layout/src/. By default Jest skips transforming
  // node_modules; we override only that one path so the canary tests can
  // load the real RPDF pipeline.
  transformIgnorePatterns: ['/node_modules/(?!yoga-layout/)'],
};
