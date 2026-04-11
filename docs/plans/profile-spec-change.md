# Profile Specification Change Plan

## Summary

This change replaces `template` with `profile` everywhere and treats the repository as if it had always used the `profile` concept. Backward compatibility is out of scope. Old `template` data, standalone configs, and migration behavior are intentionally undefined and do not need detection or recovery.

`config` entries will always reference a `profile`. The GUI will stop exposing `type` and `request`, and will focus on the fields that are commonly adjusted per config: `working directory`, `stop at entry`, `args`, `argsFile`, `enabled`, and `name`. `program` remains editable in the profile editor.

## Key Changes

- Rename all public and internal uses of `template` / `templates` to `profile` / `profiles`.
- Rename schema and data model fields so configs reference `profile` instead of `extends`.
- Change storage layout from `.vscode/launch-composer/templates/*.json` to `.vscode/launch-composer/profiles/*.json`.
- Change initialization defaults to create `profiles/profile.json` and `configs/config.json`.
- Make `config.profile` required in the new schema. Standalone configs are not supported.
- Keep profile data structure aligned with the current template structure: `name`, `args`, and `configuration`.
- Keep `profile.configuration.type` and `profile.configuration.request` required for valid generated output, but remove them from the GUI.
- Keep config-side override restrictions for `type`, `request`, and `program`.
- Keep shallow merge behavior: `profile.configuration` is the base and `config.configuration` overrides supported keys.

## GUI Changes

### Profile Editor

Expose only these fields:

- `Name`
- `Program`
- `Working Directory`
- `Stop At Entry`
- `Args`
- `Edit in JSON`

Do not show `Type` or `Request` in the form. If users need to modify them, they must edit the backing JSON directly.

### Config Editor

Expose only these fields:

- `Name`
- `Profile`
- `Enabled`
- `Working Directory`
- `Stop At Entry`
- `Args File`
- `Args`
- `Edit in JSON`

Remove `Type` and `Request` completely, including inherited read-only display.

### Config Profile Edge Cases

- The profile selector must never render an unlabeled blank option.
- If one or more profiles exist and `config.profile` is missing, empty, or not a string, show a placeholder option labeled `Select a profile...` and a warning that the config is invalid until a profile is chosen.
- If `config.profile` is a non-empty string that does not match an existing profile, keep that raw value visible in the selector as `<name> (missing)` so the broken reference is explicit and repairable from the GUI.
- If no profiles exist, disable the profile selector and show `No profiles available` instead of an empty option.
- If no profiles exist and the config still contains a non-empty unknown profile string, keep that value visible as `<name> (missing)` and disable the selector until at least one profile exists.
- Files with invalid JSON or invalid top-level shape remain read-only in the form editor, but the profile field still follows the same non-blank labeling rules when rendered from placeholder data.

## Add Config With Zero Profiles

When `Add Config` runs, the extension must first load the available profiles.

- If one or more profiles exist, continue with the normal flow:
  select profile -> enter config name -> create config -> open editor
- If no profiles exist, do not create a config.
- Show an information message: `Create a profile before adding a config.`
- Provide exactly one action: `Create Profile`
- If the user chooses `Create Profile`, jump into the normal profile creation flow.
- Do not automatically continue into config creation after profile creation completes.

`Add Config` should remain visible and executable even when there are no profiles. The missing prerequisite is explained at execution time rather than hidden in the UI.

## Test Plan

- Core generation succeeds for configs that reference profiles and override supported config-side fields.
- Validation fails when `config.profile` is missing or references an unknown profile.
- Validation still rejects config-side overrides of `type`, `request`, and `program`.
- Profile editor does not render `Type` or `Request`.
- Config editor does not render `Type`, `Request`, or any `No template` style option.
- `Add Config` with zero profiles creates nothing and shows the `Create Profile` guidance.
- Choosing `Create Profile` starts profile creation and does not auto-create a config afterward.
- Manifest, docs, and UI strings no longer contain `template`, `templates`, or `No template`.

## Assumptions

- There is no backward compatibility layer.
- There is no migration command.
- Old data is outside the supported specification.
- `program` remains editable from the profile GUI.
- `type` and `request` remain JSON-level responsibilities even though they are hidden from the GUI.
