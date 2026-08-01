// eslint.config.mjs — Adopt-narrow (tools-only) flat config.
//
// Mechanical conventions enforced here are the single source of truth for JavaScript tooling.

import js from "@eslint/js";
import nodePlugin from "eslint-plugin-n";
import prettierConfig from "eslint-config-prettier";

export default [
  // Global ignores — keep config silent on out-of-scope content.
  {
    ignores: [
      "node_modules/**",
      "**/.venv/**", // Python virtualenvs ship vendored JS (matplotlib/urllib3) — never lint
      "**/venv/**",
      "agent-output/**",
      ".archive/**", // Provenance-only retired source; not active tooling
      "tmp/**",
      "infra/**",
      "logs/**",
      "assets/**",
      ".eslintcache",
      "**/*.min.js",
    ],
  },

  // Base rule set: ESLint recommended + plugin-n recommended-module
  js.configs.recommended,
  nodePlugin.configs["flat/recommended-module"],

  // Repo-wide explicit additions — single source of truth for the mechanical rules.
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-template": "error",
      "n/prefer-node-protocol": "error",
      // Validators all use `#!/usr/bin/env node` shebangs intentionally; n/hashbang
      // (recommended-module preset) flags this. Disable repo-wide.
      "n/hashbang": "off",
      // The plugin's data can lag current Node APIs. The Node 24 contract in package.json is the source
      // of truth; disabling avoids chasing the plugin's catalog.
      "n/no-unsupported-features/node-builtins": "off",
      // Validators print error lists by design; suppressing console.log would
      // drown signal in noise.
      "no-console": "off",
      // Allow `_`-prefixed vars to mark intentional ignores (destructuring slots,
      // unused callback args). Common Node convention.
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },

  // tools/scripts/** — validators are designed to call process.exit by contract.
  {
    files: ["tools/scripts/**/*.{js,mjs,cjs}"],
    rules: {
      "n/no-process-exit": "off",
    },
  },

  // tools/tests/** — node:test runners; relax module-resolution noise.
  {
    files: ["tools/tests/**/*.{js,mjs,cjs}"],
    rules: {
      "n/no-process-exit": "off",
      "n/no-unpublished-import": "off",
    },
  },

  // CommonJS config files (e.g. commitlint.config.js) use `module.exports`.
  {
    files: ["**/*.config.js", "**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
  },

  // Must come last: turn off stylistic ESLint rules that would conflict with Prettier.
  prettierConfig,
];
