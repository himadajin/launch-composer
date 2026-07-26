# Launch Composer - Pending Decisions

This file records internal product-design questions that are intentionally not
being changed yet, but should not be forgotten.

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

## Decide the GUI field set and pass-through key visibility

Origin: 2026-07-20 UI boundary investigation (follows the profile-owned
program decision recorded in `specs/core.md`).

Current state: the editors expose a fixed field set (profile: type / request /
program / cwd / stopAtEntry / args; config: cwd / stopAtEntry / argsFile /
args). Every other `configuration` key (`env`, `console`, `skipFiles`, ...) is
a silent JSON pass-through: it is merged into the output but never shown in
the editor, so the form does not reveal the whole entry. The fixed set also
bakes in adapter-specific assumptions: `stopAtEntry` is a cppdbg/coreclr-style
key, while js-debug uses `stopOnEntry`.

To change: decide these together, since a generic key editor would subsume the
adapter-specific fixed fields: (1) whether pass-through keys are shown
read-only, editable via a generic key-value editor, or stay invisible;
(2) which keys deserve fixed form fields, and whether adapter-specific ones
such as `stopAtEntry` keep that status. Then update `ui.md`, the editors, and
tests together. If a generic key-value editor is adopted, reuse the per-field
Override toggle pattern decided in plan 015 for its override semantics.

## Decide whether excluded configs should still block Generate

Origin: 2026-07-20 UI boundary investigation.

Current state: per `core.md`, excluded configs are still validated and their
errors block Generate. Excluding a broken config via the TreeView checkbox
therefore does not unblock Generate; the JSON must be fixed first.

To change: decide between keeping strict validation and demoting excluded
entries' errors to non-blocking diagnostics (still shown in the TreeView and
editor). If demoted, update `core.md`, validation, generate filtering, and
tests together.

## Unify the profile and config file root shapes

Origin: 2026-07-20 UI boundary investigation.

Current state: a profile file's root is a JSON array of profile entries,
while a config file's root is an object with a `configurations` array. The
asymmetry invites hand-editing mistakes and doubles the shape documentation.

To change: decide whether to unify the root shapes (requires a migration
story for existing files) or keep the asymmetry. One consideration: an object
root leaves room for future file-level metadata, an array root does not.
