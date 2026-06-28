# Launch Composer

Launch Composer is a VS Code extension for generating `.vscode/launch.json` from
reusable profile and config files.

Use it when several debug configurations share the same base settings, or when
you want to keep generated `launch.json` entries separate from the small pieces
you edit by hand.

Launch Composer works with exactly one workspace folder.

## Install Locally

From this repository:

```bash
npm install
npm run install:vscode
```

This builds a VSIX package and installs it into VS Code.

## Quick Start

1. Open a single-folder workspace in VS Code.
2. Run `Launch Composer: Initialize`.
3. Open the `Launch Composer` Activity Bar view.
4. Add or edit profiles and configs.
5. Run `Launch Composer: Generate launch.json`.

The extension stores its source files under `.vscode/launch-composer/` and
writes the generated output to `.vscode/launch.json`.

```text
.vscode/
  launch-composer/
    profiles/
      profile.json
    configs/
      config.json
  launch.json
```

## Profiles

A profile contains shared launch settings. Configs extend profiles when
generating `launch.json`.

Copy this as `.vscode/launch-composer/profiles/profile.json`:

```jsonc
[
  {
    "name": "node-launch",
    "configuration": {
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
]
```

`configuration` is passed through to the generated VS Code launch configuration.
`type` and `request` belong in the profile.

## Configs

A config describes one generated debug configuration.

Copy this as `.vscode/launch-composer/configs/config.json`:

```jsonc
{
  "configurations": [
    {
      "name": "Debug API server",
      "profile": "node-launch",
      "excluded": false,
      "args": ["--config", "config/local.json"],
      "configuration": {
        "program": "${workspaceFolder}/src/server.ts",
        "sourceMaps": true,
        "outFiles": ["${workspaceFolder}/dist/**/*.js"]
      }
    }
  ]
}
```

After running `Launch Composer: Generate launch.json`, the config is merged with
its profile and written to `.vscode/launch.json`.

## Notes

- Source files are JSONC, so comments and trailing commas are allowed.
- `configuration` is shallow-merged: config keys replace profile keys with the
  same name.
- Use `argsFile` when an argument list is too long to keep inline.
- `launch.json` is generated output. Existing contents are replaced when
  generation succeeds.
- Use `excluded: true` on a config entry to keep it out of the generated
  `launch.json`.

## More Information

- Product behavior and file formats: [docs/spec.md](./docs/spec.md)
- Repository workflow and development instructions: [AGENTS.md](./AGENTS.md)
