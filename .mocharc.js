module.exports = {
  extension: ['ts'],
  spec: 'test/**/*.ts',
  require: ['ts-node/register', 'tsconfig-paths/register'],
  recursive: true,
  timeout: 5000,
};
