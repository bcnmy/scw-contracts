module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "standard",
    "plugin:prettier/recommended",
    "plugin:node/recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:security/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020, // Allows for the parsing of modern ECMAScript features
    sourceType: "module", // Allows for the use of imports
  },
  rules: {
    "node/no-unsupported-features/es-syntax": [
      "error",
      { ignores: ["modules"] },
    ],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "node/no-missing-import": [
      "error",
      {
        allowModules: [],
        resolvePaths: ["test"],
        tryExtensions: [".js", ".json", ".node", ".ts"],
      },
    ],
    camelcase: [
      "error",
      {
        allow: [".*__factory"],
      },
    ],
    // "@typescript-eslint/no-explicit-any": "error",
    // quotes: ["error", "double"],
    // "no-unused-vars": "error",
    // "no-console": "error",
    // "@typescript-eslint/no-unused-vars": "error",
    // "@typescript-eslint/explicit-function-return-type": "error",
  },
};
