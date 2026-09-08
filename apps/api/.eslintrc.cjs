module.exports = {
  root: true,
  extends: [require.resolve('@kamby/config/eslint/nestjs.cjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
};
