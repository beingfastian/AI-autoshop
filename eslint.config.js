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
    // The voice agent is an ES module package (the LiveKit SDK is ESM-only)
    files: ['agent/**/*.js'],
    languageOptions: { sourceType: 'module' }
  },
  {
    files: ['**/tests/**/*.js'],
    languageOptions: { globals: globals.jest }
  }
];
