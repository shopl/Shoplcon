import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintPluginPrettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier: eslintPluginPrettier,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Prettier 설정
  {
    plugins: {
      prettier: eslintPluginPrettier, // Prettier 플러그인 로드
    },
    rules: {
      ...eslintConfigPrettier.rules,
      'prettier/prettier': [
        'error',
        {
          useTabs: false,
          printWidth: 120,
          tabWidth: 2,
          singleQuote: true,
          semi: true,
          bracketSpacing: true,
          htmlWhitespaceSensitivity: 'css',
          insertPragma: false,
          jsxBracketSameLine: false,
          jsxSingleQuote: true,
          quoteProps: 'as-needed',
          requirePragma: false,
          trailingComma: 'all',
          arrowParens: 'always',
          proseWrap: 'never',
          endOfLine: 'auto',
        },
      ], // Prettier 규칙을 ESLint 에러로 처리
    },
  },
);
