import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiler working directory (user-submitted code)
    "temp/**",
    "dist/**",
    // Plain-Node helper scripts that tests spawn
    "tests/fixtures/**",
    // The desktop app: assembled copies of the build, and Rust's output
    "desktop/**",
    "src-tauri/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // An effect may only return its cleanup. An expression body returns whatever the call does,
      // and calls like scrollIntoView now return a Promise in some browsers: React then crashes
      // with "destroy is not a function" when the component unmounts.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression[expression=true]:not([body.type=/FunctionExpression$/])",
          message: "Give the effect a block body: it must return nothing or a cleanup function.",
        },
      ],
    },
  },
  {
    // Plain Node.js (CommonJS) entry points
    files: ["server.js", "scripts/supervise.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
