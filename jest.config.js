const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
  ...jestConfig,
  moduleNameMapper: {
    '^lightning/navigation$': '<rootDir>/force-app/test/jest-mocks/lightning/navigation'
  },
  modulePathIgnorePatterns: ['<rootDir>/.localdevserver'],
  collectCoverageFrom: ['force-app/main/default/lwc/**/*.js', '!**/__tests__/**'],
  coverageThreshold: {
    global: { branches: 65, functions: 85, lines: 85, statements: 85 }
  }
};
