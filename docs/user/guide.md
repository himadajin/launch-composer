# Launch Composer User Guide

Launch Composer generates `.vscode/launch.json` from reusable profile and config
files. Use it when multiple debug configurations share common settings, or when
you want generated debug entries to stay separate from the smaller files you edit
by hand.

Launch Composer works with exactly one workspace folder.

## Install Locally

From this repository:

```bash
npm install
npm run install:vscode
```

This builds a VSIX package and installs it into VS Code.

## Basic Workflow

1. Open a single-folder workspace in VS Code.
2. Run `Launch Composer: Initialize`.
3. Open the `Launch Composer` Activity Bar view.
4. Add or edit profiles and configs.
5. Run `Launch Composer: Generate launch.json`.

Launch Composer stores its source files under `.vscode/launch-composer/` and
writes generated output to `.vscode/launch.json`.

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

A profile contains shared launch settings. Configs refer to profiles by name.

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
        "NODE_ENV": "development",
      },
    },
  },
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
        "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      },
    },
  ],
}
```

After running `Launch Composer: Generate launch.json`, the config is merged with
its profile and written to `.vscode/launch.json`.

## Practical Notes

- Source files are JSONC, so comments and trailing commas are allowed.
- `configuration` is shallow-merged: config keys replace profile keys with the
  same name.
- Use inline `args` for short argument lists.
- Use `argsFile` when an argument list is too long to keep inline. The args file
  contains an object with an `args` string array.
- `launch.json` is generated output. Existing contents are replaced when
  generation succeeds.
- Use `excluded: true` on a config entry to keep it out of the generated
  `launch.json`.
