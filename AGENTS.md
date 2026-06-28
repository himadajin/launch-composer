# Repository Guidelines

## Instruction Scope

This file is a durable working contract for coding agents in this repository. Keep it focused on repository-specific build, test, architecture, and verification rules. Do not add product overview content, issue-specific notes, or generic TypeScript/React/PR advice that belongs in `README.md`, `docs/`, or the current task prompt.

## Project Structure

This repository is an npm workspace with three packages under `packages/`:

- `packages/core`: shared TypeScript logic for validating, merging, and generating `launch.json`. Keep it independent of VS Code APIs.
- `packages/extension`: the VS Code extension package published as `launch-composer`. It owns commands, tree views, workspace I/O, VS Code integration, bundled assets, and extension tests.
- `packages/webview`: the React webview UI bundled with Vite. It owns editor UI and communicates with the extension host through the existing VS Code bridge/RPC utilities.

Source files live in each package's `src/` directory. Tests live in `packages/core/test`, `packages/webview/test`, and `packages/extension/test`. Static extension assets live in `packages/extension/resources`. Extension-specific build scripts live in `packages/extension/esbuild.mjs` and `packages/extension/test/build-tests.mjs`.

Use `docs/spec*.md` as the product behavior reference when a change affects generation rules, extension behavior, webview flows, or host/webview communication.

## Commands

Install dependencies from the repository root with `npm install`.

Full verification gate before considering an implementation change complete:

- `npm run format`
- `npm run lint`
- `npm run typecheck`
- `npm run test`

Use focused checks while iterating, then run the full gate at the end:

- `npm run build`: builds `core`, `webview`, and `extension` in order.
- `npm run build:core`, `npm run build:webview`, `npm run build:extension`: build one workspace through the root scripts.
- `npm run test -w @launch-composer/core`: build and run core tests from `dist/test`.
- `npm run test -w @launch-composer/webview`: compile and run webview tests from `.test-dist`.
- `npm run test -w launch-composer`: build the extension, compile extension tests, and run `node --test` on `.test-dist/*.test.js`.
- `npm run watch -w @launch-composer/webview`: rebuild the webview in watch mode.
- `npm run watch -w launch-composer`: rebuild the VS Code extension in watch mode.

## Coding Rules

Use TypeScript with ES modules and explicit `.js` import specifiers in source. Follow the repository's Prettier baseline: semicolons, single quotes, trailing commas, and 2-space indentation. Use `PascalCase` for React components, `camelCase` for functions and variables, and descriptive file names such as `workspaceStore.ts` or `bundle.test.ts`.

Respect package boundaries:

- Keep VS Code API usage and workspace file operations in `packages/extension`.
- Keep reusable launch composition and validation logic in `packages/core`.
- Keep browser-side UI logic in `packages/webview`; do not reach around the existing host/webview messaging layer.

For JSON or JSONC reads, writes, edits, and diagnostics, use the existing structured parsing/editing approach based on `jsonc-parser` or nearby helpers. Do not manipulate JSON files with ad hoc regular expressions or manual string concatenation.

## VS Code Extension Work

When implementing or changing VS Code extension behavior in `packages/extension`, consult the official VS Code documentation first and follow documented APIs and lifecycle patterns. For core editor behavior such as file operations, view state, tree views, webview panels, or UI lifecycle, also inspect the VS Code source code and align with the way VS Code handles the same class of problem.

Start from these official references:

- Extension API overview: `https://code.visualstudio.com/api`
- VS Code API reference: `https://code.visualstudio.com/api/references/vscode-api`
- VS Code documentation home: `https://code.visualstudio.com/docs`
- VS Code source repository: `https://github.com/microsoft/vscode`
- VS Code source code organization: `https://github.com/microsoft/vscode/wiki/source-code-organization`

Do not replace standard VS Code APIs with custom implementations unless the docs or source clearly require a different approach.

## Webview UI Work

When changing `packages/webview`, preserve the VS Code extension feel. Prefer the existing `@himadajin/vscode-components` components and local UI patterns. Avoid introducing a new design system, decorative marketing-style UI, or visual treatments that would feel out of place inside VS Code.

## Testing

Tests use Node's built-in runner via `node --test`. Name test files `*.test.ts` and keep them close to the package they verify.

Add or update tests for behavior changes in generation, validation, manifest wiring, workspace I/O, tree views, editor panel behavior, webview entry editing, and host/webview communication. Cover both success and failure paths when the changed behavior has meaningful invalid or error cases.

## Commits

Only commit when explicitly asked. Use Conventional Commits for commit messages. Use `feat:` for new features, `fix:` for bug fixes, `chore:` for maintenance, and add a scope when it clarifies the touched package or area.
