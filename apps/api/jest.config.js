/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/load-env.ts'],
  // Pipeline tests wait on queued runs (pg-boss polling), so they need more than 5 s.
  testTimeout: 30_000,
};
