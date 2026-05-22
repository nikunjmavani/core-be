/**
 * Commitlint config (CommonJS; consumed by Husky and CI).
 *
 * Length rules (`*-max-line-length`, `*-max-length`) are disabled because
 * GitHub squash-merge commits concatenate every constituent commit body and
 * append `Co-authored-by:` trailers — bodies routinely exceed 100 chars and
 * cannot be edited after the squash. The semantic conventional-commits rules
 * (type, scope, subject case, etc.) still apply.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0, 'always'],
    'body-max-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
    'footer-max-length': [0, 'always'],
    'header-max-length': [0, 'always'],
  },
};
