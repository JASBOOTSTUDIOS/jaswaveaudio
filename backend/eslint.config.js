import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // Copia literal del gateway de escritorio (jas-wave/electron): parsea JSON de proveedores sin tipar.
  { files: ['src/ia/gateway/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  { ignores: ['dist/**', 'node_modules/**', 'prisma/**', 'src/generated/**'] },
);
