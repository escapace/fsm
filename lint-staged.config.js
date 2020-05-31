module.exports = {
  'package.json': [
    'syncpack-format --source',
    'syncpack-set-semver-ranges --dev --source'
  ],
  'src/**/*.ts?(x)': ['eslint --fix', 'prettier --write'],
  'src/**/*.js?(x)': ['eslint --fix', 'prettier --write']
}
