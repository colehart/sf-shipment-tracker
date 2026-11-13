const { defineConfig } = require('eslint/config');
const eslintJs = require('@eslint/js');
const jestPlugin = require('eslint-plugin-jest');
const lightning = require('@salesforce/eslint-plugin-lightning');
const globals = require('globals');

module.exports = defineConfig([
  {
    files: ['force-app/main/default/lwc/**/*.js'],
    extends: [eslintJs.configs.recommended],
    plugins: { '@lwc/lwc': require('@lwc/eslint-plugin-lwc'), '@salesforce/lightning': lightning },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: require('@babel/eslint-parser'),
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { parserOpts: { plugins: ['classProperties', ['decorators', { decoratorsBeforeExport: false }]] } }
      },
      globals: { ...globals.browser }
    },
    rules: {
      '@lwc/lwc/no-api-reassignments': 'error',
      '@lwc/lwc/no-async-operation': 'warn',
      '@lwc/lwc/no-inner-html': 'error',
      '@lwc/lwc/no-document-query': 'error',
      '@salesforce/lightning/valid-apex-method-invocation': 'error'
    }
  },
  {
    files: ['force-app/main/default/lwc/**/__tests__/**/*.js', 'force-app/test/**/*.js'],
    plugins: { jest: jestPlugin },
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { ...jestPlugin.configs.recommended.rules, '@lwc/lwc/no-async-operation': 'off' }
  }
]);
