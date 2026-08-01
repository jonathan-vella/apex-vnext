/**
 * Commitlint Configuration
 *
 * Enforces Conventional Commits for readable repository history.
 * See: https://www.conventionalcommits.org/
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Enforce conventional commit types
    "type-enum": [
      2,
      "always",
      [
        "feat", // New feature
        "fix", // Bug fix
        "docs", // Documentation only changes
        "style", // Code style changes (formatting, semicolons, etc.)
        "refactor", // Code refactoring (no functional change)
        "perf", // Performance improvements
        "test", // Adding or updating tests
        "build", // Build system or external dependencies
        "ci", // CI/CD configuration
        "chore", // Other changes (maintenance, tooling)
        "revert", // Reverting a previous commit
      ],
    ],
    // Type must be lowercase
    "type-case": [2, "always", "lower-case"],
    // Type is required
    "type-empty": [2, "never"],
    // Subject (description) is required
    "subject-empty": [2, "never"],
    // Subject should not end with period
    "subject-full-stop": [2, "never", "."],
    // Subject should be sentence case (optional, warning only)
    "subject-case": [1, "always", "sentence-case"],
    // Header (first line) max length
    "header-max-length": [2, "always", 100],
  },
  // Custom help message for invalid commits
  helpUrl: "https://www.conventionalcommits.org/",
};
