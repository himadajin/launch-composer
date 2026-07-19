# Launch Composer - Pending Decisions

This file records internal product-design questions that are intentionally not
being changed yet, but should not be forgotten.

## Should configs be allowed to define `configuration.program`?

Current state: `config.configuration.program` is intentionally invalid.
`program`, `type`, and `request` are managed by profiles under the current
specs, implementation, UI, and tests.

Reason to revisit: users may naturally expect config entries to own the
executable or script target, while profiles may feel more like shared debug
adapter defaults.

If this changes later, update the internal specs, core validation and merge
behavior, UI editor fields, tests, README examples, and user guide together.

## Unify the editorPanel mutation error policy

Origin: 2026-07 refactoring investigation, item E-1 (behavior change,
deliberately kept out of the refactoring's scope).

Current state: the three editorPanel mutation handlers report failures three
different ways. `rename-entry` and `update-profile`/`update-config` post a
failure response to the webview and then rethrow, so the host also shows an
error toast (double reporting). `delete-profile`/`delete-config` post only the
failure response. The difference is preserved explicitly via the
`rethrowOnFailure` flag in `EditorPanelController.runMutation`.

To change: pick one policy (e.g. "the webview owns failure display; the host
never toasts"), document it in `docs/internal/specs/communication.md`, and
update `editorPanel.test.ts` expectations together with the implementation.

## Replace regex-based missing-file detection with FileSystemError.code

Origin: 2026-07 refactoring investigation, item E-2 (behavior-adjacent).

Current state: `isMissingFileSystemError` in
`packages/extension/src/io/dataFileIo.ts` matches `error.message` /
`error.name` with regexes. The test stub even has a three-mode error-style
switch (`setMissingPathErrorStyle`) to exercise it.

To change: use `error instanceof vscode.FileSystemError && error.code ===
'FileNotFound'` plus a raw `code === 'ENOENT'` fallback, and simplify the stub
at the same time (the stub's `FileSystemError` currently lacks `.code`).
Treated as behavior-adjacent because remote FS providers may surface different
error shapes.

## Align watcher patterns with the store's read scope

Origin: 2026-07 refactoring investigation, item E-3 (behavior change).

Current state: watchers use `profiles/**/*.json` (recursive) via
`WorkspaceLayout.getRelativeProfilePattern` / `getRelativeConfigPattern`, but
`WorkspaceReader.listFiles` only reads the directory top level, and the echo
filter keys on basename only. A nested file like `profiles/sub/x.json` is
watched but never read, and its echo-suppression key collides with a same-name
top-level file.

To change: narrow the watcher patterns to `profiles/*.json` /
`configs/*.json`, and document the (currently unspecified) treatment of nested
files in `docs/internal/specs/extension.md` as part of the same change.

## Decide secondary diagnostics for duplicate profiles

Origin: plan 002, item P4 (left out of commit `f6ded80`).

Current state: duplicate profile names are rejected, but the profile lookup is
last-wins while collecting secondary diagnostics. An args/argsFile conflict can
therefore depend on which duplicate profile definition was encountered last.

To change: decide whether secondary diagnostics should be suppressed for an
ambiguous profile reference or reported against every matching profile, then
update `core.md`, validation, and tests together.

## Decide whether whitespace-only names are valid

Origin: plan 002, item P5 (left out of commit `f6ded80`).

Current state: non-empty string validation accepts names consisting only of
whitespace.

To change: define trimming and persistence semantics for profile and config
names before tightening validation and editor behavior.

## Decide whether variable resolution aggregates errors

Origin: plan 002, item P6 (left out of commit `f6ded80`).

Current state: `resolveArgsFilePath` reports one variable-resolution error when
an input contains multiple invalid or unresolved variables.

To change: decide whether variable resolution should aggregate all errors or
remain fail-fast, then update `core.md`, the resolver contract, and tests.
