import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import functional from 'eslint-plugin-functional';
import cdkPlugin from 'eslint-cdk-plugin';

export default tseslint.config(
  eslint.configs.recommended,
  prettier,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [
      functional.configs.recommended,
      cdkPlugin.configs.recommended,
    ]
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'functional/no-expression-statements': 'off',
      'functional/no-return-void': 'off',
    },
  }
);
