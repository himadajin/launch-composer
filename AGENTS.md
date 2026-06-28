# Repository Guidelines

## Instruction Scope

This file is a durable working contract for coding agents in this repository. Keep it focused on repository-specific build, test, architecture, and verification rules. Do not add product overview content, issue-specific notes, or generic TypeScript/React/PR advice that belongs in `README.md`, `docs/`, or the current task prompt.

## Start Here

- Product behavior, package responsibilities, and spec routing are defined in `docs/internal/specs/README.md`.
- Data contract routing is defined in `docs/internal/contracts/README.md`.
- npm script definitions are in `package.json`; the required agent verification gate is listed in this file.
- This file is the canonical source for agent workflow, coding guardrails, verification expectations, external reference policy, testing policy, and commit policy.

## Project Structure

This repository is an npm workspace with three packages under `packages/`:

- `packages/core`: shared TypeScript logic for validating, merging, and generating `launch.json`. Keep it independent of VS Code APIs.
- `packages/extension`: the VS Code extension package published as `launch-composer`. It owns commands, tree views, workspace I/O, VS Code integration, bundled assets, and extension tests.
- `packages/webview`: the React webview UI bundled with Vite. It owns editor UI and communicates with the extension host through the existing VS Code bridge/RPC utilities.

Source files live in each package's `src/` directory. Tests live in `packages/core/test`, `packages/webview/test`, and `packages/extension/test`. Static extension assets live in `packages/extension/resources`. Extension-specific build scripts live in `packages/extension/esbuild.mjs` and `packages/extension/test/build-tests.mjs`.

Use `docs/internal/specs/` as the product behavior reference when a change affects generation rules, extension behavior, webview flows, or host/webview communication. Use `docs/internal/contracts/` as the data contract map for schema, shared TypeScript types, and Host/Webview message shapes.

## Spec-First Change Routing

Before implementing user-visible behavior, schema changes, generated `launch.json` changes, extension commands, TreeView actions, or host/webview messages, verify that the relevant file under `docs/internal/specs/` already defines the behavior. If the spec is silent, update the spec or make the task's acceptance criteria explicit before coding. Do not silently infer product semantics such as duplicate naming, insertion position, disabled-entry behavior, whether state flags are preserved or reset, post-action selection/reveal/open behavior, default values, empty-value deletion, validation timing, JSONC comment cloning versus preservation, or whether a new field is an extension-specific top-level key or a `configuration` pass-through key.

Use this routing when deciding which specs and code surfaces must move together:

- JSON file data, shared data types, generated `launch.json` shape, and Host/Webview message shapes: start from `docs/internal/contracts/`, then update the canonical TypeScript source it points to.
- Generation, merge, validation, args handling, and path resolution: `docs/internal/specs/core.md`, plus `docs/internal/specs/README.md` for JSON file behavior.
- Extension host behavior, workspace I/O, file watching, command registration, settings, and `launch.json` writing: `docs/internal/specs/extension.md`; use `docs/internal/specs/ui.md` as well when TreeView UI behavior or item actions change.
- Webview editor UI, form behavior, and VS Code-style interaction details: `docs/internal/specs/ui.md`.
- Extension Host ↔ Webview messages, editor persistence flow, request/response payloads, and shared data types: `docs/internal/specs/communication.md`.

When changing schema, shared data shapes, or host/webview communication, keep the mirrored contract surfaces synchronized: `docs/internal/contracts/`, `docs/internal/specs/communication.md`, `packages/extension/src/messages.ts`, `packages/webview/src/types.ts`, and `packages/core/src/types.ts` when `ProfileData`, `ConfigData`, or `ValidationError` changes. TypeScript types are the canonical source for data shapes; `docs/internal/contracts/` maps each contract to the owning type and spec. Preserve the existing persistence path: Webview state and controls emit changes through the local bridge/RPC utilities, the extension host applies JSONC patches, and the webview never performs workspace file I/O directly.

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

## External References

Use external documentation when it materially reduces guesswork about APIs, lifecycle, contribution metadata, or component behavior. Keep the lookup narrow: read the minimum official or local reference needed for the implementation decision, then continue working.

For VS Code extension behavior, use this order:

1. Prefer official AI-readable or Markdown-oriented entry points when available. Use `https://code.visualstudio.com/llms.txt` as the VS Code documentation index.
2. Read only the relevant official guide, UX guideline, or reference page for the changed API or contribution point.
3. Use `https://code.visualstudio.com/api/references/vscode-api` when exact types, events, arguments, or return values matter.
4. If docs leave lifecycle, workbench behavior, or file-operation semantics ambiguous, use `https://github.com/microsoft/vscode` as the source reference. Start from the documented API name, contribution point, command id, or workbench concept, and inspect only the relevant implementation or test files.

Do not require external docs for small refactors, tests, or changes where the behavior is already established by nearby code. Do not use general React or DOM documentation unless the task specifically depends on an unclear React or browser behavior.

For `@himadajin/vscode-components`, consult local package references when adding components or changing component props, styling contracts, or event behavior. Start with `node_modules/@himadajin/vscode-components/README.md` and `node_modules/@himadajin/vscode-components/dist/index.d.ts`; if those are insufficient and the adjacent source checkout exists, inspect `../vscode-components` narrowly.

When external references affect the implementation, mention the specific page or source area used and the decision it informed. Do not paste long documentation summaries into comments or final reports.

## VS Code Extension Work

When implementing or changing VS Code extension behavior in `packages/extension`, follow documented APIs and lifecycle patterns. Do not replace standard VS Code APIs with custom implementations unless the docs or source clearly require a different approach.

## Webview UI Work

When changing `packages/webview`, preserve the VS Code extension feel. Prefer the existing `@himadajin/vscode-components` components and local UI patterns. Avoid introducing a new design system, decorative marketing-style UI, or visual treatments that would feel out of place inside VS Code.

## Testing

Tests use Node's built-in runner via `node --test`. Name test files `*.test.ts` and keep them close to the package they verify.

Add or update tests for behavior changes in generation, validation, manifest wiring, workspace I/O, tree views, editor panel behavior, webview entry editing, and host/webview communication. Cover both success and failure paths when the changed behavior has meaningful invalid or error cases.

## Commits

Only commit when explicitly asked. Use Conventional Commits for commit messages. Use `feat:` for new features, `fix:` for bug fixes, `chore:` for maintenance, and add a scope when it clarifies the touched package or area.
