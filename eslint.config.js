const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['**/node_modules/**', '**/coverage/**', 'Architecture/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node
    },
    rules: {
      // Warn only: existing code has a few unused imports, cleaned up as each file is touched
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$', caughtErrors: 'none' }]
    }
  },
  {
    files: ['**/tests/**/*.js'],
    languageOptions: { globals: globals.jest }
  }
];
