module.exports = {
  root: true,
  extends: [require.resolve('@kamby/config/eslint/base.cjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
  // tsconfig.json's rootDir is ./src (see its own comment) — a root-level config file like
  // this can't be added to that tsconfig's `include` without violating rootDir, and it's a
  // plain config object with nothing type-aware worth linting anyway.
  ignorePatterns: ['vitest.e2e.config.ts'],
};
