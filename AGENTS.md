# Repository Guidelines

## Project Structure & Module Organization
This repository is an npm workspace with three packages under `packages/`:

- `packages/core`: shared TypeScript logic for validating and generating `launch.json`.
- `packages/extension`: the VS Code extension package published as `launch-composer`, including commands, tree views, workspace I/O, bundled assets, and extension tests.
- `packages/webview`: the React webview UI bundled with Vite and shared VS Code-flavored components.

Source files live in each package's `src/` directory. Tests live in `packages/core/test` and `packages/extension/test`. Static assets for the extension live in `packages/extension/resources`, and the extension-specific build scripts live alongside the package in `packages/extension/esbuild.mjs` and `packages/extension/test/build-tests.mjs`.

## Build, Test, and Development Commands
Install dependencies with `npm install` at the repo root.

- `npm run build`: builds `core`, `webview`, and `extension` in order.
- `npm run build:core`, `npm run build:webview`, `npm run build:extension`: build an individual workspace from the repo root.
- `npm run typecheck`: runs `tsc --noEmit` across all packages.
- `npm run lint`: runs ESLint on workspace sources and test files.
- `npm run lint:fix`: applies ESLint fixes across the workspace.
- `npm run format`: formats the repository with Prettier.
- `npm run format:check`: verifies Prettier formatting.
- `npm run test`: runs the `core` and `extension` test suites.
- `npm run build -w @launch-composer/webview`: rebuild only the webview package.
- `npm run watch -w @launch-composer/webview`: rebuild the webview in watch mode.
- `npm run watch -w launch-composer`: rebuild the VS Code extension in watch mode.
- `npm run test -w launch-composer`: rebuilds the extension, compiles extension tests, and runs `node --test` on `.test-dist/*.test.js`.

## Coding Style & Naming Conventions
Use TypeScript with ES modules and explicit `.js` import specifiers in source. Prettier defines the formatting baseline: semicolons enabled, single quotes, trailing commas. Follow existing style: 2-space indentation, `PascalCase` for React components, `camelCase` for functions and variables, and descriptive file names such as `workspaceStore.ts` or `bundle.test.ts`.

Run `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run test` before opening a PR.

## Testing Guidelines
Tests use Node's built-in runner via `node --test`. Name test files `*.test.ts` in package-level `test/` directories. The `core` package runs tests from built output in `dist/test`, and the extension package compiles tests into `.test-dist` before execution. Keep new tests close to the package they verify, and cover both success and failure paths for generation, manifest wiring, editor panel behavior, and extension commands.

## Commit & Pull Request Guidelines
Recent history favors short, imperative commit messages such as `implement packages/core` and `chore(.gitignore): add initial .gitignore file`. Keep commits focused and use a scope when it adds clarity.

PRs should include a short summary, linked issue or task when applicable, and screenshots or recordings for webview or VS Code UI changes. Note any manual verification steps, especially for extension behavior inside VS Code.
