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

## Should `WorkspaceDataSnapshot.generateReadiness` be required?

Current state: `WorkspaceDataSnapshot.generateReadiness` is optional, so
EditorPanel keeps a fallback readiness value when a snapshot lacks readiness.

Reason to revisit: readiness is now a first-class UI state. The extension could
make `WorkspaceDataSnapshot` require readiness and use a separate
`WorkspaceDataWithoutReadiness` type only for partial cache/read inputs.

If this changes later, update `WorkspaceStore`, `EditorPanelController`,
extension tests, and any snapshot cache helpers together.
