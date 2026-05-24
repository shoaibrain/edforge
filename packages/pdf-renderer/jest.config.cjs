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
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.test.json' }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
