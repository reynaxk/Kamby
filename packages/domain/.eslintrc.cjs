module.exports = {
  root: true,
  extends: [require.resolve('@kamby/config/eslint/base.cjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
};
