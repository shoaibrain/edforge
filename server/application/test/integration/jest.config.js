/**
 * Jest config for the LocalStack/DynamoDB-Local integration suite.
 *
 * The root `jest.config.js` (unit suite) EXCLUDES `test/integration/` and
 * globally mocks the AWS SDK in its setup file, so integration specs need
 * their own config with real SDK clients. NOTE: `npm run test:integration`
 * references a root-level `jest.integration.config.js` that does not exist
 * in the repo (pre-existing gap, predates EPIC-FB) — until that is
 * reconciled, run this suite explicitly:
 *
 *   # start a local DynamoDB (any of these works):
 *   #   docker compose -f ../docker-compose.local.yml up -d localstack
 *   #   docker run -d -p 8000:8000 amazon/dynamodb-local   (+ LOCALSTACK_ENDPOINT=http://localhost:8000)
 *   #   java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -inMemory -port 8000
 *   cd server/application
 *   NODE_OPTIONS=--experimental-vm-modules \
 *     npx jest --config test/integration/jest.config.js [pattern]
 *
 * NODE_OPTIONS=--experimental-vm-modules is REQUIRED: the real AWS SDK v3
 * lazy-loads modules via dynamic import(), which Jest's vm sandbox rejects
 * without the flag. The unit suite never sees this because its setup file
 * mocks the whole SDK.
 *
 * No globalSetup here: specs bootstrap exactly the resources they need
 * (the legacy identity/eventbridge specs import ./setup themselves; the
 * finance-agreements spec creates its own table) so one spec's
 * requirements don't block another's run.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../..',
  testMatch: ['<rootDir>/test/integration/**/*.integration.spec.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/auth(.*)$': '<rootDir>/libs/auth/src/$1',
    '^@app/client-factory(.*)$': '<rootDir>/libs/client-factory/src/$1',
    '^@app/common-utils(.*)$': '<rootDir>/libs/common-utils/src/$1',
    '^@app/http-client(.*)$': '<rootDir>/libs/http-client/src/$1',
    '^@app/csv-parser(.*)$': '<rootDir>/libs/csv-parser/src/$1',
    '^@app/cache(.*)$': '<rootDir>/libs/cache/src/$1',
    '^@app/aws-mocks(.*)$': '<rootDir>/libs/aws-mocks/src/$1',
    '^@app/test-utils(.*)$': '<rootDir>/libs/test-utils/src/$1',
    '^@app/events(.*)$': '<rootDir>/libs/events/src/$1',
    '^@app/analytics-events(.*)$': '<rootDir>/libs/analytics-events/src/$1',
    '^@app/logger(.*)$': '<rootDir>/libs/logger/src/$1',
    '^@app/exceptions(.*)$': '<rootDir>/libs/exceptions/src/$1',
    '^@app/health(.*)$': '<rootDir>/libs/health/src/$1',
    '^@aibrains/shared-types$':
      '<rootDir>/../../node_modules/@aibrains/shared-types/dist/index.js',
    '^@aibrains/shared-types/(.*)$':
      '<rootDir>/../../node_modules/@aibrains/shared-types/dist/$1',
  },
  testTimeout: 30000,
  verbose: true,
};
