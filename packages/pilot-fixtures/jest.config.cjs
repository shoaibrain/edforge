/**
 * Jest configuration for @edforge/pilot-fixtures
 *
 * Mirrors the shared-types pattern: pure-TS specs co-located with source,
 * ts-jest, no setup file. Tests read from the pilots/ data directory at the
 * package root so the rootDir spans BOTH src/ and pilots/ — we set it to '.'
 * to make the registry's fs glob work without path tricks.
 */
module.exports = {
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
